import type { Card, CardId, CardPatch, Mesa, MesaId, MesaSummary, Point, Viewport } from './model'
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
} as const

/**
 * Esquema del protocolo de capturas: `table-capture://<mesaId>/<cardId>?v=<capturedAt>`.
 * El parámetro `v` solo invalida la caché del renderer.
 */
export const CAPTURE_PROTOCOL = 'table-capture'

export interface TableApi {
  readonly platform: string
  readonly mesas: {
    list(): Promise<MesaSummary[]>
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
}
