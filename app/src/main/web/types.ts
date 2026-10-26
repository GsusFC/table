import type { CardId, MesaId } from '../../shared/model'
import type { PanelBounds, SurfaceCardState, UnloadResult } from '../../shared/surface'

/**
 * Webs de las tarjetas como `WebContentsView` (D-010), con la opción B de
 * D-016: la tarjeta en la que se entra ocupa el panel principal; las demás
 * cargadas quedan ocultas (conservadas). Nunca descarga por tiempo ni por
 * memoria; solo cuando se pide, respetando `beforeunload`.
 *
 * Reglas heredadas de T-001 (spikes/desktop-001/src/main/webSurface.ts):
 * contenido remoto con sandbox, contextIsolation y sin Node ni preload;
 * navegación y redirecciones solo http(s); popups http(s)/about:blank como
 * ventana hija con la misma sesión; permisos preguntados al usuario y
 * recordados por origen durante la sesión; descargas bloqueadas; menú
 * contextual para copiar imagen, enlace y texto; `⌘⇧Esc` sale y `Esc` llega
 * a la página; partición persistente `persist:table`.
 *
 * Implementación: tarea paralela «superficie web» de T-002.
 */
export interface SurfaceManager {
  /** Cambia de mesa: descarga las webs de otras mesas. `kept` si alguna se mantiene. */
  openMesa(mesaId: MesaId | null): Promise<UnloadResult>
  /** Carga si hace falta y muestra la web en el panel; sale antes de otra tarjeta activa. */
  enter(mesaId: MesaId, cardId: CardId, url: string): Promise<void>
  /** Captura la web activa, la oculta y devuelve el foco a la interfaz. Sin efecto si no hay. */
  exit(): Promise<void>
  unload(cardId: CardId): Promise<UnloadResult>
  setPanelBounds(bounds: PanelBounds): void
  getStates(): SurfaceCardState[]
  /** Cierre de la ventana: descarga todo respetando `beforeunload`. `false` si el usuario cancela. */
  closeAll(): Promise<boolean>
}

/** Lo que la superficie necesita del resto de la aplicación. */
export interface SurfaceCallbacks {
  onState(state: SurfaceCardState): void
  /** Captura JPEG tomada al salir de una tarjeta. */
  onCapture(mesaId: MesaId, cardId: CardId, jpeg: Buffer): void
  /** Título de página observado. */
  onTitle(mesaId: MesaId, cardId: CardId, title: string): void
}
