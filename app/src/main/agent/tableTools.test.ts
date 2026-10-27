import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_TOOLS, type AgentToolName } from '../../shared/agentTools'
import type { ItemId, Mesa, MesaId } from '../../shared/model'
import type { ProjectSnapshot } from '../../shared/notion'
import { createMesaStore } from '../store/mesaStore'
import type { MesaStore } from '../store/types'
import { createTableToolHandlers, type RemovalRequest, type TableToolHandler } from './tableTools'

const NOTION_URL = 'https://www.notion.so/ficha-0123456789abcdef0123456789abcdef'
const SNAPSHOT: ProjectSnapshot = {
  pageId: '0123456789abcdef0123456789abcdef',
  title: 'Proyecto sintético',
  fields: [
    { name: 'Status', label: 'Estado', value: { kind: 'status', option: { name: 'In progress', color: 'blue' } } },
    { name: 'Budget', label: 'Budget', value: { kind: 'tags', options: [{ name: 'SECRETO 12.000 €', color: 'red' }] } },
  ],
  fetchedAt: '2026-10-27T09:00:00.000Z',
  editedAt: '2026-10-26T09:00:00.000Z',
}

let base: string
let work: string
let store: MesaStore
let handlers: Readonly<Record<AgentToolName, TableToolHandler>>
let ui: { open: MesaId | null; selection: ItemId[]; editing: string | null; shown: ItemId[][] }
let answer: boolean
let confirms: RemovalRequest[]
let changes: string[]
let kept: Set<string>
/** Señal de la «sesión» de las llamadas; un test la cancela como si se cerrara. */
let session: AbortController
/** Confirmación a medida (por defecto, contesta `answer` al momento). */
let confirmWith: ((signal: AbortSignal) => Promise<boolean>) | null

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'table-tools-'))
  work = join(base, 'mesa')
  await mkdir(join(work, 'resultados'), { recursive: true })
  store = createMesaStore(join(base, 'datos'))
  ui = { open: null, selection: [], editing: null, shown: [] }
  answer = true
  confirms = []
  changes = []
  kept = new Set()
  session = new AbortController()
  confirmWith = null
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  handlers = createTableToolHandlers({
    store,
    workFolder: async () => work,
    cachedProject: async url => (url === NOTION_URL ? SNAPSHOT : null),
    unloadCard: async cardId => (kept.has(cardId) ? 'kept' : 'unloaded'),
    ui: {
      isOpen: mesaId => ui.open === mesaId,
      selection: mesaId => (ui.open === mesaId ? ui.selection : []),
      editingNote: mesaId => (ui.open === mesaId ? ui.editing : null),
      show: (_mesaId, ids) => ui.shown.push([...ids]),
    },
    confirm: async (request, signal) => {
      confirms.push(request)
      return confirmWith ? confirmWith(signal) : answer
    },
    changed: (_mesaId, notice) => changes.push(notice),
  })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(base, { recursive: true, force: true })
})

/** Llama a una herramienta como lo haría una sesión de Claude Code en la mesa `mesa`. */
function call(mesa: Mesa, name: AgentToolName, input: Record<string, unknown> = {}): Promise<any> {
  return handlers[name]({ mesaId: mesa.id, agentName: 'Claude Code', signal: session.signal }, input)
}

async function sampleMesa(): Promise<{ mesa: Mesa; cardId: string; noteId: string }> {
  const mesa = await store.create('Mesa de prueba')
  const card = await store.addCard(mesa.id, { url: 'https://example.com/', serviceId: 'web', position: { x: 0, y: 0 } })
  const note = await store.addNote(mesa.id, { x: 0, y: 400 }, 'Idea')
  return { mesa: await store.get(mesa.id), cardId: card.id, noteId: note.id }
}

describe('catálogo', () => {
  it('cada herramienta declarada tiene su ejecución y al revés', () => {
    expect(Object.keys(handlers).sort()).toEqual(AGENT_TOOLS.map(tool => tool.name).sort())
  })

  it('declaraciones con la forma de WebMCP; solo borrar es destructivo', () => {
    for (const tool of AGENT_TOOLS) {
      expect(tool.inputSchema.type).toBe('object')
      expect(tool.description.length).toBeGreaterThan(20)
      expect(tool.annotations.readOnlyHint && tool.annotations.destructiveHint).toBe(false)
    }
    expect(AGENT_TOOLS.filter(tool => tool.annotations.destructiveHint).map(tool => tool.name)).toEqual(['table_remove_items', 'table_disconnect'])
    expect(AGENT_TOOLS.filter(tool => tool.annotations.readOnlyHint).map(tool => tool.name)).toEqual([
      'table_get_mesa',
      'table_get_selection',
      'table_get_project',
    ])
  })
})

