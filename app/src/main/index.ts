import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  safeStorage,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from 'electron'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CAPTURE_PROTOCOL, IPC, type PersistenceError } from '../shared/ipc'
import type { MesaId } from '../shared/model'
import { recognizeService } from '../shared/services'
import {
  parseCardPatch,
  parseHttpUrl,
  parseId,
  parseMesaName,
  parseNotePatch,
  parsePanelBounds,
  parsePoint,
  parseViewport,
} from '../shared/validate'
import { log } from './log'
import { authorizeNotion, createNotionMcp, NOTION_MCP_URL } from './notion/mcp'
import { createProjectService, type ProjectService } from './notion/projects'
import { createSettingsStore, type SettingsStore } from './settings/settingsStore'
import { runMeasure } from './measure'
import { runSmoke, smokeHooks } from './smoke'
import { createMesaStore } from './store/mesaStore'
import type { MesaStore } from './store/types'
import { createSurfaceManager } from './web/surfaceManager'
import type { SurfaceManager } from './web/types'

const devRendererUrl = process.env['ELECTRON_RENDERER_URL']
const rendererFile = join(__dirname, '../renderer/index.html')

const smokeMode = process.env['TABLE_SMOKE'] === '1'

// El smoke trabaja con datos desechables, nunca con las mesas del usuario.
if (smokeMode) {
  app.setPath('userData', mkdtempSync(join(tmpdir(), 'table-smoke-')))
}

protocol.registerSchemesAsPrivileged([{ scheme: CAPTURE_PROTOCOL, privileges: { standard: true, secure: true } }])

// Una sola instancia: dos procesos sobre el mismo almacén podrían pisarse cambios.
const hasInstanceLock = app.requestSingleInstanceLock()
if (!hasInstanceLock) {
  app.quit()
}

const FLUSH_TIMEOUT_MS = 2_000

let mainWindow: BrowserWindow | null = null
let surface: SurfaceManager | null = null
let store: MesaStore | null = null
let settings: SettingsStore | null = null
let projects: ProjectService | null = null
/** Autorización con Notion en curso (navegador abierto); se puede cancelar. */
let connectingNotion: AbortController | null = null
/** Escrituras iniciadas por el proceso principal (capturas, títulos); se esperan al cerrar. */
const pendingPersistence = new Set<Promise<unknown>>()

function isAppUrl(url: string): boolean {
  try {
    if (devRendererUrl) {
      return new URL(url).origin === new URL(devRendererUrl).origin
    }
    return url.split(/[?#]/, 1)[0] === pathToFileURL(rendererFile).href
  } catch {
    return false
  }
}

/** Solo el documento principal de la interfaz local puede usar la API. */
function isTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame
  const main = mainWindow?.webContents
  return (
    !!main &&
    !!frame &&
    event.sender === main &&
    frame.processId === main.mainFrame.processId &&
    frame.routingId === main.mainFrame.routingId &&
    isAppUrl(frame.url)
  )
}

function requireStore(): MesaStore {
  if (!store) {
    throw new Error('El almacenamiento no está disponible')
  }
  return store
}

function requireSurface(): SurfaceManager {
  if (!surface) {
    throw new Error('La ventana no está disponible')
  }
  return surface
}

function handle(channel: string, run: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!isTrustedSender(event)) {
      log('ipc-rejected', { channel })
      throw new Error('Remitente no autorizado')
    }
    return run(...args)
  })
}

function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

/** Guardados del proceso principal que fallaron desde que empezó el cierre. */
let failuresSinceCloseStarted = 0

/** Sigue una escritura del proceso principal y avisa a la interfaz si falla. */
function persist<T>(operation: Promise<T>, error: PersistenceError, onSaved: (value: T) => void): void {
  const tracked = operation.then(onSaved, (cause: unknown) => {
    failuresSinceCloseStarted += 1
    log('persistence-failed', { operation: error.operation, message: cause instanceof Error ? cause.message : String(cause) })
    sendToRenderer(IPC.persistenceError, error)
  })
  pendingPersistence.add(tracked)
  void tracked.finally(() => pendingPersistence.delete(tracked))
}

let flushCounter = 0

type FlushResult = 'ok' | 'failed' | 'timeout'

