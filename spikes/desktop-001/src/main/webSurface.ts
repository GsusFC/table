import {
  dialog,
  session,
  WebContentsView,
  type BrowserWindow,
  type BrowserWindowConstructorOptions,
  type Rectangle,
  type WebContents,
} from 'electron'
import type { SurfaceBounds, SurfaceState } from '../shared/ipc'
import { isExitShortcut } from '../shared/shortcut'
import { isHttpUrl } from '../shared/validate'
import { log, originOf } from './log'

export const SURFACE_PARTITION = 'persist:table-t001'
const CAPTURE_MAX_WIDTH = 1280
const CAPTURE_JPEG_QUALITY = 72
/** Chromium cancela la carga anterior al navegar: no es un fallo. */
const ERR_ABORTED = -3

const INITIAL_STATE: SurfaceState = {
  status: 'empty',
  entered: false,
  url: null,
  title: null,
  zoomFactor: 1,
  captureDataUrl: null,
  error: null,
  lastPopup: null,
}

let sessionConfigured = false

/**
 * Incremento B: cada permiso se pregunta al usuario y la decisión se recuerda
 * por origen hasta cerrar Table. Las descargas siguen bloqueadas.
 */
function configureSurfaceSession(window: BrowserWindow): void {
  if (sessionConfigured) {
    return
  }
  sessionConfigured = true
  const surfaceSession = session.fromPartition(SURFACE_PARTITION)
  const decisions = new Map<string, boolean>()
  const reportedChecks = new Set<string>()

  surfaceSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const origin = originOf(details.requestingUrl)
    const key = `${origin}|${permission}`
    const remembered = decisions.get(key)
    if (remembered !== undefined) {
      callback(remembered)
      return
    }
    void dialog
      .showMessageBox(window, {
        type: 'question',
        buttons: ['Denegar', 'Permitir'],
        defaultId: 0,
        cancelId: 0,
        message: `${origin} solicita el permiso «${permission}».`,
        detail: 'La decisión se recuerda para este origen hasta cerrar Table.',
      })
      .then(({ response }) => {
        const granted = response === 1
        decisions.set(key, granted)
        log('permission-request', { permission, origin, granted })
        callback(granted)
      })
  })
  surfaceSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    const granted = decisions.get(`${requestingOrigin}|${permission}`) ?? false
    const key = `${requestingOrigin}|${permission}|${granted}`
    if (!reportedChecks.has(key)) {
      reportedChecks.add(key)
      log('permission-check', { permission, origin: requestingOrigin, granted })
    }
    return granted
  })
  surfaceSession.on('will-download', (event, item) => {
    log('download-blocked', { origin: originOf(item.getURL()) })
    event.preventDefault()
  })
}

/** Popups de login: ventana real hija, con `window.opener` y la misma sesión. */
function popupWindowOptions(parent: BrowserWindow): BrowserWindowConstructorOptions {
  return {
    parent,
    width: 520,
    height: 720,
    autoHideMenuBar: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  }
}

