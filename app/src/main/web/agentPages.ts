import type { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { log, originOf } from '../log'
import { navigationPolicy } from './navigationPolicy'
import { evaluate, type Cdp } from './webDriver'

/**
 * La web de una tarjeta vista por el agente (T-012): el protocolo de DevTools
 * de `webContents.debugger` sobre la `WebContentsView` de la tarjeta (nunca
 * sobre la interfaz de Table), más lo que Electron da sin depurador
 * (consola, capturas, navegación).
 *
 * Una vista oculta (cargada pero sin mostrar) sigue funcionando para el
 * agente: la entrada por el protocolo llega igual, la captura usa
 * `capturePage` con `stayHidden` (Chromium pinta un fotograma sin hacerla
 * visible) y, mientras el agente la usa, no se frenan sus temporizadores
 * (`setBackgroundThrottling(false)`); al soltarla vuelve a frenarse.
 */

/** Hosts de las webs locales: solo en ellas el agente ejecuta JavaScript y lee la consola. */
const LOCAL_HOSTS: Readonly<Record<string, true>> = { localhost: true, '127.0.0.1': true, '[::1]': true }

export function isLocalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && LOCAL_HOSTS[parsed.hostname] === true
  } catch {
    return false
  }
}

/** Mensajes de consola y errores de red que se guardan por web local (los más recientes). */
const MAX_CONSOLE_ENTRIES = 200
const MAX_NETWORK_ERRORS = 100
const MAX_ENTRY_TEXT = 2_000
const CAPTURE_MAX_WIDTH = 1280
const CAPTURE_JPEG_QUALITY = 70
const CAPTURE_TIMEOUT_MS = 8_000
/** Tras un clic o una tecla: espera a ver si empieza una navegación… */
const SETTLE_START_MS = 300
/** …y, si empieza, a que termine de cargar. */
const SETTLE_LOAD_MS = 10_000

export interface ConsoleEntry {
  readonly level: string
  readonly text: string
  readonly source: string
}

export interface NetworkError {
  readonly url: string
  /** Código HTTP, o null si la petición falló sin respuesta. */
  readonly status: number | null
  readonly error: string
}

export type NavigationOutcome = { readonly kind: 'started' } | { readonly kind: 'blocked' } | { readonly kind: 'failed'; readonly error: string }

export interface AgentPage extends Cdp {
  url(): string
  title(): string
  /** Espera a que termine la carga en curso (o se agote `timeoutMs`). */
  waitForLoad(timeoutMs: number, signal: AbortSignal): Promise<void>
  /** Tras una acción: si empieza una navegación, espera a que cargue. */
  settle(signal: AbortSignal): Promise<void>
  /**
   * Navega respetando `beforeunload`: si la página avisa de trabajo sin
   * guardar, Electron cancela la navegación (nada se descarta) y devuelve
   * `blocked`.
   */
  navigate(target: { readonly url: string } | { readonly action: 'back' | 'forward' | 'reload' }): Promise<NavigationOutcome>
  /** JPEG de lo que se ve, como mucho CAPTURE_MAX_WIDTH de ancho; null si no se pudo. */
  capture(): Promise<Buffer | null>
  /** URL de todos los frames del documento (principal e iframes). */
  frameUrls(): string[]
  /**
   * Mientras el agente usa la web, las navegaciones, redirecciones, iframes y
   * popups hacia lo que `blocked` rechaza no se abren (T-012). Se quita al
   * soltar la web (`release`).
   */
  restrict(blocked: (url: string) => boolean): void
  /**
   * `table_web_evaluate`: ejecuta la función en el contexto de JavaScript del
   * documento principal, solo si su origen es local. El contexto se fija por
   * su ID: si la web navega antes de ejecutar, ese contexto desaparece y la
   * ejecución falla en lugar de caer en otro documento.
   */
  evaluateLocal(functionSource: string): Promise<unknown>
  /** Consola desde que cargó la página (solo se guarda en webs locales). */
  consoleEntries(): readonly ConsoleEntry[]
  /** Errores de red desde que el agente usa la web (solo en webs locales). */
  networkErrors(): readonly NetworkError[]
}

/** Contexto de JavaScript de un frame, según el protocolo (`Runtime.executionContextCreated`). */
interface ExecutionContext {
  readonly origin: string
  readonly frameId: string | null
  readonly isDefault: boolean
}

