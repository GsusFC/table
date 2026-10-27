import { describe, expect, it } from 'vitest'
import { takesDiskGeometry } from './diskGeometry'

const BEFORE = { position: { x: 0, y: 0 }, size: { width: 320, height: 220 } }
const AGENT_MOVED = { position: { x: 400, y: 0 }, size: { width: 320, height: 220 } }

describe('geometría que llega del disco tras un cambio del agente', () => {
  it('se aplica a un elemento que la persona no está tocando', () => {
    expect(takesDiskGeometry({ position: { x: 0, y: 0 }, width: 320, height: 220 }, BEFORE, AGENT_MOVED)).toBe(true)
  })

  it('no interrumpe un arrastre ni un redimensionado', () => {
    expect(takesDiskGeometry({ position: { x: 0, y: 0 }, width: 320, height: 220, dragging: true }, BEFORE, AGENT_MOVED)).toBe(false)
    expect(takesDiskGeometry({ position: { x: 0, y: 0 }, width: 500, height: 300, resizing: true }, BEFORE, AGENT_MOVED)).toBe(false)
  })

  it('no pisa una geometría local aún sin guardar (redimensionado o movido y pendiente)', () => {
    expect(takesDiskGeometry({ position: { x: 0, y: 0 }, width: 500, height: 300 }, BEFORE, AGENT_MOVED)).toBe(false)
    expect(takesDiskGeometry({ position: { x: 120, y: 48 }, width: 320, height: 220 }, BEFORE, AGENT_MOVED)).toBe(false)
  })

  it('sin cambio en disco no hay nada que aplicar; los redondeos no cuentan como cambio local', () => {
    expect(takesDiskGeometry({ position: { x: 0, y: 0 }, width: 320, height: 220 }, BEFORE, BEFORE)).toBe(false)
    expect(takesDiskGeometry({ position: { x: 0.4, y: -0.3 }, width: 320, height: 220 }, BEFORE, AGENT_MOVED)).toBe(true)
  })
})
