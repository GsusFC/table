import type {
  AgentNotionMode,
  Card,
  CardId,
  CardPatch,
  Edge,
  EdgeId,
  Mesa,
  MesaId,
  MesaListing,
  Note,
  NoteId,
  NotePatch,
  Point,
  Result,
  ResultId,
  ResultPatch,
  Viewport,
  ItemId,
} from './model'
import type { FigmaFileFrames, FigmaSettingsView, FrameThumbnail } from './figma'
import type { NotionSettingsView, ProjectSearchResult, ProjectSnapshot, ProjectState } from './notion'
import type { HarnessProfile, SessionId, SessionInfo, TerminalSize } from './terminal'
import type { NotionContextProgress, NotionPageSelection, NotionTree } from './notionContext'
import type { PanelBounds, SurfaceCardState, UnloadResult } from './surface'

export const IPC = {
  mesasList: 'mesas:list',
  mesasCreate: 'mesas:create',
  mesasGet: 'mesas:get',
  mesasRename: 'mesas:rename',
  mesasRemove: 'mesas:remove',
  mesasSetViewport: 'mesas:set-viewport',
  cardsAdd: 'cards:add',
  cardsUpdate: 'cards:update',
  cardsRemove: 'cards:remove',
  notesAdd: 'notes:add',
  notesUpdate: 'notes:update',
  notesRemove: 'notes:remove',
  edgesAdd: 'edges:add',
  edgesRemove: 'edges:remove',
  surfaceOpenMesa: 'surface:open-mesa',
  surfaceEnter: 'surface:enter',
  surfaceExit: 'surface:exit',
  surfaceUnload: 'surface:unload',
  surfaceSetPanelBounds: 'surface:set-panel-bounds',
  surfaceGetStates: 'surface:get-states',
  /** main → renderer */
  surfaceState: 'surface:state',
  /** main → renderer: la tarjeta cambió en disco (título, captura). */
  cardChanged: 'cards:changed',
  /** main → renderer: falló un guardado que hizo el proceso principal. */
  persistenceError: 'app:persistence-error',
  /** main → renderer: guarda lo pendiente antes de cerrar; el renderer responde `appFlushDone` con el mismo id. */
  appFlushRequest: 'app:flush-request',
  /** renderer → main */
  appFlushDone: 'app:flush-done',
  settingsNotion: 'settings:notion',
  settingsConnectNotion: 'settings:connect-notion',
  settingsCancelConnectNotion: 'settings:cancel-connect-notion',
  settingsDisconnectNotion: 'settings:disconnect-notion',
  notionCachedProject: 'notion:cached-project',
  notionRefreshProject: 'notion:refresh-project',
  notionSearchProjects: 'notion:search-projects',
  settingsFigma: 'settings:figma',
  settingsConnectFigma: 'settings:connect-figma',
  settingsDisconnectFigma: 'settings:disconnect-figma',
  figmaListFrames: 'figma:list-frames',
  figmaFetchThumbnails: 'figma:fetch-thumbnails',
  figmaThumbnail: 'figma:thumbnail',
  terminalProfiles: 'terminal:profiles',
  terminalSaveCustomProfile: 'terminal:save-custom-profile',
  terminalRemoveCustomProfile: 'terminal:remove-custom-profile',
  terminalSessions: 'terminal:sessions',
  terminalStart: 'terminal:start',
  terminalReplay: 'terminal:replay',
  terminalClose: 'terminal:close',
  /** renderer → main, sin respuesta (alta frecuencia) */
  terminalWrite: 'terminal:write',
  terminalResize: 'terminal:resize',
  /** Caracteres de `terminalData` ya pintados (control de flujo). */
  terminalAck: 'terminal:ack',
  /** main → renderer */
  terminalData: 'terminal:data',
  terminalSession: 'terminal:session',
  agentRefreshContext: 'agent:refresh-context',
  agentSelectionText: 'agent:selection-text',
  /** Abre `TABLE.md` con la app del sistema y muestra `notion/` (T-009). */
  agentOpenContext: 'agent:open-context',
  agentContextState: 'agent:context-state',
  agentNotionTree: 'agent:notion-tree',
  agentSetNotionSelection: 'agent:set-notion-selection',
  /** Ajuste de la mesa «Notion para el agente» (T-010). */
  agentSetNotionMode: 'agent:set-notion-mode',
  /** renderer → main, sin respuesta: mesa abierta, selección y nota en edición (MCP de Table, T-011). */
  agentUiState: 'agent:ui-state',
  /** main → renderer: el agente cambió la mesa; se vuelve a leer y se avisa. */
  agentMesaChanged: 'agent:mesa-changed',
  /** main → renderer: seleccionar y centrar elementos (`table_show_items`). */
  agentShowItems: 'agent:show-items',
  /** main → renderer: confirmar un borrado pedido por un agente; responde `agentConfirmResponse`. */
  agentConfirmRequest: 'agent:confirm-request',
  /** main → renderer: la petición caducó (el agente ya no espera). */
  agentConfirmCancel: 'agent:confirm-cancel',
  /** renderer → main, sin respuesta. */
  agentConfirmResponse: 'agent:confirm-response',
  /** main → renderer: progreso de la lectura del contenido de Notion de una mesa. */
  agentContextProgress: 'agent:context-progress',
  resultsUpdate: 'results:update',
  resultsRemove: 'results:remove',
  resultsOpen: 'results:open',
  resultsReveal: 'results:reveal',
  resultsPreview: 'results:preview',
  resultsMissing: 'results:missing',
  /** main → renderer: cambió la lista de resultados de una mesa (archivo nuevo o desaparecido). */
  resultsChanged: 'results:changed',
} as const

