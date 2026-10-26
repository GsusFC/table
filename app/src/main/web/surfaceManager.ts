import { dialog, WebContentsView, type BrowserWindow, type Rectangle, type WebContents } from 'electron'
import type { CardId, MesaId } from '../../shared/model'
import type { PanelBounds, SurfaceCardState, UnloadResult } from '../../shared/surface'
import { isHttpUrl } from '../../shared/validate'
import { log, originOf } from '../log'
import { attachContextMenu, configureSurfaceSession, guardNavigation, SURFACE_PARTITION } from './guards'
import { isExitShortcut } from './shortcut'
import type { SurfaceCallbacks, SurfaceManager } from './types'

const CAPTURE_MAX_WIDTH = 1280
const CAPTURE_JPEG_QUALITY = 72
/** Chromium cancela la carga anterior al navegar: no es un fallo. */
const ERR_ABORTED = -3

type CloseReason = 'quit' | 'unload'

/** Web cargada de una tarjeta: su vista, la mesa a la que pertenece y su estado. */
interface LoadedCard {
  readonly mesaId: MesaId
  readonly cardId: CardId
  readonly view: WebContentsView
  /**
   * Popups abiertos desde esta web (y desde sus popups); se cierran al
   * descargarla respetando su `beforeunload`. Si la vista se recrea tras
   * morir su proceso, el conjunto pasa a la nueva tarjeta.
   */
  readonly popups: Set<BrowserWindow>
  state: SurfaceCardState
  /** Inicio de la carga inicial, hasta el primer `did-stop-loading`. */
  loadStartedAt: number | null
}

function toRectangle(bounds: PanelBounds): Rectangle {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height)),
  }
}

/** Origen de la URL actual de la tarjeta, para registros y diálogos. */
function cardOrigin(card: LoadedCard): string {
  return originOf(card.state.currentUrl ?? '')
}

