import { NodeResizer, type Node, type NodeProps } from '@xyflow/react'
import { memo, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { MAX_NOTE_TEXT_LENGTH, type Note, type NoteId } from '../../shared/model'
import { CARD_MAX_DIMENSION } from './CardNode'
import { useCanvas } from './canvasContext'
import { ConnectionHandles } from './Connections'

export type NoteNodeType = Node<{ note: Note }, 'note'>

export const NOTE_MIN_WIDTH = 160
export const NOTE_MIN_HEIGHT = 96

/** Nota interna en el lienzo: texto plano. Doble clic (o Enter) para editar. */
export const NoteNode = memo(function NoteNode({ id, data, selected }: NodeProps<NoteNodeType>) {
  const canvas = useCanvas()
  const { note } = data
  const editing = canvas.editingNoteId === id

  return (
    <>
      <NodeResizer
        isVisible={selected && !editing}
        minWidth={NOTE_MIN_WIDTH}
        minHeight={NOTE_MIN_HEIGHT}
        maxWidth={CARD_MAX_DIMENSION}
        maxHeight={CARD_MAX_DIMENSION}
        lineClassName="card-resize-line"
        handleClassName="card-resize-handle"
        onResizeEnd={(_event, params) => canvas.resizeEnd(id, params)}
      />
      <article className={editing ? 'note note-editing' : 'note'} aria-label="Nota">
        {editing ? (
          <NoteEditor noteId={id} initialText={note.text} />
        ) : note.text ? (
          <p className="note-text">{note.text}</p>
        ) : (
          <p className="note-text note-placeholder">Doble clic para escribir</p>
        )}
      </article>
      <ConnectionHandles />
    </>
  )
})

/**
 * Campo de edición. Sus teclas no llegan al lienzo ni a React Flow (clase
 * `nokey`): ⌫, ⌘A y las flechas actúan sobre el texto. Esc o salir del campo
 * terminan la edición; el texto se guarda solo mientras se escribe.
 */
function NoteEditor({ noteId, initialText }: { readonly noteId: NoteId; readonly initialText: string }) {
  const canvas = useCanvas()
  const ref = useRef<HTMLTextAreaElement>(null)
  // El texto vive aquí mientras se edita: lo que llegue del disco no pisa lo que se escribe.
  const [text, setText] = useState(initialText)

  useLayoutEffect(() => {
    const element = ref.current
    if (element) {
      element.focus({ preventScroll: true })
      element.setSelectionRange(element.value.length, element.value.length)
    }
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      canvas.stopEditingNote(noteId)
      // El foco vuelve a la nota para seguir con el teclado.
      ref.current?.closest<HTMLElement>('.react-flow__node')?.focus({ preventScroll: true })
    }
  }

  return (
    <textarea
      ref={ref}
      className="note-input nodrag nopan nowheel nokey"
      aria-label="Texto de la nota"
      value={text}
      maxLength={MAX_NOTE_TEXT_LENGTH}
      spellCheck
      onChange={event => {
        setText(event.target.value)
        canvas.changeNoteText(noteId, event.target.value)
      }}
      onKeyDown={onKeyDown}
      onBlur={() => {
        // Cambiar de app no termina la edición (el guardado con retardo sigue en marcha).
        if (document.hasFocus()) {
          canvas.stopEditingNote(noteId)
        }
      }}
    />
  )
}
