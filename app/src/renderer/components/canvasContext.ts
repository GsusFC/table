import type { ResizeParams } from '@xyflow/react'
import { createContext, useContext } from 'react'
import type { CardId, MesaId, NoteId } from '../../shared/model'
import type { SurfaceCardState } from '../../shared/surface'

/**
 * Lo que los nodos del lienzo necesitan de la mesa. Va por contexto para que
 * los datos de cada nodo sean solo su tarjeta o su nota.
 */
export interface CanvasContextValue {
  readonly mesaId: MesaId
  readonly states: ReadonlyMap<CardId, SurfaceCardState>
  /** Tarjeta cuyo menú está abierto, para `aria-expanded`. */
  readonly menuCardId: CardId | null
  /** Nota cuyo texto se está editando; como mucho una. */
  readonly editingNoteId: NoteId | null
  enter(cardId: CardId): void
  openMenu(cardId: CardId, anchor: { readonly x: number; readonly y: number }): void
  /** Fin de redimensionar una tarjeta o una nota. */
  resizeEnd(id: CardId | NoteId, params: ResizeParams): void
  /** Texto en edición: se guarda con retardo. */
  changeNoteText(noteId: NoteId, text: string): void
  /** Termina la edición y guarda ya el texto pendiente. */
  stopEditingNote(noteId: NoteId): void
  /** Devuelve una sesión desacoplada al panel de agentes. */
  attachTerminal(sessionId: string): void
}

export const CanvasContext = createContext<CanvasContextValue | null>(null)

export function useCanvas(): CanvasContextValue {
  const value = useContext(CanvasContext)
  if (!value) {
    throw new Error('Nodo fuera del lienzo')
  }
  return value
}