describe('lectura', () => {
  it('table_get_mesa: elementos, carpeta, coordenadas y fuentes de los resultados', async () => {
    const { mesa, cardId, noteId } = await sampleMesa()
    await writeFile(join(work, 'resultados', 'plan.md'), '# Plan')
    const result = await call(mesa, 'table_add_result', { file: 'plan.md', sources: [noteId] })
    const read = await call(mesa, 'table_get_mesa')
    expect(read).toMatchObject({ id: mesa.id, name: 'Mesa de prueba', workFolder: work })
    expect(read.coordinates).toContain('esquina superior izquierda')
    expect(read.cards).toEqual([expect.objectContaining({ id: cardId, service: 'Web', url: 'https://example.com/' })])
    expect(read.notes).toEqual([expect.objectContaining({ id: noteId, text: 'Idea' })])
    expect(read.results).toEqual([expect.objectContaining({ id: result.id, file: 'resultados/plan.md', kind: 'text', sources: [noteId] })])
    expect(read.edges).toHaveLength(1)
    await expect(call(mesa, 'table_get_mesa', { extra: 1 })).rejects.toThrow('Campo no admitido')
  })

  it('table_get_selection: solo con la mesa abierta y solo elementos de la mesa', async () => {
    const { mesa, noteId } = await sampleMesa()
    expect(await call(mesa, 'table_get_selection')).toMatchObject({ open: false, items: [] })
    ui.open = mesa.id
    ui.selection = [noteId, '99999999-9999-4999-8999-999999999999']
    expect(await call(mesa, 'table_get_selection')).toEqual({ open: true, items: [{ id: noteId, kind: 'note', label: 'Nota «Idea»' }] })
  })

  it('table_get_project: solo la lista cerrada de campos y los archivos de notion/', async () => {
    const mesa = await store.create('Con ficha')
    await store.addCard(mesa.id, { url: NOTION_URL, serviceId: 'notion', position: { x: 0, y: 0 } })
    await mkdir(join(work, 'notion'))
    await writeFile(join(work, 'notion', 'index.md'), 'índice')
    await writeFile(join(work, 'notion', 'otro.txt'), 'no')
    const project = await call(mesa, 'table_get_project')
    expect(project.projects).toEqual([expect.objectContaining({ title: 'Proyecto sintético', fields: { Estado: 'In progress' } })])
    expect(JSON.stringify(project)).not.toContain('SECRETO')
    expect(project.notionFiles).toEqual(['notion/index.md'])
  })
})

