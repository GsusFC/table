import { dialog, WebContentsView, type BrowserWindow, type Rectangle, type WebContents } from 'electron'
import type { CardId, MesaId } from '../../shared/model'
import type { PanelBounds, SurfaceCardState, UnloadResult } from '../../shared/surface'
import { isHttpUrl } from '../../shared/validate'
import { log, originOf } from '../log'
import { attachContextMenu, configureSurfaceSession, guardNavigation, SURFACE_PARTITION } from './guards'
import { isExitShortcut } from './shortcut'
import type { EnterOptions, SurfaceCallbacks, SurfaceManager } from './types'

const CAPTURE_MAX_WIDTH = 1280
const CAPTURE_JPEG_QUALITY = 72
/** Chromium cancela la carga anterior al navegar: no es un fallo. */
const ERR_ABORTED = -3
/** Espera, sin respuesta de la página, antes de volver a pedir un cierre. */
const CLOSE_SETTLE_MS = 3_000
/** Peticiones de cierre sin respuesta antes de darla por conservada. */
const CLOSE_ATTEMPTS = 3

/** `auto`: descarga automática por límite de webs cargadas; nunca descarta cambios. */
type CloseReason = 'quit' | 'unload' | 'auto'

/**
 * Webs cargadas a la vez (activa incluida). Al entrar en otra, se descarga la
 * menos usada recientemente; si avisa de cambios sin guardar, se queda cargada.
 * Solo para mediciones: `TABLE_MAX_LOADED_WEBS=0` desactiva el límite.
 */
const MAX_LOADED_WEBS = ((): number => {
  const raw = process.env['TABLE_MAX_LOADED_WEBS']
  const parsed = raw === undefined ? Number.NaN : Number(raw)
  if (parsed === 0) {
    return Number.POSITIVE_INFINITY
  }
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 2
})()

