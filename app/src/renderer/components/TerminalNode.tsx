import { NodeResizer, useStore, type Node, type NodeProps } from '@xyflow/react'
import { PanelRight, SquareTerminal } from 'lucide-react'
import { memo } from 'react'
import type { SessionId } from '../../shared/terminal'
import { moveDetached, sessionStatus, TERMINAL_CARD_MIN, useSession } from '../lib/terminals'
import { useCanvas } from './canvasContext'
import { CARD_MAX_DIMENSION } from './CardNode'
import { TerminalView } from './TerminalView'

export type TerminalNodeType = Node<{ sessionId: SessionId }, 'terminal'>

/**
 * Sesión desacoplada: tarjeta flotante en el lienzo con el mismo terminal del
 * panel. No es parte de la mesa (no se guarda, no se conecta ni se ordena); se
 * arrastra por la cabecera y las teclas y la rueda van al terminal.
 *
 * El terminal no se escala con el lienzo: xterm calcula la celda bajo el ratón
 * con medidas sin transformar, así que una capa deshace el zoom (mide el área
 * multiplicada por el zoom y se reduce en la misma proporción) y la letra crece
 * con el zoom. En pantalla queda 1:1 y la selección cae en la celda correcta.
 */
export const TerminalNode = memo(function TerminalNode({ data }: NodeProps<TerminalNodeType>) {
  const canvas = useCanvas()
  const session = useSession(data.sessionId)
  const zoom = useStore(state => state.transform[2])
  if (!session) {
    return null
  }
  const status = sessionStatus(session)
  return (
    <>
      <NodeResizer
        isVisible
        minWidth={TERMINAL_CARD_MIN.width}
        minHeight={TERMINAL_CARD_MIN.height}
        maxWidth={CARD_MAX_DIMENSION}
        maxHeight={CARD_MAX_DIMENSION}
        lineClassName="terminal-resize-line"
        handleClassName="terminal-resize-handle"
        onResizeEnd={(_event, params) =>
          moveDetached(session.id, {
            position: { x: Math.round(params.x), y: Math.round(params.y) },
            size: { width: Math.round(params.width), height: Math.round(params.height) },
          })
        }
      />
      <article className="terminal-card" aria-label={`Sesión ${session.title}`}>
        <header className="terminal-card-header">
          <SquareTerminal aria-hidden size={15} strokeWidth={1.75} />
          <span className="terminal-card-title" title={session.cwd}>
            {session.title}
          </span>
          <span className={`status status-${status.tone}`}>{status.label}</span>
          <button
            type="button"
            className="button button-small nodrag"
            onClick={() => canvas.attachTerminal(session.id)}
          >
            <PanelRight aria-hidden size={13} strokeWidth={1.75} />
            Volver al panel
          </button>
        </header>
        <div className="terminal-card-body nodrag nopan nowheel nokey">
          <div
            className="terminal-card-unscaled"
            style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%`, transform: `scale(${1 / zoom})` }}
          >
            <TerminalView sessionId={session.id} fontScale={zoom} />
          </div>
        </div>
      </article>
    </>
  )
})