describe('escritura', () => {
  it('table_add_card: URL http(s), servicio reconocido, junto a un elemento sin taparse', async () => {
    const { mesa, cardId } = await sampleMesa()
    await expect(call(mesa, 'table_add_card', { url: 'file:///etc/passwd' })).rejects.toThrow('http')
    const first = await call(mesa, 'table_add_card', { url: 'https://www.figma.com/design/ABC123/Archivo', near: cardId })
    expect(first).toMatchObject({ service: 'Figma', position: { x: 360, y: 0 } })
    // El segundo junto a la misma tarjeta baja hasta un hueco libre.
    const second = await call(mesa, 'table_add_card', { url: 'https://example.com/otra', near: cardId })
    expect(second.position.x).toBe(360)
    expect(second.position.y).toBeGreaterThanOrEqual(220 + 24)
    const placed = await call(mesa, 'table_add_card', { url: 'https://example.com/fija', position: { x: 10, y: 20 } })
    expect(placed.position).toEqual({ x: 10, y: 20 })
    expect(changes).toEqual(['El agente añadió una tarjeta', 'El agente añadió una tarjeta', 'El agente añadió una tarjeta'])
  })

  it('table_add_note y table_update_note: límites de texto y nota en edición', async () => {
    const { mesa, noteId } = await sampleMesa()
    await expect(call(mesa, 'table_add_note', { text: 'x'.repeat(10_001) })).rejects.toThrow('10.000')
    const note = await call(mesa, 'table_add_note', { text: 'Resumen', near: noteId })
    expect((await store.get(mesa.id)).notes.find(existing => existing.id === note.id)?.text).toBe('Resumen')
    await call(mesa, 'table_update_note', { noteId: note.id, text: 'Resumen 2' })
    expect((await store.get(mesa.id)).notes.find(existing => existing.id === note.id)?.text).toBe('Resumen 2')
    ui.open = mesa.id
    ui.editing = note.id
    await expect(call(mesa, 'table_update_note', { noteId: note.id, text: 'pisado' })).rejects.toThrow('editando')
    expect((await store.get(mesa.id)).notes.find(existing => existing.id === note.id)?.text).toBe('Resumen 2')
  })

  it('table_move_items: valida todo antes de mover nada', async () => {
    const { mesa, cardId, noteId } = await sampleMesa()
    await expect(
      call(mesa, 'table_move_items', { items: [{ id: cardId, position: { x: 50, y: 50 } }, { id: noteId, size: { width: 1, height: 1 } }] }),
    ).rejects.toThrow()
    expect((await store.get(mesa.id)).cards[0]?.position).toEqual({ x: 0, y: 0 })
    const moved = await call(mesa, 'table_move_items', {
      items: [{ id: cardId, position: { x: 50, y: 60 } }, { id: noteId, size: { width: 300, height: 200 } }],
    })
    expect(moved.moved).toHaveLength(2)
    const after = await store.get(mesa.id)
    expect(after.cards[0]?.position).toEqual({ x: 50, y: 60 })
    expect(after.notes[0]?.size).toEqual({ width: 300, height: 200 })
  })

  it('table_connect: conecta; no repite', async () => {
    const { mesa, cardId, noteId } = await sampleMesa()
    const edge = await call(mesa, 'table_connect', { source: cardId, target: noteId })
    expect(edge).toMatchObject({ source: cardId, target: noteId })
    await expect(call(mesa, 'table_connect', { source: noteId, target: cardId })).rejects.toThrow()
  })

  it('table_add_result: archivo normal en resultados/, se importa una vez y se conecta con sus fuentes', async () => {
    const { mesa, cardId, noteId } = await sampleMesa()
    await expect(call(mesa, 'table_add_result', { file: 'falta.md' })).rejects.toThrow('No hay un archivo normal')
    await expect(call(mesa, 'table_add_result', { file: '../fuera.md' })).rejects.toThrow()
    await expect(call(mesa, 'table_add_result', { file: 'borrador.md.tmp' })).rejects.toThrow('temporal')
    await writeFile(join(base, 'secreto.md'), 'x')
    await symlink(join(base, 'secreto.md'), join(work, 'resultados', 'enlace.md'))
    await expect(call(mesa, 'table_add_result', { file: 'enlace.md' })).rejects.toThrow('No hay un archivo normal')

    await writeFile(join(work, 'resultados', 'resumen.md'), '# Resumen')
    const first = await call(mesa, 'table_add_result', { file: 'resumen.md', sources: [cardId, noteId] })
    expect(first).toMatchObject({ file: 'resultados/resumen.md', kind: 'text', imported: true })
    expect(first.edges).toHaveLength(2)
    // Ya importado (p. ej. por la vigilancia): solo conexiones nuevas, sin duplicar.
    const again = await call(mesa, 'table_add_result', { file: 'Resumen.md', sources: [cardId] })
    expect(again).toMatchObject({ id: first.id, imported: false })
    const after = await store.get(mesa.id)
    expect(after.results).toHaveLength(1)
    expect(after.edges).toHaveLength(2)
  })

  it('table_show_items: solo con la mesa abierta', async () => {
    const { mesa, noteId } = await sampleMesa()
    expect(await call(mesa, 'table_show_items', { ids: [noteId] })).toMatchObject({ shown: false })
    ui.open = mesa.id
    expect(await call(mesa, 'table_show_items', { ids: [noteId] })).toEqual({ shown: true, ids: [noteId] })
    expect(ui.shown).toEqual([[noteId]])
  })
})

describe('posiciones calculadas (revisión de T-011)', () => {
  it('`near` o la colocación por defecto fuera del lienzo se rechazan y la mesa sigue legible', async () => {
    const mesa = await store.create('Borde')
    const edge = await store.addNote(mesa.id, { x: 1_000_000, y: 0 }, 'En el borde')
    await expect(call(mesa, 'table_add_note', { text: 'x', near: edge.id })).rejects.toThrow('fuera del lienzo')
    await expect(call(mesa, 'table_add_card', { url: 'https://example.com/' })).rejects.toThrow('fuera del lienzo')
    expect((await store.get(mesa.id)).notes).toHaveLength(1)
    // Con una posición explícita, sí.
    expect(await call(mesa, 'table_add_note', { text: 'y', position: { x: 999_000, y: 0 } })).toMatchObject({ position: { x: 999_000, y: 0 } })
  })

  it('un resultado sin sitio a la derecha queda en el borde del lienzo, no fuera', async () => {
    const mesa = await store.create('Borde de resultados')
    await store.addNote(mesa.id, { x: 1_000_000, y: 0 }, 'En el borde')
    await writeFile(join(work, 'resultados', 'plan.md'), 'x')
    const result = await call(mesa, 'table_add_result', { file: 'plan.md' })
    expect((await store.get(mesa.id)).results.find(existing => existing.id === result.id)?.position.x).toBe(1_000_000)
  })
})

