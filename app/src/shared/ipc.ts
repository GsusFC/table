import type {
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
  Viewport,
} from './model'
import type { FigmaFileFrames, FigmaSettingsView, FrameThumbnail } from './figma'
import type { NotionSettingsView, ProjectSearchResult, ProjectSnapshot, ProjectState } from './notion'
import type { HarnessProfile, SessionId, SessionInfo, TerminalSize } from './terminal'
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
} as const

/**
 * Esquema del protocolo de capturas: `table-capture://<mesaId>/<cardId>?v=<capturedAt>`.
 * El parámetro `v` solo invalida la caché del renderer.
 */
export const CAPTURE_PROTOCOL = 'table-capture'

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
}

/** Guardado fallido en el proceso principal (captura o título de una tarjeta). */
export interface PersistenceError {
  readonly message: string
  readonly mesaId: MesaId
  readonly cardId: CardId
  readonly operation: 'capture' | 'title'
}
