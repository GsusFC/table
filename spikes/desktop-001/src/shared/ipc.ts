export const IPC = {
  open: 'surface:open',
  enter: 'surface:enter',
  exit: 'surface:exit',
  unload: 'surface:unload',
  setBounds: 'surface:set-bounds',
  setZoom: 'surface:set-zoom',
  getState: 'surface:get-state',
  state: 'surface:state',
} as const

/**
 * Estados de la tarjeta web (ver docs/memory-validation.md):
 * - activa: `entered`; visible y con la interacción.
 * - conservada: `ready`/`loading` sin `entered`; cargada y oculta, consume memoria.
 * - descargada: `unloaded`; contenido cerrado, quedan URL y captura.
 */
export type SurfaceStatus = 'empty' | 'loading' | 'ready' | 'failed' | 'unloaded'

export type UnloadResult = 'unloaded' | 'kept'

export interface SurfaceState {
  readonly status: SurfaceStatus
  /** La superficie web está visible y recibe la interacción. */
  readonly entered: boolean
  readonly url: string | null
  readonly title: string | null
  readonly zoomFactor: number
  /** Captura tomada al salir; no representa la web activa. */
  readonly captureDataUrl: string | null
  /** Momento de la captura, en milisegundos desde epoch. */
  readonly capturedAt: number | null
  /** Duración de la última carga hasta `did-stop-loading`, en milisegundos. */
  readonly loadMs: number | null
  readonly error: string | null
  /** Último popup: abierto como ventana hija o bloqueado. */
  readonly lastPopup: { readonly origin: string; readonly opened: boolean } | null
}

export interface SurfaceBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface TableSpikeApi {
  readonly platform: string
  open(url: string): Promise<void>
  enter(): Promise<void>
  exit(): Promise<void>
  /** Cierra el contenido respetando `beforeunload`; `kept` si el usuario lo mantiene. */
  unload(): Promise<UnloadResult>
  setBounds(bounds: SurfaceBounds): void
  setZoom(factor: number): Promise<void>
  getState(): Promise<SurfaceState>
  onState(listener: (state: SurfaceState) => void): () => void
}