/** Pide a la interfaz que guarde lo pendiente; no espera más de FLUSH_TIMEOUT_MS. */
function requestRendererFlush(window: BrowserWindow): Promise<FlushResult> {
  if (window.isDestroyed() || window.webContents.isLoading()) {
    return Promise.resolve('ok')
  }
  flushCounter += 1
  const requestId = flushCounter
  const { promise, resolve } = Promise.withResolvers<FlushResult>()
  const finish = (result: FlushResult): void => {
    clearTimeout(timer)
    ipcMain.removeListener(IPC.appFlushDone, onDone)
    resolve(result)
  }
  const onDone = (event: IpcMainEvent, id: unknown, ok: unknown): void => {
    if (isTrustedSender(event) && id === requestId) {
      finish(ok === true ? 'ok' : 'failed')
    }
  }
  const timer = setTimeout(() => {
    log('renderer-flush-timeout')
    finish('timeout')
  }, FLUSH_TIMEOUT_MS)
  ipcMain.on(IPC.appFlushDone, onDone)
  window.webContents.send(IPC.appFlushRequest, requestId)
  return promise
}

/** Si algo no se pudo guardar, el usuario decide si cerrar. `true` = cerrar. */
function confirmCloseWithUnsaved(window: BrowserWindow, flush: FlushResult): boolean {
  if (flush === 'ok' && failuresSinceCloseStarted === 0) {
    return true
  }
  if (smokeMode) {
    return smokeHooks.confirmCloseWithUnsaved()
  }
  const choice = dialog.showMessageBoxSync(window, {
    type: 'warning',
    buttons: ['Volver a Table', 'Cerrar igualmente'],
    defaultId: 0,
    cancelId: 0,
    message: 'No se han podido guardar todos los cambios.',
    detail:
      flush === 'timeout'
        ? 'La interfaz no confirmó el guardado a tiempo. Si cierras, pueden perderse los últimos cambios.'
        : 'Algún guardado falló. Si cierras, pueden perderse esos cambios.',
  })
  return choice === 1
}

function registerIpc(): void {
  handle(IPC.mesasList, () => requireStore().list())
  handle(IPC.mesasCreate, name => requireStore().create(parseMesaName(name)))
  handle(IPC.mesasGet, id => requireStore().get(parseId(id)))
  handle(IPC.mesasRename, (id, name) => requireStore().rename(parseId(id), parseMesaName(name)))
  handle(IPC.mesasRemove, async id => {
    const mesaId = parseId(id)
    const surfaceManager = requireSurface()
    const previouslyOpen = surfaceManager.getOpenMesa()
    // Ninguna web de la mesa debe quedar cargada al borrarla.
    if ((await surfaceManager.openMesa(null)) === 'kept') {
      throw new Error('Una web de la mesa avisó de cambios sin guardar; no se ha borrado')
    }
    try {
      await requireStore().remove(mesaId)
    } catch (error) {
      // La interfaz sigue mostrando la mesa: la superficie vuelve a tenerla abierta.
      if (previouslyOpen) {
        await surfaceManager.openMesa(previouslyOpen)
      }
      throw error
    }
  })
  handle(IPC.mesasSetViewport, (id, viewport) => requireStore().setViewport(parseId(id), parseViewport(viewport)))

  handle(IPC.cardsAdd, (mesaId, url, position) => {
    const parsedUrl = parseHttpUrl(url)
    return requireStore().addCard(parseId(mesaId), {
      url: parsedUrl,
      serviceId: recognizeService(parsedUrl).id,
      position: parsePoint(position),
    })
  })
  handle(IPC.cardsUpdate, (mesaId, cardId, patch) =>
    requireStore().updateCard(parseId(mesaId), parseId(cardId), parseCardPatch(patch)),
  )
  handle(IPC.cardsRemove, async (mesaId, cardId) => {
    const parsedMesa = parseId(mesaId)
    const parsedCard = parseId(cardId)
    if ((await requireSurface().unload(parsedCard)) === 'kept') {
      return 'kept'
    }
    await requireStore().removeCard(parsedMesa, parsedCard)
    return 'unloaded'
  })

  handle(IPC.notesAdd, (mesaId, position) => requireStore().addNote(parseId(mesaId), parsePoint(position)))
  handle(IPC.notesUpdate, (mesaId, noteId, patch) =>
    requireStore().updateNote(parseId(mesaId), parseId(noteId), parseNotePatch(patch)),
  )
  handle(IPC.notesRemove, (mesaId, noteId) => requireStore().removeNote(parseId(mesaId), parseId(noteId)))
  handle(IPC.edgesAdd, (mesaId, source, target) =>
    requireStore().addEdge(parseId(mesaId), parseId(source), parseId(target)),
  )
  handle(IPC.edgesRemove, (mesaId, edgeId) => requireStore().removeEdge(parseId(mesaId), parseId(edgeId)))

  handle(IPC.surfaceOpenMesa, mesaId => requireSurface().openMesa(mesaId === null ? null : parseId(mesaId)))
  handle(IPC.surfaceEnter, async (mesaId, cardId) => {
    const parsedMesa = parseId(mesaId)
    const parsedCard = parseId(cardId)
    const mesa = await requireStore().get(parsedMesa)
    const card = mesa.cards.find(candidate => candidate.id === parsedCard)
    if (!card) {
      throw new Error('La tarjeta no existe')
    }
    // El almacén ya valida al leer; se vuelve a exigir http(s) antes de cargar.
    await requireSurface().enter(parsedMesa, parsedCard, parseHttpUrl(card.url))
  })
  handle(IPC.surfaceExit, () => requireSurface().exit())
  handle(IPC.surfaceUnload, cardId => requireSurface().unload(parseId(cardId)))
  handle(IPC.surfaceGetStates, () => requireSurface().getStates())

  ipcMain.on(IPC.surfaceSetPanelBounds, (event, bounds: unknown) => {
    if (!isTrustedSender(event)) {
      log('ipc-rejected', { channel: IPC.surfaceSetPanelBounds })
      return
    }
    try {
      surface?.setPanelBounds(parsePanelBounds(bounds))
    } catch (error) {
      log('panel-bounds-rejected', { message: error instanceof Error ? error.message : String(error) })
    }
  })
}

