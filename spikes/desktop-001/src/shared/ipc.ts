export const IPC = {
  open: 'surface:open',
  enter: 'surface:enter',
  exit: 'surface:exit',
  setBounds: 'surface:set-bounds',
  setZoom: 'surface:set-zoom',
  getState: 'surface:get-state',
  state: 'surface:state',
} as const

export type SurfaceStatus = 'empty' | 'loading' | 'ready' | 'failed'

export interface SurfaceState {
  readonly status: SurfaceStatus
  /** La superficie web está visible y recibe la interacción. */
  readonly entered: boolean
  readonly url: string | null
  readonly title: string | null
  readonly zoomFactor: number
  /** Captura tomada al salir; no representa la web activa. */
  readonly captureDataUrl: string | null
  readonly error: string | null
  /** Origen del último popup denegado. */
  readonly lastBlockedPopup: string | null
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
  setBounds(bounds: SurfaceBounds): void
  setZoom(factor: number): Promise<void>
  getState(): Promise<SurfaceState>
  onState(listener: (state: SurfaceState) => void): () => void
}