/**
 * Esquema del protocolo de capturas: `table-capture://<mesaId>/<cardId>?v=<capturedAt>`.
 * El parámetro `v` solo invalida la caché del renderer.
 */
export const CAPTURE_PROTOCOL = 'table-capture'

/**
 * Protocolo de solo lectura para la vista previa de imágenes de resultados:
 * `table-result://<mesaId>/<resultId>?v=<updatedAt>`.
 */
export const RESULT_PROTOCOL = 'table-result'

export interface TableApi {
  readonly platform: string
  readonly mesas: {
    list(): Promise<MesaListing>
    create(name: string): Promise<Mesa>
    get(id: MesaId): Promise<Mesa>
    rename(id: MesaId, name: string): Promise<Mesa>
    remove(id: MesaId): Promise<void>
    setViewport(id: MesaId, viewport: Viewport): Promise<void>
  }
  readonly cards: {
    /** Valida y normaliza la URL, reconoce el servicio y crea la tarjeta. */
    add(mesaId: MesaId, url: string, position: Point): Promise<Card>
    update(mesaId: MesaId, cardId: CardId, patch: CardPatch): Promise<Card>
    /** Descarga su web (respetando `beforeunload`) y la borra con su captura. */
    remove(mesaId: MesaId, cardId: CardId): Promise<UnloadResult>
  }
  readonly notes: {
    /** Crea una nota vacía con su esquina superior izquierda en `position`. */
    add(mesaId: MesaId, position: Point): Promise<Note>
    update(mesaId: MesaId, noteId: NoteId, patch: NotePatch): Promise<Note>
    /** Borra la nota y sus conexiones. */
    remove(mesaId: MesaId, noteId: NoteId): Promise<void>
  }
  readonly edges: {
    /** Conecta dos tarjetas o notas; rechaza autoconexiones y duplicados en cualquier sentido. */
    add(mesaId: MesaId, source: CardId | NoteId, target: CardId | NoteId): Promise<Edge>
    remove(mesaId: MesaId, edgeId: EdgeId): Promise<void>
  }
  readonly surface: {
    /**
     * Mesa visible. Descarga respetando `beforeunload` las webs de otra mesa;
     * `kept` si alguna se mantiene y no se cambia de mesa.
     */
    openMesa(mesaId: MesaId | null): Promise<UnloadResult>
    /** Carga la web si hace falta y la muestra en el panel principal. */
    enter(mesaId: MesaId, cardId: CardId): Promise<void>
    /** Captura, oculta la web (queda conservada) y devuelve el foco al lienzo. */
    exit(): Promise<void>
    unload(cardId: CardId): Promise<UnloadResult>
    setPanelBounds(bounds: PanelBounds): void
    getStates(): Promise<SurfaceCardState[]>
    onState(listener: (state: SurfaceCardState) => void): () => void
  }
  onCardChanged(listener: (mesaId: MesaId, card: Card) => void): () => void
  onPersistenceError(listener: (error: PersistenceError) => void): () => void
  /**
   * Antes de cerrar la ventana, el proceso principal pide guardar lo pendiente
   * (p. ej. la vista del lienzo con retardo). Un manejador que rechaza indica
   * que algo no se pudo guardar; entonces Table pregunta antes de cerrar.
   */
  onFlushRequest(handler: () => Promise<void>): () => void
  /** Configuración global (T-003). Las credenciales de Notion nunca llegan al renderer. */
  readonly settings: {
    notion(): Promise<NotionSettingsView>
    /** Abre el navegador para autorizar a Table en Notion y espera la respuesta. */
    connectNotion(): Promise<NotionSettingsView>
    /** Cancela una autorización en curso; `connectNotion` rechaza. */
    cancelConnectNotion(): Promise<void>
    /** Olvida la conexión y las fichas guardadas. */
    disconnectNotion(): Promise<NotionSettingsView>
    figma(): Promise<FigmaSettingsView>
    /** Comprueba el token personal con Figma y lo guarda cifrado. */
    connectFigma(token: string): Promise<FigmaSettingsView>
    /** Olvida el token y las miniaturas guardadas. */
    disconnectFigma(): Promise<FigmaSettingsView>
  }
  /** Ficha del proyecto de una tarjeta de Notion; la URL la toma el proceso principal de la mesa guardada. */
  readonly notion: {
    cachedProject(mesaId: MesaId, cardId: CardId): Promise<ProjectSnapshot | null>
    refreshProject(mesaId: MesaId, cardId: CardId): Promise<ProjectState>
    /** Busca fichas de proyecto por nombre («Vincular proyecto»). */
    searchProjects(query: string): Promise<ProjectSearchResult[]>
  }
  /** Frames de Figma (T-005); las URLs las toma el proceso principal de la mesa guardada. */
  readonly figma: {
    /** Páginas y frames del archivo de una tarjeta de Figma. */
    listFrames(mesaId: MesaId, cardId: CardId): Promise<FigmaFileFrames>
    /** Pide y guarda las miniaturas de esas tarjetas de frame, en lote. */
    fetchThumbnails(mesaId: MesaId, cardIds: readonly CardId[]): Promise<void>
    /** Miniatura guardada de una tarjeta de frame, o null. */
    thumbnail(mesaId: MesaId, cardId: CardId): Promise<FrameThumbnail | null>
  }
  /**
   * Sesiones de terminal con un arnés (T-007). Solo transportan teclas y
   * salida; Table no interpreta lo que hace el arnés ni responde por él.
   */
  readonly terminal: {
    /** Catálogo (con los instalados marcados como disponibles) y perfiles propios. */
    profiles(): Promise<HarnessProfile[]>
    /** Añade un perfil propio; devuelve la lista completa. */
    saveCustomProfile(input: { name: string; command: string }): Promise<HarnessProfile[]>
    removeCustomProfile(profileId: string): Promise<HarnessProfile[]>
    /** Sesiones de una mesa (en marcha y terminadas que aún no se han cerrado). */
    sessions(mesaId: MesaId): Promise<SessionInfo[]>
    /** Arranca el perfil en la carpeta de trabajo de la mesa. */
    start(mesaId: MesaId, profileId: string, size: TerminalSize): Promise<SessionInfo>
    /** Salida guardada de la sesión (hasta SESSION_REPLAY_BYTES), para volver a pintarla. */
    replay(sessionId: SessionId): Promise<string>
    /** Termina el proceso (y sus hijos) y olvida la sesión. La interfaz confirma antes. */
    close(sessionId: SessionId): Promise<void>
    write(sessionId: SessionId, data: string): void
    resize(sessionId: SessionId, size: TerminalSize): void
    /**
     * Confirma que ya se procesaron `chars` caracteres (longitud de las cadenas
     * recibidas por `onData`). Con demasiada salida sin confirmar, el proceso
     * principal pausa la sesión hasta que la interfaz la alcanza.
     */
    ack(sessionId: SessionId, chars: number): void
    onData(listener: (sessionId: SessionId, data: string) => void): () => void
    /** Cambios de estado de una sesión (arranque, salida). */
    onSession(listener: (session: SessionInfo) => void): () => void
  }
  /**
   * Contexto de la mesa para los agentes, por archivos (T-008 y T-009). Table
   * escribe `TABLE.md` y el contenido filtrado de Notion (`notion/`) en la
   * carpeta de trabajo de la mesa; nunca campos excluidos.
   */
  readonly agent: {
    /** Reescribe `TABLE.md` (y crea los punteros que falten) y vuelve a leer Notion en segundo plano. */
    refreshContext(mesaId: MesaId): Promise<void>
    /**
     * Texto de la selección para pegarlo en la sesión; también lo anota en
     * `TABLE.md` como última selección enviada.
     */
    selectionText(mesaId: MesaId, itemIds: readonly ItemId[]): Promise<string>
    /** «Ver contexto»: abre `TABLE.md` con la app del sistema y muestra la carpeta `notion/`. */
    openContext(mesaId: MesaId): Promise<void>
    /** Último progreso de la lectura de Notion de la mesa, o null. */
    contextState(mesaId: MesaId): Promise<NotionContextProgress | null>
    onProgress(listener: (progress: NotionContextProgress) => void): () => void
    /** Árbol de las fichas de la mesa con la selección guardada («Elegir páginas de Notion…»). */
    notionTree(mesaId: MesaId): Promise<NotionTree>
    /** Guarda la selección de páginas por ficha y vuelve a leer Notion en segundo plano. */
    setNotionSelection(mesaId: MesaId, selections: Readonly<Record<string, NotionPageSelection>>): Promise<void>
    /**
     * «Notion para el agente» (T-010): `files` (por defecto) o `mcp`, el MCP
     * oficial de Notion sin filtro en las sesiones nuevas. Reescribe `TABLE.md`
     * y los archivos de configuración de MCP que Table ya creó en la carpeta.
     * Devuelve el modo guardado.
     */
    setNotionMode(mesaId: MesaId, mode: AgentNotionMode): Promise<AgentNotionMode>
    /**
     * MCP de Table (T-011): la interfaz informa de la mesa abierta, la
     * selección y la nota en edición; el agente las lee y no cambia una nota
     * que la persona está escribiendo.
     */
    reportUiState(state: AgentUiState): void
    /** El agente cambió la mesa: volver a leerla y mostrar `notice`. */
    onMesaChanged(listener: (mesaId: MesaId, notice: string) => void): () => void
    /** `table_show_items`: seleccionar y centrar esos elementos. */
    onShowItems(listener: (mesaId: MesaId, itemIds: readonly ItemId[]) => void): () => void
    /** Un agente quiere borrar algo: la interfaz pregunta y responde con `respondConfirm`. */
    onConfirmRequest(listener: (request: AgentConfirmRequest) => void): () => void
    /** La petición caducó: cerrar su diálogo sin responder. */
    onConfirmCancel(listener: (requestId: string) => void): () => void
    respondConfirm(requestId: string, accepted: boolean): void
  }
  /** Tarjetas de resultado: archivos de `resultados/` en la carpeta de la mesa (T-008). */
  readonly results: {
    update(mesaId: MesaId, resultId: ResultId, patch: ResultPatch): Promise<Result>
    /** Quita la tarjeta (y sus conexiones); el archivo se queda. */
    remove(mesaId: MesaId, resultId: ResultId): Promise<void>
    /** Abre el archivo con la app del sistema. */
    open(mesaId: MesaId, resultId: ResultId): Promise<void>
    /** Lo muestra en Finder. */
    reveal(mesaId: MesaId, resultId: ResultId): Promise<void>
    /** Primeras líneas de un resultado de texto (acotado), o null si no es texto o falta. */
    preview(mesaId: MesaId, resultId: ResultId): Promise<string | null>
    /** Resultados cuyo archivo ya no está en `resultados/` («Archivo no encontrado»). */
    missing(mesaId: MesaId): Promise<ResultId[]>
    /** La lista de resultados de la mesa cambió en disco: la interfaz vuelve a leer la mesa. */
    onChanged(listener: (mesaId: MesaId) => void): () => void
  }
}

/** Guardado fallido en el proceso principal (captura o título de una tarjeta). */
export interface PersistenceError {
  readonly message: string
  readonly mesaId: MesaId
  readonly cardId: CardId
  readonly operation: 'capture' | 'title'
}

/** Estado de la interfaz que necesita el MCP de Table (T-011). */
export interface AgentUiState {
  /** Mesa abierta en la ventana, o null en el inicio. */
  readonly mesaId: MesaId | null
  readonly selection: readonly ItemId[]
  /** Nota que la persona está editando, o null. */
  readonly editingNoteId: string | null
}

/** Confirmación de un borrado pedido por un agente. */
export interface AgentConfirmRequest {
  readonly id: string
  readonly mesaId: MesaId
  /** «Claude Code quiere borrar 2 elementos de la mesa». */
  readonly title: string
  /** Una línea por elemento o conexión. */
  readonly items: readonly string[]
}