function requireSettings(): SettingsStore {
  if (!settings) {
    throw new Error('Los ajustes no están listos')
  }
  return settings
}

function requireProjects(): ProjectService {
  if (!projects) {
    throw new Error('Notion no está listo')
  }
  return projects
}

/** URL guardada de una tarjeta de Notion; el renderer solo aporta los IDs. */
async function notionCardUrl(mesaId: unknown, cardId: unknown): Promise<string | null> {
  const parsedCard = parseId(cardId)
  const mesa = await requireStore().get(parseId(mesaId))
  const card = mesa.cards.find(candidate => candidate.id === parsedCard)
  if (!card) {
    throw new Error('La tarjeta no existe')
  }
  return card.serviceId === 'notion' ? card.url : null
}

/** Longitud máxima de una búsqueda de proyectos. */
const MAX_PROJECT_QUERY_LENGTH = 200

/** Conexión con Notion y ficha del proyecto (T-003). Las credenciales nunca llegan al renderer. */
function registerNotionIpc(): void {
  handle(IPC.settingsNotion, () => requireSettings().notionView())
  handle(IPC.settingsConnectNotion, async () => {
    if (connectingNotion) {
      throw new Error('Ya hay una conexión con Notion en curso')
    }
    const controller = new AbortController()
    connectingNotion = controller
    try {
      const { connection, identity } = await authorizeNotion(url => shell.openExternal(url), controller.signal)
      await requireSettings().connectNotion(connection, identity)
      log('settings-notion', { action: 'connected' })
      return requireSettings().notionView()
    } finally {
      connectingNotion = null
    }
  })
  handle(IPC.settingsCancelConnectNotion, () => {
    connectingNotion?.abort()
  })
  handle(IPC.settingsDisconnectNotion, async () => {
    await requireSettings().disconnectNotion()
    await requireProjects().clearCache()
    log('settings-notion', { action: 'disconnected' })
    return requireSettings().notionView()
  })
  handle(IPC.notionCachedProject, async (mesaId, cardId) => {
    const url = await notionCardUrl(mesaId, cardId)
    return url ? requireProjects().cached(url) : null
  })
  handle(IPC.notionRefreshProject, async (mesaId, cardId) => {
    const url = await notionCardUrl(mesaId, cardId)
    return url ? requireProjects().refresh(url) : { status: 'not-project' }
  })
  handle(IPC.notionSearchProjects, query => {
    if (typeof query !== 'string' || query.length > MAX_PROJECT_QUERY_LENGTH) {
      throw new Error('Búsqueda no válida')
    }
    return requireProjects().search(query)
  })
}