interface Tracked {
  console: ConsoleEntry[]
  network: NetworkError[]
  /** Peticiones en curso → URL, para nombrar las que fallan. */
  requests: Map<string, string>
  /** Contextos de JavaScript vivos (con `Runtime` activado). */
  contexts: Map<number, ExecutionContext>
  attached: boolean
  networkEnabled: boolean
  runtimeEnabled: boolean
}

function clip(text: string): string {
  return text.length > MAX_ENTRY_TEXT ? `${text.slice(0, MAX_ENTRY_TEXT - 1)}…` : text
}

function pushBounded<T>(list: T[], item: T, max: number): void {
  list.push(item)
  if (list.length > max) {
    list.splice(0, list.length - max)
  }
}

export interface AgentPages {
  /** Cada vista de tarjeta al crearse: desde ahí se guarda la consola de las webs locales. */
  track(contents: WebContents): void
  /** La web de una tarjeta para una operación del agente; con `signal` cancelada no envía más comandos. */
  page(contents: WebContents, signal: AbortSignal): AgentPage
  /** El agente dejó de usar la web: se suelta el depurador y vuelve a frenarse oculta. */
  release(contents: WebContents): void
}

export function createAgentPages(): AgentPages {
  const tracked = new WeakMap<WebContents, Tracked>()

  function state(contents: WebContents): Tracked {
    let entry = tracked.get(contents)
    if (!entry) {
      entry = {
        console: [],
        network: [],
        requests: new Map(),
        contexts: new Map(),
        attached: false,
        networkEnabled: false,
        runtimeEnabled: false,
      }
      tracked.set(contents, entry)
      watch(contents, entry)
    }
    return entry
  }

  function watch(contents: WebContents, entry: Tracked): void {
    contents.on('console-message', event => {
      const frameUrl = event.frame?.url ?? contents.getURL()
      if (isLocalUrl(frameUrl)) {
        pushBounded(
          entry.console,
          { level: event.level, text: clip(event.message), source: `${clip(event.sourceId)}:${event.lineNumber}` },
          MAX_CONSOLE_ENTRIES,
        )
      }
    })
    contents.on('did-navigate', () => {
      // Una página nueva: la consola y los errores de red son los suyos.
      entry.console = []
      entry.network = []
      entry.requests.clear()
      void syncNetwork(contents, entry)
    })
    contents.debugger.on('detach', (_event, reason) => {
      entry.attached = false
      entry.networkEnabled = false
      entry.runtimeEnabled = false
      entry.contexts.clear()
      log('agent-web-detached', { reason })
    })
    contents.debugger.on('message', (_event, method, params) => {
      if (method === 'Network.requestWillBeSent') {
        entry.requests.set(params.requestId, params.request.url)
      } else if (method === 'Network.responseReceived' && params.response.status >= 400) {
        pushBounded(
          entry.network,
          { url: clip(params.response.url), status: params.response.status, error: clip(params.response.statusText || 'HTTP') },
          MAX_NETWORK_ERRORS,
        )
      } else if (method === 'Network.loadingFailed') {
        if (!params.canceled) {
          pushBounded(
            entry.network,
            { url: clip(entry.requests.get(params.requestId) ?? ''), status: null, error: clip(params.errorText) },
            MAX_NETWORK_ERRORS,
          )
        }
        entry.requests.delete(params.requestId)
      } else if (method === 'Network.loadingFinished') {
        entry.requests.delete(params.requestId)
      } else if (method === 'Runtime.executionContextCreated') {
        const { id, origin, auxData } = params.context
        entry.contexts.set(id, { origin, frameId: auxData?.frameId ?? null, isDefault: auxData?.isDefault === true })
      } else if (method === 'Runtime.executionContextDestroyed') {
        entry.contexts.delete(params.executionContextId)
      } else if (method === 'Runtime.executionContextsCleared') {
        entry.contexts.clear()
      }
    })
  }

  /** Errores de red solo en webs locales: en las demás no se piden eventos de red. */
  async function syncNetwork(contents: WebContents, entry: Tracked): Promise<void> {
    if (!entry.attached || contents.isDestroyed()) {
      return
    }
    const wanted = isLocalUrl(contents.getURL())
    if (wanted === entry.networkEnabled) {
      return
    }
    entry.networkEnabled = wanted
    await contents.debugger.sendCommand(wanted ? 'Network.enable' : 'Network.disable').catch(() => undefined)
  }

  async function attach(contents: WebContents, entry: Tracked): Promise<void> {
    if (entry.attached && contents.debugger.isAttached()) {
      return
    }
    if (contents.isDestroyed()) {
      throw new Error('La web de la tarjeta ya no está cargada')
    }
    try {
      contents.debugger.attach('1.3')
    } catch (error) {
      log('agent-web-attach-failed', { origin: originOf(contents.getURL()), message: error instanceof Error ? error.message : String(error) })
      throw new Error(
        'Table no puede controlar esta web: tiene abiertas las herramientas de desarrollo u otro depurador. Ciérralas y vuelve a intentarlo.',
      )
    }
    entry.attached = true
    entry.networkEnabled = false
    // La página se comporta como enfocada aunque la persona esté en otra parte de Table.
    await contents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined)
    // Oculta, sus temporizadores no se frenan mientras el agente la usa.
    contents.setBackgroundThrottling(false)
    await syncNetwork(contents, entry)
    log('agent-web-attached', { origin: originOf(contents.getURL()) })
  }

  /**
   * Espera a `event` (o a que se agote el tiempo, se cancele o la web
   * desaparezca). Todas las escuchas y el temporizador se retiran al terminar.
   */
  function waitForEvent(contents: WebContents, event: 'did-stop-loading' | 'did-start-loading', timeoutMs: number, signal: AbortSignal): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>()
    if (contents.isDestroyed() || signal.aborted) {
      resolve()
      return promise
    }
    // Las escuchas son de JavaScript (EventEmitter): se pueden quitar también con la web ya destruida.
    const emitter: EventEmitter = contents
    const done = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      emitter.removeListener(event, done)
      emitter.removeListener('destroyed', done)
      resolve()
    }
    const timer = setTimeout(done, timeoutMs)
    signal.addEventListener('abort', done, { once: true })
    emitter.on(event, done)
    emitter.on('destroyed', done)
    return promise
  }

  function waitForLoad(contents: WebContents, timeoutMs: number, signal: AbortSignal): Promise<void> {
    // Sin URL todavía: la primera carga acaba de pedirse y aún no ha empezado.
    if (contents.isDestroyed() || (!contents.isLoading() && contents.getURL() !== '')) {
      return Promise.resolve()
    }
    return waitForEvent(contents, 'did-stop-loading', timeoutMs, signal)
  }

  return {
    track(contents) {
      state(contents)
    },

    page(contents, signal) {
      const entry = state(contents)
      const send = async <T>(method: string, params?: Record<string, unknown>): Promise<T> => {
        // Sesión cerrada o petición cancelada: ni un comando más (ni volver a enganchar el depurador).
        signal.throwIfAborted()
        await attach(contents, entry)
        signal.throwIfAborted()
        return (await contents.debugger.sendCommand(method, params)) as T
      }
      return {
        send,

        url: () => (contents.isDestroyed() ? '' : contents.getURL()),
        title: () => (contents.isDestroyed() ? '' : contents.getTitle()),

        waitForLoad: (timeoutMs, signal) => waitForLoad(contents, timeoutMs, signal),

        async settle(signal) {
          if (contents.isDestroyed()) {
            return
          }
          if (!contents.isLoading()) {
            await waitForEvent(contents, 'did-start-loading', SETTLE_START_MS, signal)
          }
          await waitForLoad(contents, SETTLE_LOAD_MS, signal)
        },

        async navigate(target) {
          if (contents.isDestroyed()) {
            return { kind: 'failed', error: 'La web de la tarjeta ya no está cargada' }
          }
          let blocked = false
          // Sin `preventDefault`, Electron cancela la navegación: el trabajo pendiente se conserva.
          const onPrevent = (): void => {
            blocked = true
          }
          contents.on('will-prevent-unload', onPrevent)
          try {
            if ('url' in target) {
              const loading = contents.loadURL(target.url).then(
                () => null,
                (error: unknown) => (error instanceof Error ? error.message : String(error)),
              )
              // Una web pesada puede tardar en cargar: basta con que la navegación empiece.
              const { promise: started, resolve: onStarted } = Promise.withResolvers<null>()
              const onStart = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>): void => {
                if (details.isMainFrame && !details.isSameDocument) {
                  onStarted(null)
                }
              }
              contents.on('did-start-navigation', onStart)
              const error = await Promise.race([loading, started]).finally(() => {
                if (!contents.isDestroyed()) {
                  contents.removeListener('did-start-navigation', onStart)
                }
              })
              if (blocked) {
                return { kind: 'blocked' }
              }
              return error === null || /ERR_ABORTED/.test(error) ? { kind: 'started' } : { kind: 'failed', error }
            }
            const history = contents.navigationHistory
            if (target.action === 'back' && !history.canGoBack()) {
              return { kind: 'failed', error: 'No hay página anterior' }
            }
            if (target.action === 'forward' && !history.canGoForward()) {
              return { kind: 'failed', error: 'No hay página siguiente' }
            }
            const { promise, resolve } = Promise.withResolvers<void>()
            const timer = setTimeout(resolve, 2_000)
            const onStart = (): void => {
              clearTimeout(timer)
              resolve()
            }
            contents.once('did-start-loading', onStart)
            if (target.action === 'back') {
              history.goBack()
            } else if (target.action === 'forward') {
              history.goForward()
            } else {
              contents.reload()
            }
            await promise
            if (!contents.isDestroyed()) {
              contents.removeListener('did-start-loading', onStart)
            }
            return blocked ? { kind: 'blocked' } : { kind: 'started' }
          } finally {
            if (!contents.isDestroyed()) {
              contents.removeListener('will-prevent-unload', onPrevent)
            }
          }
        },

        async capture() {
          if (contents.isDestroyed()) {
            return null
          }
          let image: Electron.NativeImage | null = null
          try {
            const { promise: timeout, resolve: onTimeout } = Promise.withResolvers<null>()
            const timer = setTimeout(() => onTimeout(null), CAPTURE_TIMEOUT_MS)
            image = await Promise.race([contents.capturePage(undefined, { stayHidden: true }), timeout]).finally(() => clearTimeout(timer))
          } catch (error) {
            log('agent-capture-failed', { message: error instanceof Error ? error.message : String(error) })
          }
          if (!image || image.isEmpty()) {
            return null
          }
          const scaled = image.getSize().width > CAPTURE_MAX_WIDTH ? image.resize({ width: CAPTURE_MAX_WIDTH, quality: 'good' }) : image
          return scaled.toJPEG(CAPTURE_JPEG_QUALITY)
        },

        frameUrls: () => (contents.isDestroyed() ? [] : contents.mainFrame.framesInSubtree.map(frame => frame.url)),

        restrict(blocked) {
          navigationPolicy(contents).blocked = blocked
        },

        async evaluateLocal(functionSource) {
          if (!entry.runtimeEnabled || !contents.debugger.isAttached()) {
            // Al activarlo, el protocolo anuncia los contextos que ya existen.
            await send('Runtime.enable')
            entry.runtimeEnabled = true
          }
          const { frameTree } = await send<{ frameTree: { frame: { id: string } } }>('Page.getFrameTree')
          const found = [...entry.contexts.entries()].find(
            ([, context]) => context.isDefault && context.frameId === frameTree.frame.id,
          )
          if (!found || !isLocalUrl(`${found[1].origin}/`)) {
            throw new Error('La web ya no es local (o está cargando): no se ejecuta JavaScript. Mira dónde está con table_web_snapshot.')
          }
          return evaluate({ send }, functionSource, found[0])
        },

        consoleEntries: () => [...entry.console],
        networkErrors: () => [...entry.network],
      }
    },

    release(contents) {
      const entry = tracked.get(contents)
      if (!entry || contents.isDestroyed()) {
        return
      }
      // Sin agente, la persona vuelve a navegar como siempre.
      navigationPolicy(contents).blocked = null
      if (entry.attached && contents.debugger.isAttached()) {
        contents.debugger.detach()
      }
      entry.attached = false
      entry.networkEnabled = false
      entry.runtimeEnabled = false
      entry.contexts.clear()
      contents.setBackgroundThrottling(true)
    },
  }
}