export class WebSurface {
  private view: WebContentsView | null = null
  private bounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 }
  private state: SurfaceState = INITIAL_STATE
  private exiting = false

  constructor(
    private readonly window: BrowserWindow,
    private readonly publish: (state: SurfaceState) => void,
  ) {}

  getState(): SurfaceState {
    return this.state
  }

  getBounds(): SurfaceBounds {
    return this.bounds
  }

  /** Solo para el smoke. */
  getView(): WebContentsView | null {
    return this.view
  }

  /**
   * Reutiliza la vista existente. Limitación del incremento A: navegar desde la
   * barra no consulta `beforeunload`; el cierre seguro corresponde al incremento C.
   */
  open(url: string): void {
    const view = this.view ?? this.createView()
    this.update({ status: 'loading', url, title: null, error: null, lastPopup: null })
    log('surface-open', { origin: originOf(url) })
    // Los fallos se notifican con `did-fail-load`.
    view.webContents.loadURL(url).catch(() => undefined)
  }

  enter(): void {
    const view = this.view
    if (!view || this.state.entered || this.exiting) {
      return
    }
    view.setBounds(this.bounds)
    view.setVisible(true)
    view.webContents.focus()
    this.update({ entered: true })
    log('surface-enter')
  }

  async exit(): Promise<void> {
    const view = this.view
    if (!view || !this.state.entered || this.exiting) {
      return
    }
    this.exiting = true
    try {
      const captureDataUrl = await this.capture(view)
      if (view.webContents.isDestroyed()) {
        return
      }
      view.setVisible(false)
      this.window.webContents.focus()
      this.update({ entered: false, captureDataUrl })
      log('surface-exit', { captured: captureDataUrl !== null })
    } finally {
      this.exiting = false
    }
  }

  setBounds(bounds: SurfaceBounds): void {
    this.bounds = { ...bounds }
    this.view?.setBounds(this.bounds)
  }

  setZoom(factor: number): void {
    if (!this.view) {
      throw new Error('No hay ninguna web abierta')
    }
    this.view.webContents.setZoomFactor(factor)
    this.update({ zoomFactor: factor })
  }

  hasLiveContent(): boolean {
    return this.view !== null && !this.view.webContents.isDestroyed()
  }

  /**
   * Cierra la web respetando `beforeunload`. Si la página avisa de trabajo
   * pendiente, el usuario decide; Table no descarta cambios por su cuenta.
   * Resuelve `false` si el usuario cancela.
   */
  closeRespectingUnload(): Promise<boolean> {
    const view = this.view
    if (!view || view.webContents.isDestroyed()) {
      this.detach()
      return Promise.resolve(true)
    }
    const contents = view.webContents
    const { promise, resolve } = Promise.withResolvers<boolean>()
    const onPreventUnload = (event: Electron.Event): void => {
      const choice = dialog.showMessageBoxSync(this.window, {
        type: 'warning',
        buttons: ['Cancelar', 'Salir sin guardar'],
        defaultId: 0,
        cancelId: 0,
        message: 'La web avisa de trabajo sin guardar.',
        detail: 'Table no puede comprobar si el cambio se ha guardado. Si sales ahora, puede perderse.',
      })
      log('unload-prevented', { leave: choice === 1 })
      if (choice === 1) {
        event.preventDefault()
        return
      }
      contents.removeListener('will-prevent-unload', onPreventUnload)
      contents.removeListener('destroyed', onDestroyed)
      resolve(false)
    }
    const onDestroyed = (): void => {
      contents.removeListener('will-prevent-unload', onPreventUnload)
      this.detach()
      resolve(true)
    }
    contents.on('will-prevent-unload', onPreventUnload)
    contents.once('destroyed', onDestroyed)
    contents.close({ waitForBeforeUnload: true })
    return promise
  }

  /**
   * Navegación limitada a http(s). Los popups http(s) o `about:blank` se abren
   * como ventana hija real, con la misma sesión, para no romper logins que
   * usan `window.opener`. Cada popup recibe las mismas restricciones.
   */
  private guardNavigation(contents: WebContents): void {
    contents.setWindowOpenHandler(({ url }) => {
      const opened = url === 'about:blank' || isHttpUrl(url)
      const origin = isHttpUrl(url) ? originOf(url) : `${url.split(':', 1)[0]}:`
      log(opened ? 'popup-opened' : 'popup-blocked', { origin })
      this.update({ lastPopup: { origin, opened } })
      return opened
        ? { action: 'allow', overrideBrowserWindowOptions: popupWindowOptions(this.window) }
        : { action: 'deny' }
    })
    contents.on('did-create-window', popup => {
      this.guardNavigation(popup.webContents)
      popup.once('closed', () => log('popup-closed'))
    })

    const allowOnlyWeb = (event: { preventDefault(): void; url: string }): void => {
      if (!isHttpUrl(event.url)) {
        log('navigation-blocked', { scheme: event.url.split(':', 1)[0] })
        event.preventDefault()
      }
    }
    contents.on('will-navigate', allowOnlyWeb)
    contents.on('will-redirect', allowOnlyWeb)
  }

  private createView(): WebContentsView {
    configureSurfaceSession(this.window)
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
    view.setBounds(this.bounds)
    this.window.contentView.addChildView(view)
    this.guard(view.webContents)
    this.view = view
    return view
  }

  private detach(): void {
    const view = this.view
    if (!view) {
      return
    }
    this.view = null
    if (!this.window.isDestroyed()) {
      this.window.contentView.removeChildView(view)
    }
    this.update(INITIAL_STATE)
  }

  private guard(contents: WebContents): void {
    this.guardNavigation(contents)

    contents.on('before-input-event', (event, input) => {
      if (isExitShortcut(input, process.platform)) {
        event.preventDefault()
        void this.exit()
      }
    })

    contents.on('did-start-loading', () => this.update({ status: 'loading', error: null }))
    contents.on('did-stop-loading', () => {
      if (this.state.status === 'loading') {
        this.update({ status: 'ready' })
      }
    })
    contents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
      if (!isMainFrame || errorCode === ERR_ABORTED) {
        return
      }
      log('load-failed', { errorCode, errorDescription })
      this.update({ status: 'failed', error: `${errorDescription} (${errorCode})` })
    })
    contents.on('did-navigate', (_event, url) => this.update({ url }))
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame) {
        this.update({ url })
      }
    })
    contents.on('page-title-updated', (_event, title) => this.update({ title }))
    contents.on('render-process-gone', (_event, details) => {
      log('render-process-gone', { reason: details.reason })
      this.update({ status: 'failed', entered: false, error: `El proceso de la web terminó: ${details.reason}` })
    })
  }

  private async capture(view: WebContentsView): Promise<string | null> {
    try {
      const image = await view.webContents.capturePage()
      if (image.isEmpty()) {
        return null
      }
      const scaled =
        image.getSize().width > CAPTURE_MAX_WIDTH
          ? image.resize({ width: CAPTURE_MAX_WIDTH, quality: 'good' })
          : image
      return `data:image/jpeg;base64,${scaled.toJPEG(CAPTURE_JPEG_QUALITY).toString('base64')}`
    } catch (error) {
      log('capture-failed', { message: error instanceof Error ? error.message : String(error) })
      return null
    }
  }

  private update(partial: Partial<SurfaceState>): void {
    this.state = { ...this.state, ...partial }
    this.publish(this.state)
  }
}