export function createSurfaceManager(window: BrowserWindow, callbacks: SurfaceCallbacks): SurfaceManager {
  configureSurfaceSession(window)

  const cards = new Map<CardId, LoadedCard>()
  let active: LoadedCard | null = null
  let bounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 }

  /**
   * Las operaciones públicas se encadenan: entrar, salir y descargar esperan
   * capturas y `beforeunload`, y no deben intercalarse.
   */
  let queue: Promise<unknown> = Promise.resolve()
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation, operation)
    queue = result.catch(() => undefined)
    return result
  }

  function update(card: LoadedCard, partial: Partial<Omit<SurfaceCardState, 'cardId'>>): void {
    card.state = { ...card.state, ...partial }
    callbacks.onState(card.state)
  }

  function isAlive(card: LoadedCard): boolean {
    const contents = card.view.webContents
    return !contents.isDestroyed() && !contents.isCrashed()
  }

  /**
   * Pregunta si descartar el trabajo que una página o un popup dice tener
   * pendiente. `true` = descartar. Si la aplicación aporta su propia decisión
   * (el smoke), sustituye al diálogo.
   */
  function confirmDiscard(origin: string, reason: CloseReason): boolean {
    if (callbacks.confirmDiscard) {
      return callbacks.confirmDiscard(origin, reason)
    }
    const options: Electron.MessageBoxSyncOptions = {
      type: 'warning',
      buttons: reason === 'quit' ? ['Cancelar', 'Salir sin guardar'] : ['Mantener cargada', 'Descargar sin guardar'],
      defaultId: 0,
      cancelId: 0,
      message: `La web ${origin} avisa de trabajo sin guardar.`,
      detail: 'Table no puede comprobar si el cambio se ha guardado. Si continúas, puede perderse.',
    }
    const response = window.isDestroyed() ? dialog.showMessageBoxSync(options) : dialog.showMessageBoxSync(window, options)
    return response === 1
  }

  /**
   * Flujo común de cierre respetando `beforeunload`, para la vista y para los
   * popups. `close` inicia el cierre; `watchGone` avisa cuando el contenido
   * desaparece y devuelve cómo dejar de escuchar. Si la página avisa de
   * trabajo pendiente, decide el usuario; Table no descarta cambios por su
   * cuenta. `true` si quedó cerrado.
   */
  function closeGuarded(
    contents: WebContents,
    reason: CloseReason,
    close: () => void,
    watchGone: (onGone: () => void) => () => void,
  ): Promise<boolean> {
    const { promise, resolve } = Promise.withResolvers<boolean>()
    const onPreventUnload = (event: Electron.Event): void => {
      const origin = originOf(contents.getURL())
      const discard = confirmDiscard(origin, reason)
      log('unload-prevented', { origin, reason, discard })
      if (discard) {
        event.preventDefault()
        return
      }
      contents.removeListener('will-prevent-unload', onPreventUnload)
      stopWatching()
      resolve(false)
    }
    const stopWatching = watchGone(() => {
      if (!contents.isDestroyed()) {
        contents.removeListener('will-prevent-unload', onPreventUnload)
      }
      resolve(true)
    })
    contents.on('will-prevent-unload', onPreventUnload)
    close()
    return promise
  }

  function createCard(mesaId: MesaId, cardId: CardId, popups: Set<BrowserWindow> = new Set()): LoadedCard {
    const view = new WebContentsView({
      webPreferences: {
        partition: SURFACE_PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    view.setBackgroundColor('#ffffff')
    view.setVisible(false)
    view.setBounds(bounds)
    window.contentView.addChildView(view)
    const card: LoadedCard = {
      mesaId,
      cardId,
      view,
      popups,
      state: {
        cardId,
        status: 'loading',
        entered: false,
        currentUrl: null,
        title: null,
        loadMs: null,
        error: null,
      },
      loadStartedAt: null,
    }
    attachListeners(card)
    cards.set(cardId, card)
    return card
  }

  function attachListeners(card: LoadedCard): void {
    const contents = card.view.webContents
    guardNavigation(contents, window, popup => {
      // El conjunto (no la tarjeta) se captura: sobrevive a una vista recreada.
      const popups = card.popups
      popups.add(popup)
      popup.once('closed', () => popups.delete(popup))
    })
    attachContextMenu(contents)

    contents.on('before-input-event', (event, input) => {
      if (isExitShortcut(input, process.platform)) {
        event.preventDefault()
        void manager.exit()
      }
    })

    contents.on('did-start-loading', () => update(card, { status: 'loading', error: null }))
    contents.on('did-stop-loading', () => {
      if (card.loadStartedAt !== null) {
        const loadMs = Math.round(performance.now() - card.loadStartedAt)
        card.loadStartedAt = null
        log('load-finished', { origin: cardOrigin(card), loadMs })
        // Un fallo de carga previo se conserva: solo se anota la duración.
        update(card, card.state.status === 'failed' ? { loadMs } : { status: 'ready', loadMs })
        return
      }
      if (card.state.status === 'loading') {
        update(card, { status: 'ready' })
      }
    })
    contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      if (!isMainFrame || errorCode === ERR_ABORTED) {
        return
      }
      log('load-failed', { origin: originOf(validatedUrl), errorCode, errorDescription })
      update(card, { status: 'failed', error: `${errorDescription} (${errorCode})` })
    })
    contents.on('did-navigate', (_event, url) => update(card, { currentUrl: url }))
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame) {
        update(card, { currentUrl: url })
      }
    })
    contents.on('page-title-updated', (_event, title) => {
      update(card, { title })
      callbacks.onTitle(card.mesaId, card.cardId, title)
    })
    contents.on('render-process-gone', (_event, details) => {
      log('render-process-gone', { origin: cardOrigin(card), reason: details.reason })
      card.loadStartedAt = null
      if (active === card) {
        active = null
        card.view.setVisible(false)
        if (!window.isDestroyed()) {
          window.webContents.focus()
        }
      }
      update(card, { status: 'failed', entered: false, error: `El proceso de la web terminó: ${details.reason}` })
    })
  }

  function startLoad(card: LoadedCard, url: string): void {
    card.loadStartedAt = performance.now()
    update(card, { status: 'loading', currentUrl: url, error: null, loadMs: null })
    log('surface-load', { origin: originOf(url) })
    // Los fallos se notifican con `did-fail-load`.
    card.view.webContents.loadURL(url).catch(() => undefined)
  }

  /** Retira la vista de la ventana y del registro. Los popups se tratan aparte. */
  function detach(card: LoadedCard): void {
    cards.delete(card.cardId)
    if (active === card) {
      active = null
    }
    if (!window.isDestroyed()) {
      window.contentView.removeChildView(card.view)
    }
  }

  /** Cierre sin `beforeunload`: solo para vistas cuyo proceso ya no existe. */
  function forceClose(card: LoadedCard): void {
    const contents = card.view.webContents
    if (!contents.isDestroyed()) {
      contents.close()
    }
    detach(card)
  }

  /**
   * Cierra los popups de la tarjeta respetando su `beforeunload`, con el
   * mismo flujo que la vista. Solo se destruyen sin preguntar los popups cuyo
   * proceso ya no existe. Se detiene en el primero que el usuario mantiene:
   * `false`. Los cerrados antes no tenían trabajo pendiente o el usuario
   * aceptó descartarlo.
   */
  async function closePopups(card: LoadedCard, reason: CloseReason): Promise<boolean> {
    for (const popup of [...card.popups]) {
      if (popup.isDestroyed()) {
        card.popups.delete(popup)
        continue
      }
      const contents = popup.webContents
      if (contents.isDestroyed() || contents.isCrashed()) {
        popup.destroy()
        card.popups.delete(popup)
        continue
      }
      // `close()` de la ventana dispara `beforeunload` y emite
      // `will-prevent-unload` en su `webContents`, igual que la vista.
      const closed = await closeGuarded(
        contents,
        reason,
        () => popup.close(),
        onGone => {
          popup.once('closed', onGone)
          return () => popup.removeListener('closed', onGone)
        },
      )
      if (!closed) {
        log('popup-kept', { origin: originOf(contents.getURL()), reason })
        return false
      }
      card.popups.delete(popup)
    }
    return true
  }

  /** Cierra la vista respetando `beforeunload`. `true` si quedó cerrada. */
  async function closeView(card: LoadedCard, reason: CloseReason): Promise<boolean> {
    if (!isAlive(card)) {
      forceClose(card)
      return true
    }
    const contents = card.view.webContents
    const closed = await closeGuarded(
      contents,
      reason,
      () => contents.close({ waitForBeforeUnload: true }),
      onGone => {
        contents.once('destroyed', onGone)
        return () => contents.removeListener('destroyed', onGone)
      },
    )
    if (closed) {
      detach(card)
    }
    return closed
  }

  async function capture(card: LoadedCard): Promise<Buffer | null> {
    if (!isAlive(card)) {
      return null
    }
    try {
      const image = await card.view.webContents.capturePage()
      if (image.isEmpty()) {
        return null
      }
      const scaled =
        image.getSize().width > CAPTURE_MAX_WIDTH ? image.resize({ width: CAPTURE_MAX_WIDTH, quality: 'good' }) : image
      return scaled.toJPEG(CAPTURE_JPEG_QUALITY)
    } catch (error) {
      log('capture-failed', { message: error instanceof Error ? error.message : String(error) })
      return null
    }
  }

  async function exitActive(): Promise<void> {
    const card = active
    if (!card) {
      return
    }
    const jpeg = await capture(card)
    // La web pudo terminar o descargarse mientras se capturaba.
    if (active !== card) {
      return
    }
    active = null
    if (!card.view.webContents.isDestroyed()) {
      card.view.setVisible(false)
    }
    if (!window.isDestroyed()) {
      window.webContents.focus()
    }
    update(card, { entered: false })
    if (jpeg) {
      callbacks.onCapture(card.mesaId, card.cardId, jpeg)
    }
    log('surface-exit', { origin: cardOrigin(card), captured: jpeg !== null })
  }

  /**
   * Descarga la tarjeta: primero sus popups y después la vista, todo
   * respetando `beforeunload`. Si el usuario mantiene un popup, la vista
   * sigue cargada y la tarjeta no se toca: `kept`.
   */
  async function unloadCard(card: LoadedCard, reason: CloseReason): Promise<UnloadResult> {
    if (active === card) {
      await exitActive()
    }
    if (!(await closePopups(card, reason)) || !(await closeView(card, reason))) {
      log('surface-kept', { origin: cardOrigin(card), reason })
      return 'kept'
    }
    const origin = cardOrigin(card)
    card.loadStartedAt = null
    update(card, { status: 'unloaded', entered: false, currentUrl: null, error: null })
    log('surface-unloaded', { origin })
    return 'unloaded'
  }

  async function unloadWhere(predicate: (card: LoadedCard) => boolean): Promise<UnloadResult> {
    let result: UnloadResult = 'unloaded'
    for (const card of [...cards.values()]) {
      if (predicate(card) && (await unloadCard(card, 'unload')) === 'kept') {
        result = 'kept'
      }
    }
    return result
  }

  /**
   * Mesa abierta según la última `openMesa` completada sin `kept`. Las
   * entradas se comprueban contra ella al ejecutarse, no al pedirse.
   */
  let openMesaId: MesaId | null = null

  async function enterCard(mesaId: MesaId, cardId: CardId, url: string): Promise<void> {
    if (mesaId !== openMesaId) {
      throw new Error('No se puede entrar: la mesa de la tarjeta ya no está abierta')
    }
    // `will-navigate` no cubre las cargas programáticas: se exige http(s) aquí.
    if (!isHttpUrl(url)) {
      throw new Error('No se puede entrar: la tarjeta no tiene una URL http(s)')
    }
    let card = cards.get(cardId)
    if (card && card.mesaId !== mesaId) {
      throw new Error('La tarjeta pertenece a otra mesa')
    }
    if (active && active !== card) {
      await exitActive()
    }
    if (card && card.state.status === 'failed') {
      if (isAlive(card)) {
        // Fallo de carga con el proceso vivo: se reintenta en la misma vista.
        startLoad(card, url)
      } else {
        // Proceso muerto: vista nueva; sus popups vivos pasan a ella.
        const popups = card.popups
        forceClose(card)
        card = createCard(mesaId, cardId, popups)
        startLoad(card, url)
      }
    }
    if (!card) {
      card = createCard(mesaId, cardId)
      startLoad(card, url)
    }
    active = card
    card.view.setBounds(bounds)
    card.view.setVisible(true)
    card.view.webContents.focus()
    if (!card.state.entered) {
      update(card, { entered: true })
    }
    log('surface-enter', { origin: originOf(card.state.currentUrl ?? url) })
  }

  const manager: SurfaceManager = {
    openMesa(mesaId) {
      return serial(async () => {
        const result = await unloadWhere(card => card.mesaId !== mesaId)
        if (result === 'unloaded') {
          openMesaId = mesaId
        }
        return result
      })
    },

    enter(mesaId, cardId, url) {
      return serial(() => enterCard(mesaId, cardId, url))
    },

    exit() {
      return serial(exitActive)
    },

    unload(cardId) {
      return serial(async () => {
        const card = cards.get(cardId)
        return card ? unloadCard(card, 'unload') : 'unloaded'
      })
    },

    setPanelBounds(panelBounds) {
      bounds = toRectangle(panelBounds)
      if (active && !active.view.webContents.isDestroyed()) {
        active.view.setBounds(bounds)
      }
    },

    getStates() {
      return [...cards.values()].map(card => card.state)
    },

    closeAll() {
      return serial(async () => {
        for (const card of [...cards.values()]) {
          if ((await unloadCard(card, 'quit')) === 'kept') {
            return false
          }
        }
        return true
      })
    },
  }
  return manager
}
