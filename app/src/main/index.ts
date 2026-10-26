import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  net,
  protocol,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CAPTURE_PROTOCOL, IPC } from '../shared/ipc'
import type { MesaId } from '../shared/model'
import { recognizeService } from '../shared/services'
import {
  parseCardPatch,
  parseHttpUrl,
  parseId,
  parseMesaName,
  parsePanelBounds,
  parsePoint,
  parseViewport,
} from '../shared/validate'
import { log } from './log'
import { createMesaStore } from './store/mesaStore'
import type { MesaStore } from './store/types'
import { createSurfaceManager } from './web/surfaceManager'
import type { SurfaceManager } from './web/types'

const devRendererUrl = process.env['ELECTRON_RENDERER_URL']
const rendererFile = join(__dirname, '../renderer/index.html')

protocol.registerSchemesAsPrivileged([{ scheme: CAPTURE_PROTOCOL, privileges: { standard: true, secure: true } }])

let mainWindow: BrowserWindow | null = null
let surface: SurfaceManager | null = null
let store: MesaStore | null = null

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

function registerIpc(): void {
  handle(IPC.mesasList, () => requireStore().list())
  handle(IPC.mesasCreate, name => requireStore().create(parseMesaName(name)))
  handle(IPC.mesasGet, id => requireStore().get(parseId(id)))
  handle(IPC.mesasRename, (id, name) => requireStore().rename(parseId(id), parseMesaName(name)))
  handle(IPC.mesasRemove, async id => {
    const mesaId = parseId(id)
    // Se borra desde el inicio: ninguna web de esa mesa debe quedar cargada.
    if ((await requireSurface().openMesa(null)) === 'kept') {
      throw new Error('Una web de la mesa avisó de cambios sin guardar; no se ha borrado')
    }
    await requireStore().remove(mesaId)
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

  handle(IPC.surfaceOpenMesa, mesaId => requireSurface().openMesa(mesaId === null ? null : parseId(mesaId)))
  handle(IPC.surfaceEnter, async (mesaId, cardId) => {
    const parsedMesa = parseId(mesaId)
    const parsedCard = parseId(cardId)
    const mesa = await requireStore().get(parsedMesa)
    const card = mesa.cards.find(candidate => candidate.id === parsedCard)
    if (!card) {
      throw new Error('La tarjeta no existe')
    }
    await requireSurface().enter(parsedMesa, parsedCard, card.url)
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
      void requireStore()
        .saveCapture(mesaId, cardId, jpeg)
        .then(card => sendToRenderer(IPC.cardChanged, mesaId, card))
        .catch(error => log('capture-save-failed', { message: error instanceof Error ? error.message : String(error) }))
    },
    onTitle: (mesaId: MesaId, cardId, title) => {
      void requireStore()
        .setCardTitle(mesaId, cardId, title)
        .then(card => sendToRenderer(IPC.cardChanged, mesaId, card))
        .catch(error => log('title-save-failed', { message: error instanceof Error ? error.message : String(error) }))
    },
  })
  surface = manager

  let closing = false
  window.on('close', event => {
    if (closing) {
      return
    }
    event.preventDefault()
    void manager.closeAll().then(closed => {
      if (closed && !window.isDestroyed()) {
        closing = true
        window.close()
      }
    })
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

void app.whenReady().then(() => {
  store = createMesaStore(app.getPath('userData'))
  Menu.setApplicationMenu(buildMenu())
  registerCaptureProtocol()
  registerIpc()
  mainWindow = createWindow()
  log('app-ready', { electron: process.versions.electron, chrome: process.versions.chrome })
})
