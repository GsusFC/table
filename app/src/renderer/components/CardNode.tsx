import { NodeResizer, type Node, type NodeProps } from '@xyflow/react'
import { Ellipsis, TriangleAlert } from 'lucide-react'
import { memo, useState } from 'react'
import { CAPTURE_PROTOCOL } from '../../shared/ipc'
import type { Card } from '../../shared/model'
import { serviceById } from '../../shared/services'
import { absoluteDate, displayHost, relativeDate } from '../lib/format'
import { cardStatus } from '../lib/status'
import { useCanvas } from './canvasContext'
import { ProjectFace, ProjectSource, useProjectView } from './ProjectFace'
import { ServiceBadge } from './ServiceBadge'

export type CardNodeType = Node<{ card: Card }, 'card'>

export const CARD_MIN_WIDTH = 200
export const CARD_MIN_HEIGHT = 150
export const CARD_MAX_DIMENSION = 4000

/**
 * Tarjeta web en el lienzo: captura, servicio, título y estado de su web. Si es
 * una ficha de la base de proyectos de Notion, muestra la ficha en lugar de la captura.
 */
export const CardNode = memo(function CardNode({ id, data, selected }: NodeProps<CardNodeType>) {
  const canvas = useCanvas()
  const { card } = data
  const service = serviceById(card.serviceId)
  const state = canvas.states.get(card.id)
  const status = cardStatus(state)
  const host = displayHost(state?.currentUrl ?? card.url)
  const project = useProjectView(canvas.mesaId, card.id, service.id === 'notion')
  const title = project.snapshot?.title || ((status.loaded ? state?.title : null) ?? card.title ?? host)

  const captureSrc = card.capturedAt
    ? `${CAPTURE_PROTOCOL}://${canvas.mesaId}/${card.id}?v=${encodeURIComponent(card.capturedAt)}`
    : null
  // Si la captura no carga (borrada a mano, error de lectura) se muestra el marcador.
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null)
  const showCapture = captureSrc !== null && brokenSrc !== captureSrc
  const menuOpen = canvas.menuCardId === card.id

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
      <article className="card" aria-label={`${service.name}: ${title}`}>
        <header className="card-header">
          <ServiceBadge service={service} />
          <span className="card-service">{service.name}</span>
          <span className={`status status-${status.tone}`} title={state?.error ?? undefined}>
            {status.label}
          </span>
          <button
            type="button"
            className="icon-button icon-button-small nodrag"
            aria-label={`Acciones de la tarjeta ${title}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={event => {
              const rect = event.currentTarget.getBoundingClientRect()
              canvas.openMenu(card.id, { x: rect.right, y: rect.bottom + 4 })
            }}
          >
            <Ellipsis aria-hidden size={16} strokeWidth={1.75} />
          </button>
        </header>

        <div className={project.snapshot ? 'card-preview card-preview-project' : 'card-preview'}>
          {project.snapshot ? (
            <ProjectFace view={project} />
          ) : showCapture ? (
            <img
              className="card-capture"
              src={captureSrc}
              alt=""
              draggable={false}
              onError={() => setBrokenSrc(captureSrc)}
            />
          ) : (
            <div className="card-placeholder">
              <ServiceBadge service={service} size="lg" />
              <span className="card-placeholder-host">{host}</span>
            </div>
          )}
          {state?.status === 'failed' && (
            <p className="card-error" role="status">
              <TriangleAlert aria-hidden size={14} strokeWidth={1.75} />
              <span>{state.error ?? 'La web no se pudo cargar'}</span>
            </p>
          )}
        </div>

        <footer className="card-footer">
          <div className="card-text">
            <span className="card-title" title={title}>
              {title}
            </span>
            <span className="card-meta">
              {project.snapshot ? (
                <ProjectSource snapshot={project.snapshot} problem={project.problem} />
              ) : !status.loaded && card.capturedAt ? (
                <time dateTime={card.capturedAt} title={absoluteDate(card.capturedAt)}>
                  Captura {relativeDate(card.capturedAt)}
                </time>
              ) : (
                host
              )}
            </span>
          </div>
          <button type="button" className="button button-small nodrag" onClick={() => canvas.enter(card.id)}>
            Entrar
          </button>
        </footer>
      </article>
    </>
  )
})
