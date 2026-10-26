import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { IPC } from '../shared/ipc'
import { parseBounds, parseHttpUrl, parseZoomFactor } from '../shared/validate'
import { log } from './log'
import { runSmoke } from './smoke'
import { WebSurface } from './webSurface'

const devRendererUrl = process.env['ELECTRON_RENDERER_URL']
const rendererFile = join(__dirname, '../renderer/index.html')
const smokeMode = process.env['TABLE_SPIKE_SMOKE'] === '1'

let mainWindow: BrowserWindow | null = null
let surface: WebSurface | null = null

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

function requireSurface(): WebSurface {
  if (!surface) {
    throw new Error('La ventana no está disponible')
  }
  return surface
}

function handle(channel: string, run: (payload: unknown) => unknown): void {
  ipcMain.handle(channel, (event, payload: unknown) => {
    if (!isTrustedSender(event)) {
      log('ipc-rejected', { channel })
      throw new Error('Remitente no autorizado')
    }
    return run(payload)
  })
}

function registerIpc(): void {
  handle(IPC.open, payload => requireSurface().open(parseHttpUrl(payload)))
  handle(IPC.enter, () => requireSurface().enter())
  handle(IPC.exit, () => requireSurface().exit())
  handle(IPC.setZoom, payload => requireSurface().setZoom(parseZoomFactor(payload)))
  handle(IPC.getState, () => requireSurface().getState())

  ipcMain.on(IPC.setBounds, (event, payload: unknown) => {
    if (!isTrustedSender(event)) {
      log('ipc-rejected', { channel: IPC.setBounds })
      return
    }
    try {
      surface?.setBounds(parseBounds(payload))
    } catch (error) {
      log('bounds-rejected', { message: error instanceof Error ? error.message : String(error) })
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
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'Table · T-001',
    backgroundColor: '#f4f3ef',
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

  const webSurface = new WebSurface(window, state => {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC.state, state)
    }
  })
  surface = webSurface

  window.on('close', event => {
    if (!webSurface.hasLiveContent()) {
      return
    }
    event.preventDefault()
    void webSurface.closeRespectingUnload().then(closed => {
      if (closed && !window.isDestroyed()) {
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

void app.whenReady().then(async () => {
  Menu.setApplicationMenu(buildMenu())
  registerIpc()
  const window = createWindow()
  mainWindow = window
  log('app-ready', { electron: process.versions.electron, chrome: process.versions.chrome })

  if (smokeMode && surface) {
    await runSmoke(window, surface)
    return
  }

  // Dirección del piloto configurada fuera del repositorio.
  const startUrl = process.env['TABLE_SPIKE_START_URL']
  if (startUrl) {
    try {
      surface?.open(parseHttpUrl(startUrl))
    } catch (error) {
      log('start-url-rejected', { message: error instanceof Error ? error.message : String(error) })
    }
  }
})