describe('borrar', () => {
  it('si la sesión termina con la confirmación pendiente, aceptar después no borra nada', async () => {
    const { mesa, noteId } = await sampleMesa()
    const waiting = Promise.withResolvers<void>()
    const accept = Promise.withResolvers<boolean>()
    let sawAbort = false
    confirmWith = signal => {
      signal.addEventListener('abort', () => (sawAbort = true))
      waiting.resolve()
      return accept.promise
    }
    const removal = call(mesa, 'table_remove_items', { ids: [noteId] })
    await waiting.promise
    session.abort()
    // La persona acepta tarde (el diálogo ya debería haberse retirado).
    accept.resolve(true)
    expect(await removal).toMatchObject({ rejected: true, removed: [], message: expect.stringContaining('se canceló') })
    expect(sawAbort).toBe(true)
    expect((await store.get(mesa.id)).notes).toHaveLength(1)
    expect(changes).toEqual([])
  })

  it('table_remove_items: pide confirmación con el agente y lo que se borra; rechazada, no cambia nada', async () => {
    const { mesa, cardId, noteId } = await sampleMesa()
    answer = false
    const rejected = await call(mesa, 'table_remove_items', { ids: [cardId, noteId] })
    expect(rejected).toMatchObject({ rejected: true, removed: [] })
    expect(confirms[0]).toMatchObject({ mesaId: mesa.id, agentName: 'Claude Code', title: 'Claude Code quiere borrar 2 elementos de la mesa' })
    expect(confirms[0]?.items).toEqual(['Web «example.com»', 'Nota «Idea»'])
    expect(await store.get(mesa.id)).toMatchObject({ cards: [expect.anything()], notes: [expect.anything()] })
    expect(changes).toEqual([])

    answer = true
    expect(await call(mesa, 'table_remove_items', { ids: [cardId, noteId] })).toMatchObject({ rejected: false, removed: [cardId, noteId] })
    expect(await store.get(mesa.id)).toMatchObject({ cards: [], notes: [] })
  })

  it('el archivo de un resultado se queda; una tarjeta con cambios sin guardar en su web, también', async () => {
    const { mesa, cardId } = await sampleMesa()
    await writeFile(join(work, 'resultados', 'plan.md'), 'x')
    const result = await call(mesa, 'table_add_result', { file: 'plan.md' })
    kept.add(cardId)
    const outcome = await call(mesa, 'table_remove_items', { ids: [result.id, cardId] })
    expect(outcome).toMatchObject({ removed: [result.id], kept: [cardId] })
    expect(existsSync(join(work, 'resultados', 'plan.md'))).toBe(true)
    expect((await store.get(mesa.id)).dismissedResults).toEqual(['plan.md'])
  })

  it('table_disconnect: confirmación con los extremos de cada conexión', async () => {
    const { mesa, cardId, noteId } = await sampleMesa()
    const edge = await call(mesa, 'table_connect', { source: cardId, target: noteId })
    answer = false
    expect(await call(mesa, 'table_disconnect', { edgeIds: [edge.id] })).toMatchObject({ rejected: true })
    expect(confirms[0]?.items).toEqual(['Web «example.com» ↔ Nota «Idea»'])
    expect((await store.get(mesa.id)).edges).toHaveLength(1)
    answer = true
    expect(await call(mesa, 'table_disconnect', { edgeIds: [edge.id] })).toMatchObject({ removed: [edge.id] })
    expect((await store.get(mesa.id)).edges).toHaveLength(0)
  })
})

describe('solo la mesa de la sesión', () => {
  it('rechaza IDs de otra mesa en todas las herramientas que reciben elementos', async () => {
    const { mesa } = await sampleMesa()
    const other = await sampleMesa()
    const cases: [AgentToolName, Record<string, unknown>][] = [
      ['table_add_note', { text: 'x', near: other.noteId }],
      ['table_update_note', { noteId: other.noteId, text: 'x' }],
      ['table_move_items', { items: [{ id: other.cardId, position: { x: 1, y: 1 } }] }],
      ['table_connect', { source: other.cardId, target: other.noteId }],
      ['table_show_items', { ids: [other.noteId] }],
      ['table_remove_items', { ids: [other.noteId] }],
    ]
    for (const [name, input] of cases) {
      await expect(call(mesa, name, input), name).rejects.toThrow('no está en la mesa de esta sesión')
    }
    expect(confirms).toEqual([])
    expect(await store.get(other.mesa.id)).toEqual(other.mesa)
  })
})
