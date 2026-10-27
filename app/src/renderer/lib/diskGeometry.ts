import type { Point, Size } from '../../shared/model'

/** Lo que importa de un nodo del lienzo para decidir su geometría. */
export interface LocalGeometry {
  readonly position: Point
  readonly width?: number
  readonly height?: number
  readonly dragging?: boolean
  readonly resizing?: boolean
}

interface Placed {
  readonly position: Point
  readonly size: Size
}

/** Diferencias menores que medio píxel son redondeos, no cambios. */
const TOLERANCE = 0.5

/**
 * Si el lienzo toma la geometría que llega del disco (`after`; p. ej. la movió
 * un agente, T-011) en lugar de la local. No, si no cambió respecto a la
 * anterior del disco (`before`), si la persona arrastra o redimensiona el
 * elemento, o si su geometría local aún no está guardada (difiere de `before`).
 */
export function takesDiskGeometry(node: LocalGeometry, before: Placed, after: Placed): boolean {
  const moved =
    before.position.x !== after.position.x ||
    before.position.y !== after.position.y ||
    before.size.width !== after.size.width ||
    before.size.height !== after.size.height
  const unsaved =
    Math.abs(node.position.x - before.position.x) > TOLERANCE ||
    Math.abs(node.position.y - before.position.y) > TOLERANCE ||
    Math.abs((node.width ?? before.size.width) - before.size.width) > TOLERANCE ||
    Math.abs((node.height ?? before.size.height) - before.size.height) > TOLERANCE
  return moved && !node.dragging && !node.resizing && !unsaved
}
