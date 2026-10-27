import type { ResizeParams } from '@xyflow/react'
import { createContext, useContext } from 'react'
import type { CardId, ItemId, MesaId, NoteId, ResultId } from '../../shared/model'
import type { SurfaceCardState } from '../../shared/surface'

/**
 * Lo que los nodos del lienzo necesitan de la mesa. Va por contexto para que
 * los datos de cada nodo sean solo su tarjeta o su nota.
 */
export interface CanvasContextValue {
  readonly mesaId: MesaId
  readonly states: ReadonlyMap<CardId, SurfaceCardState>
  /** Elemento (tarjeta, nota o resultado) cuyo menú está abierto, para `aria-expanded`. */
  readonly menuItemId: ItemId | null
  /** Nota cuyo texto se está editando; como mucho una. */
  readonly editingNoteId: NoteId | null
  /** Resultados cuyo archivo ya no está en `resultados/`. */
  readonly missingResults: ReadonlySet<ResultId>
  enter(cardId: CardId): void
  openMenu(itemId: ItemId, anchor: { readonly x: number; readonly y: number }): void
  /** Fin de redimensionar una tarjeta, una nota o un resultado. */
  resizeEnd(id: ItemId, params: ResizeParams): void
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
