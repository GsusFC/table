import { describe, expect, it } from 'vitest'
import type { Card, Edge, Mesa, Note } from '../../shared/model'
import { LocalWrites, mergeReloadedMesa } from './agentReload'

const AT = '2026-10-27T10:00:00.000Z'

function note(id: string, text: string, x = 0): Note {
  return { id, text, position: { x, y: 0 }, size: { width: 240, height: 144 }, createdAt: AT, updatedAt: AT }
}

function card(id: string, x: number): Card {
  return {
    id,
    url: 'https://example.com/',
    serviceId: 'web',
    title: null,
    position: { x, y: 0 },
    size: { width: 320, height: 220 },
    capturedAt: null,
    createdAt: AT,
    updatedAt: AT,
  }
}

function mesa(parts: Partial<Mesa>): Mesa {
  return {
    schemaVersion: 3,
    id: 'm',
    name: 'Mesa',
    createdAt: AT,
    updatedAt: AT,
    viewport: { x: 0, y: 0, zoom: 1 },
    cards: [],
    notes: [],
    edges: [],
    results: [],
    dismissedResults: [],
    agentNotion: 'files',
    ...parts,
  }
}

describe('lecturas tras un cambio del agente', () => {
  it('el texto de una nota con un guardado en curso no se pisa con el del disco', () => {
    const writes = new LocalWrites()
    const mark = writes.mark()
    const end = writes.begin('n', ['text'])
    const current = mesa({ notes: [note('n', 'Escrito por la persona')] })
    const loaded = mesa({ notes: [note('n', 'Antes')], cards: [card('c', 0)] })
    const merged = mergeReloadedMesa(current, loaded, (id, field) => writes.protects(id, field, mark))
    expect(merged.notes[0]?.text).toBe('Escrito por la persona')
    // Lo que añadió el agente llega igual.
    expect(merged.cards.map(item => item.id)).toEqual(['c'])
    end()
  })

  it('una lectura pedida antes de un guardado ya terminado tampoco lo deshace', () => {
    const writes = new LocalWrites()
    const mark = writes.mark()
    writes.begin('n', ['text'])()
    const merged = mergeReloadedMesa(
      mesa({ notes: [note('n', 'Nuevo')] }),
      mesa({ notes: [note('n', 'Viejo')] }),
      (id, field) => writes.protects(id, field, mark),
    )
    expect(merged.notes[0]?.text).toBe('Nuevo')
    // Una lectura posterior al guardado sí manda.
    const later = writes.mark()
    const fresh = mergeReloadedMesa(
      mesa({ notes: [note('n', 'Nuevo')] }),
      mesa({ notes: [note('n', 'Cambiado por el agente')] }),
      (id, field) => writes.protects(id, field, later),
    )
    expect(fresh.notes[0]?.text).toBe('Cambiado por el agente')
  })

  it('la geometría con un guardado local manda; la del agente se aplica en lo demás', () => {
    const writes = new LocalWrites()
    const mark = writes.mark()
    writes.begin('a', ['geometry'])
    const merged = mergeReloadedMesa(
      mesa({ cards: [card('a', 500), card('b', 0)] }),
      mesa({ cards: [card('a', 0), card('b', 900)] }),
      (id, field) => writes.protects(id, field, mark),
    )
    expect(merged.cards.map(item => item.position.x)).toEqual([500, 900])
  })

  it('lo que la persona acaba de borrar no vuelve; lo que acaba de crear no desaparece; lo del agente sí cambia', () => {
    const writes = new LocalWrites()
    const mark = writes.mark()
    writes.begin('borrada', ['exists'])
    writes.touch('creada', ['exists'])
    writes.touch('e1', ['exists'])
    const edge = (id: string, source: string, target: string): Edge => ({ id, source, target, createdAt: AT })
    const merged = mergeReloadedMesa(
      mesa({ notes: [note('creada', ''), note('del-agente-borrada', '')], edges: [edge('e1', 'creada', 'nueva-del-agente')] }),
      mesa({
        notes: [note('borrada', ''), note('nueva-del-agente', '')],
        // La conexión de la nota que la persona acaba de borrar tampoco vuelve.
        edges: [edge('e2', 'borrada', 'nueva-del-agente')],
      }),
      (id, field) => writes.protects(id, field, mark),
    )
    expect(merged.notes.map(item => item.id).sort()).toEqual(['creada', 'nueva-del-agente'])
    expect(merged.edges.map(item => item.id)).toEqual(['e1'])
  })

  it('el nombre y la vista son siempre los locales', () => {
    const merged = mergeReloadedMesa(
      mesa({ name: 'Renombrada', viewport: { x: 10, y: 20, zoom: 2 } }),
      mesa({ name: 'Mesa', viewport: { x: 0, y: 0, zoom: 1 }, agentNotion: 'mcp' }),
      () => false,
    )
    expect(merged).toMatchObject({ name: 'Renombrada', viewport: { x: 10, y: 20, zoom: 2 }, agentNotion: 'mcp' })
  })
})
