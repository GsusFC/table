import type { ResizeParams } from '@xyflow/react'
import { createContext, useContext } from 'react'
import type { CardId, MesaId } from '../../shared/model'
import type { SurfaceCardState } from '../../shared/surface'

/**
 * Lo que los nodos del lienzo necesitan de la mesa. Va por contexto para que
 * los datos de cada nodo sean solo su tarjeta.
 */
export interface CanvasContextValue {
  readonly mesaId: MesaId
  readonly states: ReadonlyMap<CardId, SurfaceCardState>
  /** Tarjeta cuyo menú está abierto, para `aria-expanded`. */
  readonly menuCardId: CardId | null
  enter(cardId: CardId): void
  openMenu(cardId: CardId, anchor: { readonly x: number; readonly y: number }): void
  resizeEnd(cardId: CardId, params: ResizeParams): void
}

export const CanvasContext = createContext<CanvasContextValue | null>(null)

export function useCanvas(): CanvasContextValue {
  const value = useContext(CanvasContext)
  if (!value) {
    throw new Error('CardNode fuera del lienzo')
  }
  return value
}
