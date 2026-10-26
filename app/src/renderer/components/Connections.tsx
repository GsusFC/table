import {
  BaseEdge,
  getBezierPath,
  Handle,
  Position,
  useInternalNode,
  type Edge as FlowEdge,
  type EdgeProps,
  type InternalNode,
} from '@xyflow/react'
import { memo } from 'react'
import { connectionEnds, type Rect, type Side } from '../lib/layout'

export type ConnectionEdgeType = FlowEdge<Record<string, never>, 'connection'>

const POSITIONS: Record<Side, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
}

/** Ancho de la zona que acepta el clic sobre una conexión, en píxeles del lienzo. */
const EDGE_HIT_WIDTH = 16

/**
 * Asas de conexión de un elemento del lienzo. Las de los lados empiezan una
 * conexión (se ven al pasar por encima); mientras se arrastra, todo el
 * elemento acepta soltarla (`connection-drop`, que solo recibe el puntero
 * durante una conexión). Se colocan después del contenido para quedar encima.
 */
export function ConnectionHandles() {
  return (
    <>
      {(Object.keys(POSITIONS) as Side[]).map(side => (
        <Handle
          key={side}
          id={side}
          type="source"
          position={POSITIONS[side]}
          isConnectableEnd={false}
          className="connection-handle"
          aria-label="Arrastra para conectar"
          title="Arrastra para conectar"
        />
      ))}
      <Handle id="drop" type="target" position={Position.Top} isConnectableStart={false} className="connection-drop" />
    </>
  )
}

function rectOf(node: InternalNode): Rect {
  return {
    id: node.id,
    x: node.internals.positionAbsolute.x,
    y: node.internals.positionAbsolute.y,
    width: node.measured.width ?? node.width ?? 0,
    height: node.measured.height ?? node.height ?? 0,
  }
}

/**
 * Conexión sin dirección ni lados guardados: une los lados enfrentados de los
 * dos elementos según dónde estén en cada momento.
 */
export const ConnectionEdge = memo(function ConnectionEdge({ id, source, target }: EdgeProps<ConnectionEdgeType>) {
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)
  if (!sourceNode || !targetNode) {
    return null
  }
  const ends = connectionEnds(rectOf(sourceNode), rectOf(targetNode))
  const [path] = getBezierPath({
    sourceX: ends.source.x,
    sourceY: ends.source.y,
    sourcePosition: POSITIONS[ends.source.side],
    targetX: ends.target.x,
    targetY: ends.target.y,
    targetPosition: POSITIONS[ends.target.side],
  })
  return <BaseEdge id={id} path={path} interactionWidth={EDGE_HIT_WIDTH} />
})
