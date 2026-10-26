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
import type { NotionDatabase, NotionSettingsView, ProjectSnapshot, ProjectState } from './notion'
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
  settingsSetNotionToken: 'settings:set-notion-token',
  settingsClearNotionToken: 'settings:clear-notion-token',
  settingsListNotionDatabases: 'settings:list-notion-databases',
  settingsSetNotionDatabase: 'settings:set-notion-database',
  notionCachedProject: 'notion:cached-project',
  notionRefreshProject: 'notion:refresh-project',
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
  /** Configuración global (T-003). El token entra pero nunca vuelve al renderer. */
  readonly settings: {
    notion(): Promise<NotionSettingsView>
    setNotionToken(token: string): Promise<NotionSettingsView>
    clearNotionToken(): Promise<NotionSettingsView>
    /** Bases compartidas con la integración; solo se puede elegir una de esta lista. */
    listNotionDatabases(): Promise<NotionDatabase[]>
    setNotionDatabase(databaseId: string | null): Promise<NotionSettingsView>
  }
  /** Ficha del proyecto de una tarjeta de Notion; la URL la toma el proceso principal de la mesa guardada. */
  readonly notion: {
    cachedProject(mesaId: MesaId, cardId: CardId): Promise<ProjectSnapshot | null>
    refreshProject(mesaId: MesaId, cardId: CardId): Promise<ProjectState>
  }
}

/** Guardado fallido en el proceso principal (captura o título de una tarjeta). */
export interface PersistenceError {
  readonly message: string
  readonly mesaId: MesaId
  readonly cardId: CardId
  readonly operation: 'capture' | 'title'
}
