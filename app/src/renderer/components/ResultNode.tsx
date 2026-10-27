import { NodeResizer, type Node, type NodeProps } from '@xyflow/react'
import { Ellipsis, File, FileImage, FileText, TriangleAlert } from 'lucide-react'
import { memo, useEffect, useState } from 'react'
import { RESULT_PROTOCOL } from '../../shared/ipc'
import type { Result, ResultKind } from '../../shared/model'
import { absoluteDate, relativeDate } from '../lib/format'
import { CARD_MAX_DIMENSION, CARD_MIN_HEIGHT, CARD_MIN_WIDTH } from './CardNode'
import { useCanvas } from './canvasContext'
import { ConnectionHandles } from './Connections'

export type ResultNodeType = Node<{ result: Result }, 'result'>

const KIND_ICONS: Record<ResultKind, typeof File> = { image: FileImage, text: FileText, file: File }
const MISSING_TEXT = 'Archivo no encontrado'

/** Extensión en mayúsculas («PDF»), o el nombre si no tiene. */
function extensionOf(file: string): string {
  const dot = file.lastIndexOf('.')
  return dot > 0 && dot < file.length - 1 ? file.slice(dot + 1).toUpperCase() : file
}

/**
 * Tarjeta de resultado (T-008): un archivo que un agente dejó en `resultados/`.
 * Imagen con vista previa, texto con sus primeras líneas, otros con icono y
 * extensión. Si el archivo ya no está, lo dice; la tarjeta no lo borra nunca.
 */
export const ResultNode = memo(function ResultNode({ id, data, selected }: NodeProps<ResultNodeType>) {
  const canvas = useCanvas()
  const { result } = data
  const Icon = KIND_ICONS[result.kind]
  const menuOpen = canvas.menuItemId === result.id
  // El proceso principal comprueba el archivo; la imagen o el texto que no cargan también lo delatan.
  const missing = canvas.missingResults.has(result.id)

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={CARD_MIN_WIDTH}
        minHeight={CARD_MIN_HEIGHT}
        maxWidth={CARD_MAX_DIMENSION}
        maxHeight={CARD_MAX_DIMENSION}
        lineClassName="card-resize-line"
        handleClassName="card-resize-handle"
        onResizeEnd={(_event, params) => canvas.resizeEnd(id, params)}
      />
      <article className="card result" aria-label={`Resultado: ${result.file}`}>
        <header className="card-header">
          <Icon className="result-icon" aria-hidden size={15} strokeWidth={1.75} />
          <span className="card-service result-file" title={result.file}>
            {result.file}
          </span>
          <button
            type="button"
            className="icon-button icon-button-small nodrag"
            aria-label={`Acciones del resultado ${result.file}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={event => {
              const rect = event.currentTarget.getBoundingClientRect()
              canvas.openMenu(result.id, { x: rect.right, y: rect.bottom + 4 })
            }}
          >
            <Ellipsis aria-hidden size={16} strokeWidth={1.75} />
          </button>
        </header>

        <div className="card-preview">
          {missing ? (
            <Missing />
          ) : result.kind === 'image' ? (
            <ImagePreview result={result} />
          ) : result.kind === 'text' ? (
            <TextPreview result={result} />
          ) : (
            <div className="card-placeholder">
              <File aria-hidden size={40} strokeWidth={1.25} />
              <span className="card-placeholder-host">{extensionOf(result.file)}</span>
            </div>
          )}
        </div>

        <footer className="card-footer">
          <div className="card-text">
            <span className="card-meta">
              <time dateTime={result.updatedAt} title={absoluteDate(result.updatedAt)}>
                Resultado · {relativeDate(result.updatedAt)}
              </time>
            </span>
          </div>
        </footer>
      </article>
      <ConnectionHandles />
    </>
  )
})

function Missing() {
  return (
    <p className="card-error result-missing" role="status">
      <TriangleAlert aria-hidden size={14} strokeWidth={1.75} />
      <span>{MISSING_TEXT}</span>
    </p>
  )
}

function ImagePreview({ result }: { readonly result: Result }) {
  const canvas = useCanvas()
  const src = `${RESULT_PROTOCOL}://${canvas.mesaId}/${result.id}?v=${encodeURIComponent(result.updatedAt)}`
  // Si la imagen no carga (archivo borrado o movido) se avisa; con otra versión se vuelve a intentar.
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null)
  if (brokenSrc === src) {
    return <Missing />
  }
  return <img className="result-image" src={src} alt="" draggable={false} onError={() => setBrokenSrc(src)} />
}

function TextPreview({ result }: { readonly result: Result }) {
  const canvas = useCanvas()
  /** undefined mientras se lee; null si el archivo falta. */
  const [text, setText] = useState<string | null | undefined>(undefined)
  const { mesaId } = canvas
  useEffect(() => {
    let active = true
    window.table.results.preview(mesaId, result.id).then(
      value => active && setText(value),
      () => active && setText(null),
    )
    return () => {
      active = false
    }
    // La versión (`updatedAt`) cambia cuando cambia el archivo.
  }, [mesaId, result.id, result.updatedAt])
  if (text === null) {
    return <Missing />
  }
  return <pre className="result-text">{text ?? ''}</pre>
}
