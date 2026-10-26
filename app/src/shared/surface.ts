import type { CardId } from './model'

/**
 * Estado de la web de una tarjeta (ver docs/memory-validation.md):
 * - `unloaded`: sin contenido web cargado; se muestra la captura.
 * - `loading` / `ready`: cargada. Si `entered`, ocupa el panel principal
 *   (opción B, D-016); si no, está conservada: oculta y en memoria.
 * - `failed`: la carga o el proceso de la web fallaron.
 */
export type SurfaceStatus = 'unloaded' | 'loading' | 'ready' | 'failed'

export interface SurfaceCardState {
  readonly cardId: CardId
  readonly status: SurfaceStatus
  readonly entered: boolean
  /** URL actual tras redirecciones; null si no se ha cargado. */
  readonly currentUrl: string | null
  readonly title: string | null
  /** Duración de la última carga hasta `did-stop-loading`, en ms. */
  readonly loadMs: number | null
  readonly error: string | null
}

/** Resultado de descargar o cerrar una web que puede declarar cambios pendientes. */
export type UnloadResult = 'unloaded' | 'kept'

/** Rectángulo del panel principal en píxeles CSS de la ventana; la web entra aquí. */
export interface PanelBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}