/** Web cargada de una tarjeta: su vista, la mesa a la que pertenece y su estado. */
interface LoadedCard {
  readonly mesaId: MesaId
  /**
   * Tarjeta dueña de la vista. Cambia si la vista se cede a otra tarjeta del
   * mismo archivo (T-005); las escuchas lo leen al dispararse.
   */
  cardId: CardId
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
  /** Último momento en que se entró o salió de esta web; para elegir cuál descargar. */
  lastUsedAt: number
  /**
   * Cierre de la vista en curso: su destrucción la gestiona quien cierra. Si
   * la vista desaparece sin él (un cierre que se dio por conservado y llegó
   * tarde), se retira del registro al momento.
   */
  closing: boolean
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
   * Tarjetas en las que trabaja un agente (T-012): su web no se descarga por
   * el límite ni se cede a otra tarjeta del mismo archivo de Figma.
   */
  const pinned = new Set<CardId>()

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
    // Una descarga automática nunca descarta trabajo ni interrumpe con un diálogo.
    if (reason === 'auto') {
      return false
    }
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
   *
   * Chromium puede ignorar un cierre pedido justo después de otro que la página
   * frenó con `beforeunload`: ni avisa ni cierra. Si no pasa nada en
   * CLOSE_SETTLE_MS se vuelve a pedir; tras CLOSE_ATTEMPTS sin respuesta se da
   * por conservada (nunca se descarta sin respuesta) para no bloquear la cola.
   */
  function closeGuarded(
    contents: WebContents,
    reason: CloseReason,
    close: () => void,
    watchGone: (onGone: () => void) => () => void,
  ): Promise<boolean> {
    const { promise, resolve } = Promise.withResolvers<boolean>()
    let attempts = 1
    let timer: NodeJS.Timeout | null = null
    const stopRetrying = (): void => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }
    const onPreventUnload = (event: Electron.Event): void => {
      stopRetrying()
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
      stopRetrying()
      if (!contents.isDestroyed()) {
        contents.removeListener('will-prevent-unload', onPreventUnload)
      }
      resolve(true)
    })
    const retry = (): void => {
      timer = null
      if (contents.isDestroyed()) {
        return
      }
      if (attempts >= CLOSE_ATTEMPTS) {
        log('unload-stalled', { origin: originOf(contents.getURL()), reason })
        contents.removeListener('will-prevent-unload', onPreventUnload)
        stopWatching()
        resolve(false)
        return
      }
      attempts += 1
      timer = setTimeout(retry, CLOSE_SETTLE_MS)
      close()
    }
    contents.on('will-prevent-unload', onPreventUnload)
    timer = setTimeout(retry, CLOSE_SETTLE_MS)
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
      lastUsedAt: performance.now(),
      closing: false,
    }
    attachListeners(card)
    cards.set(cardId, card)
    callbacks.onContents?.(view.webContents)
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
    contents.once('destroyed', () => onViewGone(card))
  }

  /**
   * La vista desapareció sin un cierre en curso: la tarjeta queda descargada
   * y no se vuelve a usar una vista destruida.
   */
  function onViewGone(card: LoadedCard): void {
    if (card.closing || cards.get(card.cardId) !== card) {
      return
    }
    const origin = cardOrigin(card)
    const wasActive = active === card
    detach(card)
    if (wasActive && !window.isDestroyed()) {
      window.webContents.focus()
    }
    card.loadStartedAt = null
    update(card, { status: 'unloaded', entered: false, currentUrl: null, error: null })
    log('surface-gone', { origin })
  }

  /** Estado y registro de una carga que empieza; la navegación la inicia quien llama. */
  function markLoadStarted(card: LoadedCard, url: string): void {
    card.loadStartedAt = performance.now()
    update(card, { status: 'loading', currentUrl: url, error: null, loadMs: null })
    log('surface-load', { origin: originOf(url) })
  }

  function startLoad(card: LoadedCard, url: string): void {
    markLoadStarted(card, url)
    // Los fallos se notifican con `did-fail-load`.
    card.view.webContents.loadURL(url).catch(() => undefined)
  }

  /**
   * Web viva de otra tarjeta de la mesa cuya URL comparte clave con `url`
   * (mismo archivo de Figma); la usada más recientemente, o null.
   */
  function findDonor(mesaId: MesaId, url: string): LoadedCard | null {
    const key = callbacks.shareKey(url)
    if (key === null) {
      return null
    }
    let donor: LoadedCard | null = null
    for (const candidate of cards.values()) {
      const candidateUrl = candidate.state.currentUrl
      if (
        candidate.mesaId === mesaId &&
        candidateUrl !== null &&
        isAlive(candidate) &&
        // La web en la que trabaja un agente no se cede: la otra tarjeta carga su propio editor.
        !pinned.has(candidate.cardId) &&
        callbacks.shareKey(candidateUrl) === key &&
        (!donor || candidate.lastUsedAt > donor.lastUsedAt)
      ) {
        donor = candidate
      }
    }
    return donor
  }

  /**
   * Cede la vista de `donor`, con sus popups y escuchas, a `cardId`: sigue
   * siendo una sola web cargada. La tarjeta donante queda descargada. Las
   * escuchas leen `card.cardId` al dispararse, así que desde aquí informan
   * (estado y título) solo de la nueva tarjeta.
   */
  function transfer(donor: LoadedCard, cardId: CardId): LoadedCard {
    const donorId = donor.cardId
    cards.delete(donorId)
    callbacks.onState({ ...donor.state, cardId: donorId, status: 'unloaded', entered: false, currentUrl: null, error: null })
    donor.cardId = cardId
    donor.state = { ...donor.state, cardId, entered: false }
    cards.set(cardId, donor)
    callbacks.onState(donor.state)
    log('surface-shared', { origin: cardOrigin(donor) })
    return donor
  }

  /**
   * Comparte con `cardId` la web de `donor` y la lleva a `url`. La cesión solo
   * se hace si la navegación sigue adelante: `did-start-navigation` llega
   * después de `beforeunload`, y en ese momento (antes de cualquier evento de
   * la nueva carga) la vista pasa a `cardId`. Si la página frena la
   * navegación con `beforeunload` (o se cancela por otro motivo), no se
   * descarta nada: `donor` sigue siendo la dueña, con su página y su estado,
   * y se muestra ella; volver a entrar en `cardId` lo intenta de nuevo.
   * Devuelve la tarjeta que se muestra, o null si la vista ya no existe.
   */
  async function shareView(donor: LoadedCard, cardId: CardId, url: string): Promise<LoadedCard | null> {
    if (donor.state.currentUrl === url) {
      return transfer(donor, cardId)
    }
    const contents = donor.view.webContents
    const { status, error } = donor.state
    const { promise, resolve } = Promise.withResolvers<boolean>()
    const onStartNavigation = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>): void => {
      // Sin iniciador: la navegación de `loadURL`, no una de la propia página.
      if (!details.isMainFrame || details.initiator) {
        return
      }
      contents.removeListener('did-start-navigation', onStartNavigation)
      markLoadStarted(transfer(donor, cardId), url)
      resolve(true)
    }
    contents.on('did-start-navigation', onStartNavigation)
    // Sin `preventDefault` en `will-prevent-unload`, Electron cancela la navegación
    // y `loadURL` termina sin haberla empezado.
    void contents
      .loadURL(url)
      .catch(() => undefined)
      .finally(() => {
        if (!contents.isDestroyed()) {
          contents.removeListener('did-start-navigation', onStartNavigation)
        }
        resolve(false)
      })
    if (await promise) {
      return donor
    }
    if (!isAlive(donor) || cards.get(donor.cardId) !== donor) {
      return null
    }
    // `did-start-loading` ya se emitió para la navegación cancelada.
    update(donor, { status, error })
    log('surface-navigation-kept', { origin: cardOrigin(donor) })
    return donor
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
    card.closing = true
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
    card.closing = true
    const closed = await closeGuarded(
      contents,
      reason,
      () => contents.close({ waitForBeforeUnload: true }),
      onGone => {
        contents.once('destroyed', onGone)
        return () => contents.removeListener('destroyed', onGone)
      },
    ).finally(() => {
      card.closing = false
    })
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
    card.lastUsedAt = performance.now()
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

  /** Vuelve a cargar una tarjeta cuya carga falló o cuyo proceso terminó; la devuelve (quizá una vista nueva). */
  function revive(mesaId: MesaId, card: LoadedCard, url: string): LoadedCard {
    if (isAlive(card)) {
      // Fallo de carga con el proceso vivo: se reintenta en la misma vista.
      startLoad(card, url)
      return card
    }
    // Proceso muerto: vista nueva; sus popups vivos pasan a ella.
    const popups = card.popups
    forceClose(card)
    const fresh = createCard(mesaId, card.cardId, popups)
    startLoad(fresh, url)
    return fresh
  }

  async function enterCard(mesaId: MesaId, cardId: CardId, url: string, options: EnterOptions): Promise<void> {
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
    // Una vista destruida o caída nunca se reutiliza.
    if (card && (card.state.status === 'failed' || !isAlive(card))) {
      card = revive(mesaId, card, url)
    } else if (card && options.shouldNavigate?.(card.state.currentUrl)) {
      // Seguir al agente a un nodo de Figma: si la página avisa de cambios sin guardar, Electron no navega.
      card.view.webContents.loadURL(url).catch(() => undefined)
    }
    if (!card) {
      // Tarjetas del mismo archivo de Figma comparten un único editor (T-005).
      const donor = findDonor(mesaId, url)
      const shared = donor ? await shareView(donor, cardId, url) : null
      if (shared) {
        card = shared
      } else {
        card = createCard(mesaId, cardId)
        startLoad(card, url)
      }
    }
    active = card
    card.lastUsedAt = performance.now()
    card.view.setBounds(bounds)
    card.view.setVisible(true)
    // Al seguir al agente, el foco se queda donde estaba (la terminal, por ejemplo).
    if (options.focus) {
      card.view.webContents.focus()
    }
    if (!card.state.entered) {
      update(card, { entered: true })
    }
    log('surface-enter', { origin: originOf(card.state.currentUrl ?? url) })
    await enforceLoadedLimit()
  }

  /**
   * Web de una tarjeta para el agente (T-012): la carga si hace falta, sin
   * mostrarla ni sacar a la persona de donde esté. La tarjeta tiene que
   * estar fijada (`pin`) antes, para que el límite de webs no la descargue.
   */
  async function loadForAgent(mesaId: MesaId, cardId: CardId, url: string): Promise<WebContents> {
    if (mesaId !== openMesaId) {
      throw new Error('La mesa de esta sesión no está abierta en Table: la persona tiene que abrirla para que uses sus webs')
    }
    if (!isHttpUrl(url)) {
      throw new Error('La tarjeta no tiene una URL http(s)')
    }
    let card = cards.get(cardId)
    if (card && card.mesaId !== mesaId) {
      throw new Error('La tarjeta pertenece a otra mesa')
    }
    if (card && (card.state.status === 'failed' || !isAlive(card))) {
      card = revive(mesaId, card, url)
    }
    if (!card) {
      const donor = findDonor(mesaId, url)
      if (donor && donor === active) {
        // Cederla cambiaría lo que la persona tiene delante.
        throw new Error(
          `La persona está usando el editor de este archivo de Figma en otra tarjeta (${donor.cardId}): usa esa tarjeta o espera a que vuelva al lienzo`,
        )
      }
      const shared = donor ? await shareView(donor, cardId, url) : null
      if (shared && shared.cardId !== cardId) {
        throw new Error('El editor de este archivo de Figma avisa de cambios sin guardar: no se cambia de frame sin que la persona lo resuelva')
      }
      if (shared) {
        card = shared
      } else {
        card = createCard(mesaId, cardId)
        startLoad(card, url)
      }
    }
    card.lastUsedAt = performance.now()
    log('surface-agent-load', { origin: originOf(card.state.currentUrl ?? url) })
    await enforceLoadedLimit()
    return card.view.webContents
  }

  /** Descarga las webs menos usadas hasta quedar en MAX_LOADED_WEBS, sin tocar la activa ni las fijadas. */
  async function enforceLoadedLimit(): Promise<void> {
    const candidates = [...cards.values()]
      .filter(card => card !== active && !pinned.has(card.cardId))
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt)
    for (const card of candidates) {
      if (cards.size <= MAX_LOADED_WEBS) {
        return
      }
      const origin = cardOrigin(card)
      const result = await unloadCard(card, 'auto')
      log(result === 'unloaded' ? 'surface-auto-unloaded' : 'surface-auto-kept', { origin })
    }
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

    enter(mesaId, cardId, url, options = {}) {
      return serial(() => enterCard(mesaId, cardId, url, { ...options, focus: options.focus ?? true }))
    },

    loadForAgent(mesaId, cardId, url) {
      return serial(() => loadForAgent(mesaId, cardId, url))
    },

    loadedContents(cardId) {
      const card = cards.get(cardId)
      return card && isAlive(card) ? card.view.webContents : null
    },

    pin(cardId) {
      pinned.add(cardId)
    },

    unpin(cardId) {
      if (pinned.delete(cardId)) {
        void serial(enforceLoadedLimit)
      }
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
      for (const card of cards.values()) {
        // La activa y las del agente (ocultas) tienen el tamaño del panel: lo que ve el agente es lo que vería la persona.
        if ((card === active || pinned.has(card.cardId)) && !card.view.webContents.isDestroyed()) {
          card.view.setBounds(bounds)
        }
      }
    },

    getOpenMesa() {
      return openMesaId
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
