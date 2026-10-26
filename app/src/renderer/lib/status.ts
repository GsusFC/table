import type { SurfaceCardState } from '../../shared/surface'

export type CardStatusTone = 'neutral' | 'progress' | 'live' | 'danger'

export interface CardStatus {
  readonly label: string
  readonly tone: CardStatusTone
  /** La web está cargada (en el panel o conservada en memoria). */
  readonly loaded: boolean
}

/** Estado visible de una tarjeta. Sin estado de la superficie: descargada. */
export function cardStatus(state: SurfaceCardState | undefined): CardStatus {
  switch (state?.status) {
    case 'loading':
      return { label: 'Cargando', tone: 'progress', loaded: true }
    case 'ready':
      return state.entered
        ? { label: 'Abierta', tone: 'live', loaded: true }
        : { label: 'En memoria', tone: 'live', loaded: true }
    case 'failed':
      // La vista puede seguir creada tras el fallo: descargarla limpia el estado.
      return { label: 'Error', tone: 'danger', loaded: true }
    default:
      return { label: 'Descargada', tone: 'neutral', loaded: false }
  }
}