/** `table-capture://<mesaId>/<cardId>`: capturas guardadas, solo lectura. */
function registerCaptureProtocol(): void {
  protocol.handle(CAPTURE_PROTOCOL, request => {
    try {
      const url = new URL(request.url)
      const mesaId = parseId(url.hostname)
      const cardId = parseId(url.pathname.replace(/^\//, ''))
      const path = requireStore().capturePath(mesaId, cardId)
      if (!path) {
        return new Response(null, { status: 404 })
      }
      return net.fetch(pathToFileURL(path).href)
    } catch {
      return new Response(null, { status: 400 })
    }
  })
}

/**
 * Sin roles de zoom ni atajos propios: las teclas deben llegar a la web
 * (Figma usa ⌘+, ⌘− y Esc). El menú Edición es necesario para copiar y pegar en macOS.
 */
function buildMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]
  if (!app.isPackaged) {
    template.push({ label: 'Desarrollo', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }] })
  }
  return Menu.buildFromTemplate(template)
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: 'Table',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: '#f4f4f3',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  const contents = window.webContents

  // El zoom de la interfaz local descuadraría getBoundingClientRect() frente a setBounds().
  void contents.setVisualZoomLevelLimits(1, 1)
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', event => {
    if (!isAppUrl(event.url)) {
      event.preventDefault()
    }
  })

  const manager = createSurfaceManager(window, {
    onState: state => sendToRenderer(IPC.surfaceState, state),
    onCapture: (mesaId: MesaId, cardId, jpeg) => {
      persist(
        requireStore().saveCapture(mesaId, cardId, jpeg),
        { message: 'No se pudo guardar la captura', mesaId, cardId, operation: 'capture' },
        card => sendToRenderer(IPC.cardChanged, mesaId, card),
      )
    },
    onTitle: (mesaId: MesaId, cardId, title) => {
      persist(
        requireStore().setCardTitle(mesaId, cardId, title),
        { message: 'No se pudo guardar el título', mesaId, cardId, operation: 'title' },
        card => sendToRenderer(IPC.cardChanged, mesaId, card),
      )
    },
    ...(smokeMode ? { confirmDiscard: (origin: string, reason: 'quit' | 'unload') => smokeHooks.confirmDiscard(origin, reason) } : {}),
  })
  surface = manager

  // Cierre coordinado: guardar lo pendiente de la interfaz, descargar las webs
  // respetando `beforeunload` y esperar a que terminen las escrituras.
  let closing = false
  let closeInProgress = false
  window.on('close', event => {
    if (closing) {
      return
    }
    event.preventDefault()
    if (closeInProgress) {
      return
    }
    closeInProgress = true
    void (async () => {
      try {
        failuresSinceCloseStarted = 0
        const flush = await requestRendererFlush(window)
        await Promise.allSettled([...pendingPersistence])
        if (!confirmCloseWithUnsaved(window, flush)) {
          return
        }
        if (!(await manager.closeAll())) {
          return
        }
        // Las capturas tomadas al salir de la última web también se esperan.
        await Promise.allSettled([...pendingPersistence])
        await requireStore().flush()
        closing = true
        if (!window.isDestroyed()) {
          window.close()
        }
      } finally {
        closeInProgress = false
      }
    })()
  })
  window.on('closed', () => {
    mainWindow = null
    surface = null
  })
  window.once('ready-to-show', () => window.show())

  if (devRendererUrl) {
    void window.loadURL(devRendererUrl)
  } else {
    void window.loadFile(rendererFile)
  }
  return window
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', event => event.preventDefault())
})

app.on('window-all-closed', () => app.quit())

app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.focus()
  }
})

void app.whenReady().then(async () => {
  if (!hasInstanceLock) {
    return
  }
  store = createMesaStore(app.getPath('userData'))
  settings = createSettingsStore(app.getPath('userData'), {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: plain => safeStorage.encryptString(plain),
    decrypt: encrypted => safeStorage.decryptString(encrypted),
  })
  // El smoke usa un servidor MCP local con fichas sintéticas en lugar del de Notion.
  const notionMcp = createNotionMcp(settings, () => (smokeMode && smokeHooks.notionMcpUrl) || NOTION_MCP_URL)
  projects = createProjectService(settings, notionMcp, app.getPath('userData'))
  Menu.setApplicationMenu(buildMenu())
  registerCaptureProtocol()
  registerIpc()
  registerNotionIpc()
  const window = createWindow()
  mainWindow = window
  log('app-ready', { electron: process.versions.electron, chrome: process.versions.chrome })
  if (smokeMode && surface) {
    await runSmoke(window, surface, settings)
    return
  }
  const measureFile = process.env['TABLE_MEASURE']
  if (measureFile && surface && store) {
    await runMeasure(window, surface, store, measureFile)
  }
})
