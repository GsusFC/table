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
import { existsSync, mkdtempSync } from 'node:fs'
import { homedir, tmpdir, userInfo } from 'node:os'
import { extname, isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { figmaFileKey, figmaFrameUrl, figmaNodeId } from '../shared/figma'
import { randomUUID } from 'node:crypto'
import {
  CAPTURE_PROTOCOL,
  IPC,
  RESULT_PROTOCOL,
  type AgentConfirmRequest,
  type AgentUiState,
  type PersistenceError,
} from '../shared/ipc'
import type { MesaId } from '../shared/model'
import { parseNotionSelections } from '../shared/notionContext'
import { recognizeService } from '../shared/services'
import {
  isCustomProfileId,
  parseAgentNotionMode,
  parseAgentUiState,
  parseCardPatch,
  parseHttpUrl,
  parseId,
  parseMesaName,
  parseNotePatch,
  parsePanelBounds,
  parsePoint,
  parseResultPatch,
  parseProfileId,
  parseTerminalInput,
  parseTerminalSize,
  parseSurfaceEnterOptions,
  parseViewport,
} from '../shared/validate'
import { CONTEXT_FILE, createAgentContext, type AgentContext } from './agent/context'
import { createAgentMcp, supportsTableMcp, type AgentMcp, type TableBridge } from './agent/mcp'
import { startTableMcpServer, type TableMcpServer } from './agent/tableMcp'
import { createTableToolHandlers, type AgentConfirmation } from './agent/tableTools'
import { createActivityTracker, type ActivityTracker } from './agent/activity'
import { createWebToolHandlers, type WebTools } from './agent/webTools'
import { createNotionContent, type NotionContent } from './agent/notionContent'
import { NOTION_DIR } from './agent/notionFiles'
import { createResultsWatcher, IMAGE_MIME, type ResultEntry, type ResultsWatcher } from './agent/results'
import { log } from './log'
import { authorizeNotion, createNotionMcp, NOTION_MCP_URL } from './notion/mcp'
import { createProjectService, type ProjectService } from './notion/projects'
import { createFigmaClient } from './figma/client'
import { createFrameService, FIGMA_THUMB_PROTOCOL, type FrameService } from './figma/frames'
import { createSettingsStore, type SettingsStore } from './settings/settingsStore'
import { runMeasure } from './measure'
import { runSmoke, SMOKE_REMOTE_HOST, smokeHooks } from './smoke'
import { createMesaStore } from './store/mesaStore'
import type { MesaStore } from './store/types'
import { createProfileCatalog, loginShellDetector, type ProfileCatalog } from './terminal/profiles'
import { createSessionManager, sessionEnvironment, type SessionManager } from './terminal/sessions'
import { createWorkFolders, type WorkFolders } from './terminal/workFolder'
import { createAgentPages } from './web/agentPages'
import { createSurfaceManager } from './web/surfaceManager'
import type { SurfaceManager } from './web/types'

const devRendererUrl = process.env['ELECTRON_RENDERER_URL']
const rendererFile = join(__dirname, '../renderer/index.html')

const smokeMode = process.env['TABLE_SMOKE'] === '1'

// El smoke trabaja con datos desechables, nunca con las mesas del usuario.
if (smokeMode) {
  app.setPath('userData', mkdtempSync(join(tmpdir(), 'table-smoke-')))
  // Las sesiones del smoke usan zsh sin la configuración personal (`.zshrc` con nvm…), que tarda
  // un tiempo variable y a veces no muestra nada en 20 s: el smoke prueba Table, no los dotfiles.
  process.env['SHELL'] = '/bin/zsh'
  process.env['ZDOTDIR'] = mkdtempSync(join(tmpdir(), 'table-smoke-zsh-'))
  // Una web «no local» para el navegador del agente (T-012): un nombre .test que resuelve a la página sintética local.
  app.commandLine.appendSwitch('host-resolver-rules', `MAP ${SMOKE_REMOTE_HOST} 127.0.0.1`)
}

protocol.registerSchemesAsPrivileged([
  { scheme: CAPTURE_PROTOCOL, privileges: { standard: true, secure: true } },
  { scheme: FIGMA_THUMB_PROTOCOL, privileges: { standard: true, secure: true } },
  { scheme: RESULT_PROTOCOL, privileges: { standard: true, secure: true } },
])

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
let frames: FrameService | null = null
let profileCatalog: ProfileCatalog | null = null
let terminals: SessionManager | null = null
let workFolders: WorkFolders | null = null
let agentContext: AgentContext | null = null
/** Contenido completo de Notion en `notion/` de cada mesa (T-009). */
let notionContent: NotionContent | null = null
let resultsWatcher: ResultsWatcher | null = null
/** MCP de los agentes por arnés y ajuste de Notion de cada mesa (T-010). */
let agentMcp: AgentMcp | null = null
/** Operaciones web y revisiones de permiso de las mesas. */
let agentWeb: WebTools | null = null
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

/** Si hay sesiones de terminal en marcha, el usuario decide si terminarlas y cerrar. `true` = cerrar. */
function confirmTerminateSessions(window: BrowserWindow, running: number): boolean {
  if (running === 0) {
    return true
  }
  if (smokeMode) {
    return smokeHooks.confirmTerminateSessions(running)
  }
  const choice = dialog.showMessageBoxSync(window, {
    type: 'warning',
    buttons: ['Volver a Table', running === 1 ? 'Terminar la sesión y cerrar' : `Terminar ${running} sesiones y cerrar`],
    defaultId: 0,
    cancelId: 0,
    message: running === 1 ? 'Hay 1 sesión de terminal en marcha.' : `Hay ${running} sesiones de terminal en marcha.`,
    detail: 'Al cerrar Table se terminan sus procesos y los que hayan abierto. Lo que el agente no haya guardado se pierde.',
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
    await resultsWatcher?.watch(null)
    try {
      await requireStore().remove(mesaId)
    } catch (error) {
      // La interfaz sigue mostrando la mesa: la superficie vuelve a tenerla abierta.
      if (previouslyOpen) {
        await surfaceManager.openMesa(previouslyOpen)
        await resultsWatcher?.watch(previouslyOpen)
      }
      throw error
    }
    // Sus sesiones de terminal no tienen ya mesa: se terminan. Su carpeta de trabajo se conserva en disco.
    await terminals?.closeMesa(mesaId)
    await workFolders?.forget(mesaId)
    agentContext?.forget(mesaId)
    await notionContent?.forget(mesaId)
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

  handle(IPC.surfaceOpenMesa, async mesaId => {
    const parsed = mesaId === null ? null : parseId(mesaId)
    const outcome = await requireSurface().openMesa(parsed)
    if (outcome !== 'kept') {
      // La carpeta `resultados/` de la mesa abierta se vigila; un fallo no impide abrirla.
      await resultsWatcher?.watch(parsed).catch((error: unknown) => {
        log('results-watch-failed', { message: error instanceof Error ? error.message : String(error) })
      })
    }
    return outcome
  })
  handle(IPC.surfaceEnter, async (mesaId, cardId, options) => {
    const parsedMesa = parseId(mesaId)
    const parsedCard = parseId(cardId)
    const { follow, nodeId } = parseSurfaceEnterOptions(options)
    const mesa = await requireStore().get(parsedMesa)
    const card = mesa.cards.find(candidate => candidate.id === parsedCard)
    if (!card) {
      throw new Error('La tarjeta no existe')
    }
    // El almacén ya valida al leer; se vuelve a exigir http(s) antes de cargar.
    const url = parseHttpUrl(card.url)
    // Seguir al agente en un frame de Figma (T-012): la web va a ese nodo del archivo, si no está ya en él.
    const isFigmaFile = figmaFileKey(url, smokeMode ? ['figma.com', '127.0.0.1'] : undefined) !== null
    const target = nodeId && isFigmaFile ? figmaFrameUrl(url, nodeId) : url
    await requireSurface().enter(parsedMesa, parsedCard, target, {
      focus: !follow,
      ...(target !== url ? { shouldNavigate: (current: string | null) => current === null || figmaNodeId(current) !== nodeId } : {}),
    })
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
      controller.signal.throwIfAborted()
      await requireSettings().connectNotion(connection, identity, controller.signal)
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
    await notionContent?.clearCache()
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

function requireFrames(): FrameService {
  if (!frames) {
    throw new Error('Figma no está listo')
  }
  return frames
}

/** URLs guardadas de tarjetas de Figma de una mesa; el renderer solo aporta IDs. */
async function figmaCardUrls(mesaId: unknown, cardIds: readonly unknown[]): Promise<string[]> {
  const mesa = await requireStore().get(parseId(mesaId))
  return cardIds.map(cardId => {
    const parsed = parseId(cardId)
    const card = mesa.cards.find(candidate => candidate.id === parsed)
    if (!card || card.serviceId !== 'figma') {
      throw new Error('La tarjeta no es de Figma')
    }
    return card.url
  })
}

/** Los tokens personales de Figma empiezan por `figd_`. */
function parseFigmaToken(value: unknown): string {
  const token = typeof value === 'string' ? value.trim() : ''
  if (!/^figd_[A-Za-z0-9_-]{20,200}$/.test(token)) {
    throw new Error('Pega el token personal completo de Figma (empieza por figd_)')
  }
  return token
}

/** Lote máximo de miniaturas por petición del renderer. */
const MAX_THUMBNAIL_BATCH = 200

/** Token de Figma y frames (T-005). El token nunca llega al renderer. */
function registerFigmaIpc(): void {
  handle(IPC.settingsFigma, () => requireSettings().figmaView())
  handle(IPC.settingsConnectFigma, async token => {
    const valid = parseFigmaToken(token)
    // Se comprueba con Figma antes de guardarlo.
    const me = await createFigmaClient(valid, smokeMode ? smokeHooks.figmaApiBase : undefined).me()
    await requireSettings().connectFigma(valid, me.handle)
    log('settings-figma', { action: 'connected' })
    return requireSettings().figmaView()
  })
  handle(IPC.settingsDisconnectFigma, async () => {
    await requireSettings().disconnectFigma()
    await requireFrames().clearCache()
    log('settings-figma', { action: 'disconnected' })
    return requireSettings().figmaView()
  })
  handle(IPC.figmaListFrames, async (mesaId, cardId) => {
    const [url] = await figmaCardUrls(mesaId, [cardId])
    return requireFrames().listFrames(url!)
  })
  handle(IPC.figmaFetchThumbnails, async (mesaId, cardIds) => {
    if (!Array.isArray(cardIds) || cardIds.length > MAX_THUMBNAIL_BATCH) {
      throw new Error('Lote de miniaturas no válido')
    }
    await requireFrames().fetchThumbnails(await figmaCardUrls(mesaId, cardIds))
  })
  handle(IPC.figmaThumbnail, async (mesaId, cardId) => {
    const [url] = await figmaCardUrls(mesaId, [cardId])
    return requireFrames().thumbnail(url!)
  })
}

function requireAgent(): { context: AgentContext; results: ResultsWatcher; notion: NotionContent; mcp: AgentMcp } {
  if (!agentContext || !resultsWatcher || !notionContent || !agentMcp) {
    throw new Error('El contexto de los agentes no está listo')
  }
  return { context: agentContext, results: resultsWatcher, notion: notionContent, mcp: agentMcp }
}

/** Elementos máximos en una selección enviada al agente. */
const MAX_SELECTION_ITEMS = 500
/** Bytes de la vista previa de un resultado de texto. */
const PREVIEW_BYTES = 4096
/**
 * Extensiones que el sistema ejecutaría al abrirlas: Table no las abre con
 * doble clic (no ejecutar artefactos recibidos); se pueden mostrar en Finder.
 */
const EXECUTABLE_EXTENSIONS: Readonly<Record<string, true>> = {
  '.app': true,
  '.command': true,
  '.tool': true,
  '.terminal': true,
  '.sh': true,
  '.zsh': true,
  '.bash': true,
  '.csh': true,
  '.scpt': true,
  '.applescript': true,
  '.workflow': true,
  '.action': true,
  '.jar': true,
  '.pkg': true,
  '.mpkg': true,
  '.dmg': true,
  '.webloc': true,
  '.inetloc': true,
  '.fileloc': true,
}

/** Archivo comprobado de un resultado de la mesa; lanza si falta o no es un archivo normal de `resultados/`. */
async function resultEntryOf(mesaId: MesaId, resultId: string): Promise<ResultEntry> {
  const resolved = await requireAgent().results.resolve(mesaId, resultId)
  if (!resolved) {
    throw new Error('Archivo no encontrado')
  }
  return resolved.entry
}

/** Tamaño máximo de una imagen de resultado servida al lienzo. */
const MAX_RESULT_IMAGE_BYTES = 32 * 1024 * 1024

/** Contexto para los agentes y tarjetas de resultado (T-008). */
function registerAgentIpc(): void {
  handle(IPC.agentRefreshContext, async mesaId => {
    const parsed = parseId(mesaId)
    await requireAgent().context.write(parsed)
    // El contenido de Notion se lee en segundo plano; el panel muestra el progreso.
    void requireAgent().notion.request(parsed)
  })
  handle(IPC.agentOpenContext, async mesaId => {
    const folder = await requireAgent().context.write(parseId(mesaId))
    const notionDir = join(folder, NOTION_DIR)
    const reveal = existsSync(notionDir) ? notionDir : join(folder, CONTEXT_FILE)
    if (smokeMode) {
      smokeHooks.openedContext.push(join(folder, CONTEXT_FILE), reveal)
      return
    }
    const failure = await shell.openPath(join(folder, CONTEXT_FILE))
    if (failure) {
      throw new Error(`No se pudo abrir TABLE.md: ${failure}`)
    }
    shell.showItemInFolder(reveal)
  })
  handle(IPC.agentContextState, mesaId => requireAgent().notion.progress(parseId(mesaId)))
  handle(IPC.agentNotionTree, mesaId => requireAgent().notion.tree(parseId(mesaId)))
  handle(IPC.agentSetNotionSelection, async (mesaId, selections) => {
    const parsedMesa = parseId(mesaId)
    await requireStore().get(parsedMesa)
    await requireAgent().notion.setSelection(parsedMesa, parseNotionSelections(selections))
  })
  handle(IPC.agentSetNotionMode, async (mesaId, mode) => {
    const parsedMesa = parseId(mesaId)
    const parsedMode = parseAgentNotionMode(mode)
    try {
      if (!agentWeb) {
        throw new Error('El navegador de Table no está disponible')
      }
      // Revoca primero las operaciones web anteriores y no admite otras hasta fijar el modo.
      const saved = await agentWeb.withNotionModeChange(parsedMesa, () => requireAgent().mcp.setMode(parsedMesa, parsedMode))
      log('agent-notion-mode', { mode: saved })
      return saved
    } finally {
      // `TABLE.md` dice qué MCP hay, también si los archivos no se pudieron actualizar.
      await requireAgent()
        .context.write(parsedMesa)
        .catch((error: unknown) => log('agent-context-failed', { message: error instanceof Error ? error.message : String(error) }))
    }
  })
  handle(IPC.agentSelectionText, (mesaId, itemIds) => {
    if (!Array.isArray(itemIds) || itemIds.length === 0 || itemIds.length > MAX_SELECTION_ITEMS) {
      throw new Error('Selección no válida')
    }
    return requireAgent().context.selectionText(parseId(mesaId), itemIds.map(parseId))
  })
  handle(IPC.resultsUpdate, (mesaId, resultId, patch) =>
    requireStore().updateResult(parseId(mesaId), parseId(resultId), parseResultPatch(patch)),
  )
  // Solo la tarjeta: el archivo se queda en `resultados/`.
  handle(IPC.resultsRemove, (mesaId, resultId) => requireStore().removeResult(parseId(mesaId), parseId(resultId)))
  handle(IPC.resultsOpen, async (mesaId, resultId) => {
    const parsedMesa = parseId(mesaId)
    const parsedResult = parseId(resultId)
    const entry = await resultEntryOf(parsedMesa, parsedResult)
    if ((entry.mode & 0o111) !== 0 || Object.hasOwn(EXECUTABLE_EXTENSIONS, extname(entry.path).toLowerCase())) {
      throw new Error('Table no abre archivos ejecutables; usa «Mostrar en Finder»')
    }
    // Se vuelve a comprobar justo antes de abrir: si el archivo se cambió por otro, no se abre.
    const again = await resultEntryOf(parsedMesa, parsedResult)
    if (again.dev !== entry.dev || again.ino !== entry.ino || again.mode !== entry.mode) {
      throw new Error('El archivo cambió mientras se abría; vuelve a intentarlo')
    }
    const failure = await shell.openPath(entry.path)
    if (failure) {
      throw new Error(`No se pudo abrir el archivo: ${failure}`)
    }
  })
  handle(IPC.resultsReveal, async (mesaId, resultId) => {
    shell.showItemInFolder((await resultEntryOf(parseId(mesaId), parseId(resultId))).path)
  })
  handle(IPC.resultsPreview, async (mesaId, resultId) => {
    const opened = await requireAgent().results.open(parseId(mesaId), parseId(resultId))
    if (!opened) {
      return null
    }
    try {
      if (opened.result.kind !== 'text') {
        return null
      }
      const buffer = Buffer.alloc(PREVIEW_BYTES)
      const { bytesRead } = await opened.handle.read(buffer, 0, PREVIEW_BYTES, 0)
      // `stream`: un carácter partido al final del bloque no se convierte en «�».
      return new TextDecoder('utf-8').decode(buffer.subarray(0, bytesRead), { stream: true })
    } finally {
      await opened.handle.close()
    }
  })
  handle(IPC.resultsMissing, mesaId => requireAgent().results.missing(parseId(mesaId)))
}

/** MCP de Table (T-011): servidor de la mesa para los agentes. */
let tableMcp: TableMcpServer | null = null
/** Lo que la interfaz informa: mesa abierta, selección y nota en edición. */
let agentUi: AgentUiState = { mesaId: null, selection: [], editingNoteId: null }
/** Confirmaciones pedidas por un agente (borrar, usar las webs) esperando respuesta de la interfaz. */
const pendingConfirms = new Map<string, (accepted: boolean) => void>()
/**
 * Tiempo para contestar a un agente. Después se rechaza: el arnés dejaría de
 * esperar (Codex corta las herramientas a los 60 s) y la persona no debe
 * aceptar algo que el agente ya dio por fallido.
 */
const AGENT_CONFIRM_TIMEOUT_MS = 50_000
/** Luz de actividad de los agentes en las tarjetas (T-012). */
let agentActivity: ActivityTracker | null = null
/** Las webs de las tarjetas vistas por el agente (T-012). */
const agentPages = createAgentPages()

/** La interfaz se recarga: su estado y sus diálogos pendientes ya no valen. */
function resetAgentUi(): void {
  agentUi = { mesaId: null, selection: [], editingNoteId: null }
  for (const finish of [...pendingConfirms.values()]) {
    finish(false)
  }
}

/**
 * Confirmación pedida por un agente (borrar, T-011; usar las webs, T-012):
 * si su mesa está abierta, con el diálogo de Table (la interfaz cierra antes
 * la web abierta); si no, con un diálogo nativo sobre la ventana. Sin
 * respuesta a tiempo, o si `signal` se cancela (sesión cerrada, puente
 * desconectado, petición cancelada), se retira el diálogo y se rechaza.
 */
async function confirmAgent(request: AgentConfirmation, signal: AbortSignal): Promise<boolean> {
  const window = mainWindow
  if (!window || window.isDestroyed() || signal.aborted) {
    return false
  }
  if (!window.isFocused() && !smokeMode) {
    app.dock?.bounce('informational')
  }
  const expired = AbortSignal.any([signal, AbortSignal.timeout(AGENT_CONFIRM_TIMEOUT_MS)])
  if (agentUi.mesaId === request.mesaId) {
    const id = randomUUID()
    const { promise, resolve } = Promise.withResolvers<boolean>()
    const withdraw = (): void => {
      sendToRenderer(IPC.agentConfirmCancel, id)
      finish(false)
    }
    const finish = (accepted: boolean): void => {
      if (pendingConfirms.delete(id)) {
        expired.removeEventListener('abort', withdraw)
        // Aceptado justo cuando se cancelaba: cuenta como rechazado.
        resolve(accepted && !expired.aborted)
      }
    }
    expired.addEventListener('abort', withdraw, { once: true })
    pendingConfirms.set(id, finish)
    const message: AgentConfirmRequest = {
      id,
      mesaId: request.mesaId,
      kind: request.kind,
      title: request.title,
      items: request.items,
      note: request.note,
      confirmLabel: request.confirmLabel,
    }
    sendToRenderer(IPC.agentConfirmRequest, message)
    return promise
  }
  if (smokeMode) {
    return smokeHooks.confirmAgent(request) && !expired.aborted
  }
  const { response } = await dialog.showMessageBox(window, {
    type: request.kind === 'remove' ? 'warning' : 'question',
    message: request.title,
    detail: [...request.items, ...(request.items.length > 0 ? [''] : []), request.note].join('\n'),
    buttons: ['Cancelar', request.confirmLabel],
    defaultId: 0,
    cancelId: 0,
    signal: expired,
  })
  return response === 1 && !expired.aborted
}

function registerTableMcpIpc(): void {
  listen(IPC.agentUiState, state => {
    agentUi = parseAgentUiState(state)
  })
  listen(IPC.agentConfirmResponse, (requestId, accepted) => {
    if (typeof requestId === 'string' && typeof accepted === 'boolean') {
      pendingConfirms.get(requestId)?.(accepted)
    }
  })
  handle(IPC.agentActivities, () => agentActivity?.list() ?? [])
}

/** Cómo arranca un arnés el puente stdio: el ejecutable de Table en modo Node con `mcpBridge.js`, junto al proceso principal compilado. */
const TABLE_BRIDGE_SCRIPT = join(__dirname, 'mcpBridge.js')
function tableBridge(): TableBridge | null {
  return tableMcp && existsSync(TABLE_BRIDGE_SCRIPT) ? { command: process.execPath, args: [TABLE_BRIDGE_SCRIPT] } : null
}

function requireTerminals(): { catalog: ProfileCatalog; sessions: SessionManager } {
  if (!profileCatalog || !terminals) {
    throw new Error('Las terminales no están listas')
  }
  return { catalog: profileCatalog, sessions: terminals }
}

/** Mensaje sin respuesta del renderer (alta frecuencia): se valida y, si no vale, se descarta con registro. */
function listen(channel: string, run: (...args: unknown[]) => void): void {
  ipcMain.on(channel, (event, ...args: unknown[]) => {
    if (!isTrustedSender(event)) {
      log('ipc-rejected', { channel })
      return
    }
    try {
      run(...args)
    } catch (error) {
      log('ipc-invalid', { channel, message: error instanceof Error ? error.message : String(error) })
    }
  })
}

/** Sesiones de terminal con un arnés (T-007). Table transporta teclas y salida; no responde por el arnés. */
function registerTerminalIpc(): void {
  handle(IPC.terminalProfiles, () => requireTerminals().catalog.list())
  handle(IPC.terminalSaveCustomProfile, async input => {
    await requireSettings().addCustomProfile(input)
    return requireTerminals().catalog.list()
  })
  handle(IPC.terminalRemoveCustomProfile, async profileId => {
    const id = parseProfileId(profileId)
    if (!isCustomProfileId(id)) {
      throw new Error('Solo se pueden quitar perfiles propios')
    }
    // Las sesiones abiertas con ese perfil siguen en marcha.
    await requireSettings().removeCustomProfile(id)
    return requireTerminals().catalog.list()
  })
  handle(IPC.terminalSessions, mesaId => requireTerminals().sessions.sessions(parseId(mesaId)))
  handle(IPC.terminalStart, (mesaId, profileId, size) =>
    requireTerminals().sessions.start(parseId(mesaId), parseProfileId(profileId), parseTerminalSize(size)),
  )
  handle(IPC.terminalReplay, sessionId => requireTerminals().sessions.replay(parseId(sessionId)))
  handle(IPC.terminalClose, sessionId => requireTerminals().sessions.close(parseId(sessionId)))
  listen(IPC.terminalWrite, (sessionId, data) => terminals?.write(parseId(sessionId), parseTerminalInput(data)))
  listen(IPC.terminalResize, (sessionId, size) => terminals?.resize(parseId(sessionId), parseTerminalSize(size)))
  listen(IPC.terminalAck, (sessionId, chars) => {
    if (typeof chars !== 'number' || !Number.isSafeInteger(chars) || chars < 0) {
      throw new Error('Confirmación no válida')
    }
    terminals?.ack(parseId(sessionId), chars)
  })
}

/** Shell de inicio de sesión del usuario; zsh es el de macOS por defecto. */
function loginShell(): string {
  for (const candidate of [process.env['SHELL'], userInfo().shell]) {
    if (candidate && isAbsolute(candidate) && existsSync(candidate)) {
      return candidate
    }
  }
  return '/bin/zsh'
}

/** `table-figma://thumb/<archivo>/<nodo>`: miniaturas de frames guardadas, solo lectura. */
function registerFigmaProtocol(): void {
  protocol.handle(FIGMA_THUMB_PROTOCOL, async request => {
    try {
      const url = new URL(request.url)
      const [fileKey, nodeFile, ...rest] = url.pathname.replace(/^\//, '').split('/')
      const image =
        url.hostname === 'thumb' && fileKey && nodeFile && rest.length === 0
          ? await requireFrames().readThumbnail(fileKey, nodeFile)
          : null
      return image ? new Response(new Uint8Array(image), { headers: { 'content-type': 'image/jpeg' } }) : new Response(null, { status: 404 })
    } catch {
      return new Response(null, { status: 400 })
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

/** `table-result://<mesaId>/<resultId>`: imágenes de `resultados/` de la mesa, solo lectura. */
function registerResultProtocol(): void {
  protocol.handle(RESULT_PROTOCOL, async request => {
    let mesaId: string
    let resultId: string
    try {
      const url = new URL(request.url)
      mesaId = parseId(url.hostname)
      resultId = parseId(url.pathname.replace(/^\//, ''))
    } catch {
      return new Response(null, { status: 400 })
    }
    try {
      const opened = await requireAgent().results.open(mesaId, resultId)
      if (!opened) {
        return new Response(null, { status: 404 })
      }
      try {
        const mime = IMAGE_MIME[extname(opened.result.file).toLowerCase()]
        if (opened.result.kind !== 'image' || !mime) {
          return new Response(null, { status: 404 })
        }
        if (opened.size > MAX_RESULT_IMAGE_BYTES) {
          return new Response(null, { status: 413 })
        }
        // Se lee del descriptor ya comprobado, no por nombre.
        const data = await opened.handle.readFile()
        return new Response(new Uint8Array(data), { headers: { 'content-type': mime, 'x-content-type-options': 'nosniff' } })
      } finally {
        await opened.handle.close()
      }
    } catch {
      return new Response(null, { status: 404 })
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
      // El smoke debe pintar aunque la ventana quede tapada por otras (la persona sigue usando el Mac):
      // sin esto, Chromium frena la ventana tapada y la terminal y el lienzo no se repintan a tiempo.
      backgroundThrottling: !smokeMode,
    },
  })
  const contents = window.webContents
  // Al recargar la interfaz, la salida enviada y sin confirmar ya no se confirmará: no puede dejar sesiones pausadas.
  contents.on('did-start-loading', () => {
    terminals?.resetFlowControl()
    resetAgentUi()
  })
  contents.on('did-finish-load', () => terminals?.resetFlowControl())

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
    onContents: contents => agentPages.track(contents),
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
    // El smoke sirve archivos de Figma falsos desde 127.0.0.1.
    shareKey: url => figmaFileKey(url, smokeMode ? ['figma.com', '127.0.0.1'] : undefined),
    ...(smokeMode ? { confirmDiscard: (origin: string, reason: 'quit' | 'unload') => smokeHooks.confirmDiscard(origin, reason) } : {}),
  })
  surface = manager

  // Cierre coordinado: guardar lo pendiente de la interfaz, descargar las webs
  // respetando `beforeunload`, terminar las sesiones de terminal (con
  // confirmación) y esperar a que terminen las escrituras.
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
        if (!confirmTerminateSessions(window, terminals?.runningCount() ?? 0)) {
          return
        }
        if (!(await manager.closeAll())) {
          return
        }
        // Procesos de las sesiones y sus descendientes; espera acotada a que salgan.
        await terminals?.closeAll()
        // Sin sesiones, el MCP de Table ya no tiene a quién servir: se cierra y se borra su socket.
        await tableMcp?.close().catch(() => undefined)
        tableMcp = null
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

// Red de seguridad si se sale sin pasar por el cierre coordinado: ningún proceso de sesión queda huérfano.
app.on('will-quit', () => terminals?.killAllNow())
process.on('exit', () => terminals?.killAllNow())

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
  // En el smoke, los archivos «de Figma» se sirven en local con una API falsa.
  frames = createFrameService(
    settings,
    app.getPath('userData'),
    smokeMode ? ['figma.com', '127.0.0.1'] : undefined,
    smokeMode ? () => smokeHooks.figmaApiBase : undefined,
  )
  Menu.setApplicationMenu(buildMenu())
  registerCaptureProtocol()
  registerFigmaProtocol()
  registerResultProtocol()
  registerIpc()
  registerNotionIpc()
  registerFigmaIpc()
  const shell = loginShell()
  const sessionEnv = sessionEnvironment(process.env)
  const currentSettings = settings
  profileCatalog = createProfileCatalog(loginShellDetector(shell, sessionEnv), () => currentSettings.customProfiles())
  void profileCatalog.refresh()
  const catalog = profileCatalog
  // El smoke trabaja en una carpeta desechable, nunca en ~/Table.
  const folders = createWorkFolders(
    join(app.getPath('userData'), 'work-folders.json'),
    smokeMode ? join(app.getPath('userData'), 'Table') : join(homedir(), 'Table'),
  )
  workFolders = folders
  const mesaFolder = async (mesaId: MesaId): Promise<string> =>
    folders.folderFor(mesaId, (await requireStore().get(mesaId)).name)
  const frameService = frames
  const projectService = projects
  const context = createAgentContext({
    getMesa: mesaId => requireStore().get(mesaId),
    workFolder: mesa => folders.folderFor(mesa.id, mesa.name),
    cachedProject: url => projectService.cached(url),
    frame: url => frameService.thumbnail(url),
    notionContent: mesaId => content.summary(mesaId),
  })
  agentContext = context
  const content = createNotionContent({
    mcp: notionMcp,
    revision: () => currentSettings.revision(),
    connected: () => currentSettings.notionView().connected,
    getMesa: mesaId => requireStore().get(mesaId),
    workFolder: mesa => folders.folderFor(mesa.id, mesa.name),
    cachedProject: url => projectService.cached(url),
    dataDir: app.getPath('userData'),
    onProgress: progress => sendToRenderer(IPC.agentContextProgress, progress),
    onWritten: async mesaId => {
      await context.write(mesaId)
    },
  })
  notionContent = content
  resultsWatcher = createResultsWatcher({
    store: requireStore(),
    workFolder: mesaFolder,
    onChanged: mesaId => sendToRenderer(IPC.resultsChanged, mesaId),
  })
  // MCP de Table (T-011): las herramientas de la mesa, servidas por un socket Unix a cada sesión.
  const tableHandlers = createTableToolHandlers({
    store: requireStore(),
    workFolder: mesaFolder,
    cachedProject: url => projectService.cached(url),
    unloadCard: cardId => requireSurface().unload(cardId),
    ui: {
      isOpen: mesaId => agentUi.mesaId === mesaId,
      selection: mesaId => (agentUi.mesaId === mesaId ? agentUi.selection : []),
      editingNote: mesaId => (agentUi.mesaId === mesaId ? agentUi.editingNoteId : null),
      show: (mesaId, ids) => sendToRenderer(IPC.agentShowItems, mesaId, ids),
    },
    confirm: confirmAgent,
    changed: (mesaId, notice) => sendToRenderer(IPC.agentMesaChanged, mesaId, notice),
  })
  // Luz de actividad (T-012): la tarjeta en la que trabaja un agente se ilumina y su web no se descarga.
  const activity = createActivityTracker({
    onChange: activities => sendToRenderer(IPC.agentActivity, activities),
    pin: cardId => surface?.pin(cardId),
    unpin: cardId => {
      const contents = surface?.loadedContents(cardId)
      if (contents) {
        agentPages.release(contents)
      }
      surface?.unpin(cardId)
    },
  })
  agentActivity = activity
  // Webs de las tarjetas para el agente (T-012), sobre las mismas vistas que ve la persona.
  const webTools = createWebToolHandlers({
    store: requireStore(),
    isMesaOpen: mesaId => agentUi.mesaId === mesaId && surface?.getOpenMesa() === mesaId,
    openPage: async (mesaId, cardId, url, signal) => agentPages.page(await requireSurface().loadForAgent(mesaId, cardId, url, signal), signal),
    activity,
    confirm: confirmAgent,
    changed: (mesaId, notice) => sendToRenderer(IPC.agentMesaChanged, mesaId, notice),
  })
  agentWeb = webTools
  tableMcp = await startTableMcpServer({ ...tableHandlers, ...webTools.handlers }).catch((error: unknown) => {
    // Sin servidor, las sesiones arrancan sin el MCP de Table (su chip no aparece).
    log('table-mcp-failed', { message: error instanceof Error ? error.message : String(error) })
    return null
  })
  if (smokeMode) {
    smokeHooks.tableMcpBridge = tableBridge
  }
  const mcp = createAgentMcp({
    mode: async mesaId => (await requireStore().get(mesaId)).agentNotion,
    saveMode: async (mesaId, mode) => (await requireStore().setAgentNotion(mesaId, mode)).agentNotion,
    folder: mesaFolder,
    verifyFolder: folder => folders.verify(folder),
    registryFile: join(app.getPath('userData'), 'agent-mcp-files.json'),
    tableBridge,
  })
  agentMcp = mcp
  // El MCP de Chrome se retiró (D-021): fuera de los archivos de proyecto que creó Table.
  void mcp.retireLegacy().then(cleaned => {
    if (cleaned.length > 0) {
      log('agent-mcp-retired', { files: cleaned.length })
    }
  })
  terminals = createSessionManager({
    shell,
    env: sessionEnv,
    workFolder: async mesaId => {
      const folder = await mesaFolder(mesaId)
      // `TABLE.md` al día antes de arrancar el arnés; si no se puede escribir, la sesión se abre igual.
      await context.write(mesaId).catch((error: unknown) => {
        log('agent-context-failed', { message: error instanceof Error ? error.message : String(error) })
      })
      // El contenido de Notion se lee en segundo plano: la sesión no lo espera.
      void content.request(mesaId)
      return folder
    },
    profile: id => catalog.get(id),
    // MCP de los agentes (T-010, T-011): Table y Figma siempre; Notion si la mesa lo permite.
    prepare: async (mesaId, profile, cwd, sessionId) => {
      const smokeAdapter = smokeMode ? smokeHooks.mcpAdapters.get(profile.id) : undefined
      const adapter = smokeAdapter ?? (profile.source === 'builtin' ? profile.id : 'custom')
      const launch = await mcp.prepare(mesaId, cwd, adapter)
      const server = tableMcp
      if (!server || !supportsTableMcp(adapter) || !launch.mcp.some(item => item.name === 'table' && item.status === 'configured')) {
        return launch
      }
      // El testigo va solo en el entorno de la sesión (nunca en argumentos ni archivos) y caduca con ella.
      const registration = server.register({ sessionId, mesaId, agentName: profile.name })
      if (smokeMode) {
        smokeHooks.tableMcpEnv.set(sessionId, registration.env)
      }
      return {
        ...launch,
        env: { ...launch.env, ...registration.env },
        dispose: () => {
          registration.dispose()
          // Sin sesión no hay luz ni permiso para las webs.
          activity.endSession(sessionId)
          webTools.endSession(sessionId)
        },
      }
    },
    onData: (sessionId, data) => sendToRenderer(IPC.terminalData, sessionId, data),
    onSession: session => sendToRenderer(IPC.terminalSession, session),
  })
  registerTerminalIpc()
  registerAgentIpc()
  registerTableMcpIpc()
  if (smokeMode) {
    const sessions = terminals
    smokeHooks.terminalPid = sessionId => sessions.pidOf(sessionId)
  }
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
