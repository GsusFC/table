import type { WebContents } from 'electron'
import type { CardId, MesaId } from '../../shared/model'
import type { PanelBounds, SurfaceCardState, UnloadResult } from '../../shared/surface'

/** Cómo entrar en una tarjeta. */
export interface EnterOptions {
  /** Dar el foco a la web (por defecto). Al seguir al agente, no: el foco se queda donde estaba. */
  readonly focus?: boolean
  /**
   * Si la web ya está cargada, si hay que llevarla a `url` según su URL
   * actual (un nodo de Figma al seguir al agente). Por defecto, no.
   */
  readonly shouldNavigate?: (currentUrl: string | null) => boolean
}

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
 */
export interface SurfaceManager {
  /**
   * Fija la mesa abierta y descarga las webs de otras mesas. `kept` si alguna
   * se mantiene; en ese caso la mesa abierta no cambia.
   */
  openMesa(mesaId: MesaId | null): Promise<UnloadResult>
  /**
   * Carga si hace falta y muestra la web en el panel; sale antes de otra
   * tarjeta activa. Rechaza si `mesaId` ya no es la mesa abierta en el
   * momento de ejecutarse (entradas retrasadas) o si la URL no es http(s).
   */
  enter(mesaId: MesaId, cardId: CardId, url: string, options?: EnterOptions): Promise<void>
  /**
   * Web de una tarjeta para el agente (T-012): la carga si hace falta sin
   * mostrarla (la persona sigue donde está) y devuelve su contenido. Rechaza
   * si la mesa no es la abierta, si la URL no es http(s) o si cargarla
   * cambiaría el editor de Figma que la persona tiene delante. Fija antes la
   * tarjeta con `pin`. Comprueba `signal` al tomar turno y tras cada espera:
   * una petición cancelada no crea vistas, navega ni recibe una cesión tardía.
   */
  loadForAgent(mesaId: MesaId, cardId: CardId, url: string, signal: AbortSignal): Promise<WebContents>
  /** Contenido de la web cargada y viva de la tarjeta, o null. */
  loadedContents(cardId: CardId): WebContents | null
  /**
   * Un agente trabaja en la tarjeta: su web no se descarga por el límite de
   * webs cargadas ni se cede a otra tarjeta del mismo archivo. `unpin` la
   * suelta y vuelve a aplicar el límite.
   */
  pin(cardId: CardId): void
  unpin(cardId: CardId): void
  /** Captura la web activa, la oculta y devuelve el foco a la interfaz. Sin efecto si no hay. */
  exit(): Promise<void>
  /** Cierra la web y sus popups respetando `beforeunload`. */
  unload(cardId: CardId): Promise<UnloadResult>
  setPanelBounds(bounds: PanelBounds): void
  getStates(): SurfaceCardState[]
  /** Mesa abierta según el último `openMesa` que terminó sin `kept`. */
  getOpenMesa(): MesaId | null
  /**
   * Cierre de la ventana: descarga todo, popups incluidos, respetando
   * `beforeunload`. `false` si el usuario cancela.
   */
  closeAll(): Promise<boolean>
}

/** Lo que la superficie necesita del resto de la aplicación. */
export interface SurfaceCallbacks {
  onState(state: SurfaceCardState): void
  /** Captura JPEG tomada al salir de una tarjeta. */
  onCapture(mesaId: MesaId, cardId: CardId, jpeg: Buffer): void
  /** Título de página observado. */
  onTitle(mesaId: MesaId, cardId: CardId, title: string): void
  /**
   * Clave para compartir una web cargada entre tarjetas (T-005): las tarjetas
   * cuya URL da la misma clave no nula usan un único editor. Al entrar en una
   * sin web cargada, se le cede la de otra tarjeta de la mesa con su clave.
   */
  shareKey(url: string): string | null
  /**
   * Decide si descartar el trabajo que una página o un popup declara
   * pendiente. Por defecto, diálogo al usuario; el smoke lo sustituye.
   */
  confirmDiscard?(origin: string, reason: 'quit' | 'unload'): boolean
  /** Cada vista de tarjeta al crearse (para guardar la consola de las webs locales, T-012). */
  onContents?(contents: WebContents): void
}
