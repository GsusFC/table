import { describe, expect, it } from 'vitest'
import { alignEdge, arrangeInGrid, GRID, magnetSnap, type Rect } from './layout'

/** Paso de una tarjeta de 320×220 con separación, redondeado a la rejilla. */
const STEP_X = 360
const STEP_Y = 264

const rect = (id: string, x: number, y: number, width = 320, height = 220): Rect => ({ id, x, y, width, height })

describe('magnetSnap', () => {
  const anchor = rect('a', 0, 0)

  it('alinea el borde izquierdo con el de otra tarjeta cercana y muestra la guía', () => {
    const { position, guides } = magnetSnap(rect('m', 5, 400), [anchor], 8)
    expect(position.x).toBe(0)
    expect(guides.vertical).toBe(0)
  })

  it('alinea centros cuando son lo más cercano', () => {
    // Centro de la móvil (ancho 200) en 163 frente al centro del ancla en 160.
    const { position, guides } = magnetSnap(rect('m', 63, 400, 200), [anchor], 8)
    expect(position.x + 100).toBe(160)
    expect(guides.vertical).toBe(160)
  })

  it('pega el borde superior al inferior de otra tarjeta', () => {
    const { position, guides } = magnetSnap(rect('m', 600, 224), [anchor], 8)
    expect(position.y).toBe(220)
    expect(guides.horizontal).toBe(220)
  })

  it('sin tarjetas cerca, ajusta a la rejilla y no muestra guías', () => {
    const { position, guides } = magnetSnap(rect('m', 1000 + 13, 1000 - 5), [anchor], 8)
    expect(position).toEqual({ x: 1008, y: 984 })
    expect(position.x % GRID).toBe(0)
    expect(guides).toEqual({ vertical: null, horizontal: null })
  })

  it('no se alinea consigo misma', () => {
    const { guides } = magnetSnap(rect('a', 3, 3), [anchor], 8)
    expect(guides).toEqual({ vertical: null, horizontal: null })
  })
})

describe('arrangeInGrid', () => {
  it('ordena en cuadrícula conservando el orden de lectura', () => {
    const cards = [rect('c', 900, 10), rect('a', 0, 0), rect('d', 50, 500), rect('b', 400, 5)]
    const positions = arrangeInGrid(cards)
    // 4 tarjetas → 2 columnas: a b / c d (c está en la primera fila por altura).
    expect(positions.get('a')).toEqual({ x: 0, y: 0 })
    expect(positions.get('b')).toEqual({ x: STEP_X, y: 0 })
    expect(positions.get('c')).toEqual({ x: 0, y: STEP_Y })
    expect(positions.get('d')).toEqual({ x: STEP_X, y: STEP_Y })
  })

  it('todas las posiciones quedan sobre la rejilla', () => {
    const positions = arrangeInGrid([rect('a', 5, 5, 333, 201), rect('b', 600, 0, 250), rect('c', 0, 400)])
    for (const position of positions.values()) {
      expect(position.x % GRID).toBe(0)
      expect(position.y % GRID).toBe(0)
    }
  })

  it('las columnas toman el ancho de su tarjeta más ancha, sin solapes', () => {
    const positions = arrangeInGrid([rect('a', 0, 0, 500), rect('b', 600, 0, 200), rect('c', 0, 400, 300)])
    // 500 + 24 = 524 → 528 en la rejilla.
    expect(positions.get('b')?.x).toBe(528)
    expect(positions.get('c')).toEqual({ x: 0, y: STEP_Y })
  })

  it('empieza en la esquina del grupo ajustada a la rejilla', () => {
    const positions = arrangeInGrid([rect('a', 37, 61), rect('b', 500, 70)])
    expect(positions.get('a')).toEqual({ x: 48, y: 72 })
  })
})

describe('alignEdge', () => {
  it('alinea a la izquierda sin mover el otro eje', () => {
    const positions = alignEdge([rect('a', 40, 0), rect('b', 10, 300)], 'left')
    expect(positions.get('a')).toEqual({ x: 10, y: 0 })
    expect(positions.get('b')).toEqual({ x: 10, y: 300 })
  })

  it('alinea arriba', () => {
    const positions = alignEdge([rect('a', 0, 90), rect('b', 400, 30)], 'top')
    expect(positions.get('a')).toEqual({ x: 0, y: 30 })
  })
})
