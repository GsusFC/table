import type { Point } from '../../shared/model'

/** Paso de la rejilla del lienzo; coincide con los puntos del fondo. */
export const GRID = 24
/** Separación mínima entre tarjetas al ordenar. */
export const ARRANGE_GAP = GRID

export interface Rect {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Líneas guía activas, en coordenadas del lienzo. */
export interface Guides {
  readonly vertical: number | null
  readonly horizontal: number | null
}

export const NO_GUIDES: Guides = { vertical: null, horizontal: null }

export const snapToGrid = (value: number): number => Math.round(value / GRID) * GRID

/** Tamaño más separación, redondeado hacia arriba a la rejilla. */
const gridStep = (size: number): number => Math.ceil((size + ARRANGE_GAP) / GRID) * GRID

interface AxisSnap {
  readonly position: number
  readonly guide: number | null
}

/**
 * Imán en un eje: alinea el borde inicial, el centro o el borde final de la
 * tarjeta con el de otra si está a menos de `threshold`; si no, a la rejilla.
 */
function snapAxis(start: number, size: number, others: readonly { start: number; size: number }[], threshold: number): AxisSnap {
  const own = [start, start + size / 2, start + size]
  let best: { distance: number; position: number; guide: number } | null = null
  for (const other of others) {
    const targets = [other.start, other.start + other.size / 2, other.start + other.size]
    for (const [index, value] of own.entries()) {
      for (const target of targets) {
        const distance = Math.abs(value - target)
        if (distance <= threshold && (!best || distance < best.distance)) {
          // Desplaza la tarjeta para que su referencia `index` caiga en `target`.
          const offset = index === 0 ? 0 : index === 1 ? size / 2 : size
          best = { distance, position: target - offset, guide: target }
        }
      }
    }
  }
  return best ? { position: best.position, guide: best.guide } : { position: snapToGrid(start), guide: null }
}

/**
 * Posición con imán para una tarjeta que se arrastra sola: se alinea con los
 * bordes o centros de las demás y, si ninguna está cerca, con la rejilla.
 */
export function magnetSnap(moving: Rect, others: readonly Rect[], threshold: number): { position: Point; guides: Guides } {
  const candidates = others.filter(other => other.id !== moving.id)
  const x = snapAxis(
    moving.x,
    moving.width,
    candidates.map(other => ({ start: other.x, size: other.width })),
    threshold,
  )
  const y = snapAxis(
    moving.y,
    moving.height,
    candidates.map(other => ({ start: other.y, size: other.height })),
    threshold,
  )
  return { position: { x: x.position, y: y.position }, guides: { vertical: x.guide, horizontal: y.guide } }
}

/** Orden de lectura: filas de arriba abajo (agrupando las que se solapan en vertical) y, dentro, de izquierda a derecha. */
function readingOrder(rects: readonly Rect[]): Rect[] {
  const byTop = [...rects].sort((a, b) => a.y - b.y || a.x - b.x)
  const rows: Rect[][] = []
  for (const rect of byTop) {
    const row = rows.at(-1)
    const rowBottom = row ? Math.min(...row.map(item => item.y + item.height)) : -Infinity
    if (row && rect.y < rowBottom) {
      row.push(rect)
    } else {
      rows.push([rect])
    }
  }
  return rows.flatMap(row => row.sort((a, b) => a.x - b.x))
}

/**
 * Ordena en una cuadrícula casi cuadrada, conservando el orden de lectura y
 * empezando en la esquina superior izquierda del grupo. Cada columna toma el
 * ancho de su tarjeta más ancha y cada fila, el alto de la más alta; los pasos
 * se redondean hacia arriba a la rejilla para que todo quede sobre ella.
 */
export function arrangeInGrid(rects: readonly Rect[]): Map<string, Point> {
  const ordered = readingOrder(rects)
  const result = new Map<string, Point>()
  if (ordered.length === 0) {
    return result
  }
  const columns = Math.ceil(Math.sqrt(ordered.length))
  const rowCount = Math.ceil(ordered.length / columns)
  const columnWidths = Array.from({ length: columns }, (_, column) =>
    Math.max(...ordered.filter((_, index) => index % columns === column).map(rect => rect.width)),
  )
  const rowHeights = Array.from({ length: rowCount }, (_, row) =>
    Math.max(...ordered.slice(row * columns, row * columns + columns).map(rect => rect.height)),
  )
  const originX = snapToGrid(Math.min(...ordered.map(rect => rect.x)))
  const originY = snapToGrid(Math.min(...ordered.map(rect => rect.y)))
  ordered.forEach((rect, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const x = originX + columnWidths.slice(0, column).reduce((sum, width) => sum + gridStep(width), 0)
    const y = originY + rowHeights.slice(0, row).reduce((sum, height) => sum + gridStep(height), 0)
    result.set(rect.id, { x, y })
  })
  return result
}

/** Alinea por el borde izquierdo o superior más alejado; el otro eje no cambia. */
export function alignEdge(rects: readonly Rect[], edge: 'left' | 'top'): Map<string, Point> {
  const result = new Map<string, Point>()
  if (rects.length === 0) {
    return result
  }
  const target = edge === 'left' ? Math.min(...rects.map(rect => rect.x)) : Math.min(...rects.map(rect => rect.y))
  for (const rect of rects) {
    result.set(rect.id, edge === 'left' ? { x: target, y: rect.y } : { x: rect.x, y: target })
  }
  return result
}

export type Side = 'top' | 'right' | 'bottom' | 'left'

export interface ConnectionEnd extends Point {
  readonly side: Side
}

/** Punto medio de un lado del rectángulo. */
function sideMidpoint(rect: Rect, side: Side): ConnectionEnd {
  switch (side) {
    case 'top':
      return { x: rect.x + rect.width / 2, y: rect.y, side }
    case 'bottom':
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height, side }
    case 'left':
      return { x: rect.x, y: rect.y + rect.height / 2, side }
    case 'right':
      return { x: rect.x + rect.width, y: rect.y + rect.height / 2, side }
  }
}

/**
 * Extremos de una conexión entre dos elementos: los lados enfrentados según
 * su posición relativa (izquierda/derecha si están más separados en
 * horizontal, arriba/abajo si no), para que la línea no cruce los elementos
 * aunque se muevan. Las conexiones no tienen dirección ni lados guardados.
 */
export function connectionEnds(source: Rect, target: Rect): { source: ConnectionEnd; target: ConnectionEnd } {
  const dx = target.x + target.width / 2 - (source.x + source.width / 2)
  const dy = target.y + target.height / 2 - (source.y + source.height / 2)
  // Separación relativa al tamaño: dos elementos anchos y cercanos en vertical se unen por arriba/abajo.
  const horizontal = Math.abs(dx) / (source.width + target.width) >= Math.abs(dy) / (source.height + target.height)
  if (horizontal) {
    return dx >= 0
      ? { source: sideMidpoint(source, 'right'), target: sideMidpoint(target, 'left') }
      : { source: sideMidpoint(source, 'left'), target: sideMidpoint(target, 'right') }
  }
  return dy >= 0
    ? { source: sideMidpoint(source, 'bottom'), target: sideMidpoint(target, 'top') }
    : { source: sideMidpoint(source, 'top'), target: sideMidpoint(target, 'bottom') }
}
