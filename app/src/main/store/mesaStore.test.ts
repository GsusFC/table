import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CARD_SIZE, DEFAULT_NOTE_SIZE, DEFAULT_VIEWPORT, SCHEMA_VERSION } from '../../shared/model'
import { createMesaStore } from './mesaStore'
import type { MesaStore } from './types'

let baseDir: string
let store: MesaStore

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'table-store-'))
  store = createMesaStore(baseDir)
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await rm(baseDir, { recursive: true, force: true })
})

/** Fija el reloj para que `updatedAt` sea determinista; el resto de timers siguen reales. */
function setNow(iso: string): void {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(iso))
}

const card = { url: 'https://example.com/', serviceId: 'web', position: { x: 10, y: 20 } }

describe('mesas', () => {
  it('crea, obtiene y guarda en disco con la versión de esquema', async () => {
    const mesa = await store.create('Proyecto')
    expect(mesa).toMatchObject({ schemaVersion: SCHEMA_VERSION, name: 'Proyecto', viewport: DEFAULT_VIEWPORT, cards: [] })
    expect(await store.get(mesa.id)).toEqual(mesa)
    const raw = JSON.parse(await readFile(join(baseDir, 'mesas', `${mesa.id}.json`), 'utf8'))
    expect(raw.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('lista sin carpeta previa devuelve vacío', async () => {
    expect(await store.list()).toEqual({ mesas: [], unreadable: [] })
  })

  it('lista por recencia, la modificada primero', async () => {
    setNow('2026-10-26T10:00:00.000Z')
    const a = await store.create('A')
    setNow('2026-10-26T11:00:00.000Z')
    const b = await store.create('B')
    expect((await store.list()).mesas.map(m => m.id)).toEqual([b.id, a.id])

    setNow('2026-10-26T12:00:00.000Z')
    await store.addCard(a.id, card)
    const list = (await store.list()).mesas
    expect(list.map(m => m.id)).toEqual([a.id, b.id])
    expect(list[0]).toEqual({
      id: a.id,
      name: 'A',
      createdAt: '2026-10-26T10:00:00.000Z',
      updatedAt: '2026-10-26T12:00:00.000Z',
      cardCount: 1,
    })
  })

  it('renombra y actualiza updatedAt', async () => {
    setNow('2026-10-26T10:00:00.000Z')
    const mesa = await store.create('Viejo')
    setNow('2026-10-26T10:05:00.000Z')
    const renamed = await store.rename(mesa.id, 'Nuevo')
    expect(renamed.name).toBe('Nuevo')
    expect(renamed.updatedAt).toBe('2026-10-26T10:05:00.000Z')
    expect((await store.get(mesa.id)).name).toBe('Nuevo')
  })

  it('guarda la vista', async () => {
    const mesa = await store.create('Vista')
    await store.setViewport(mesa.id, { x: 5, y: -3, zoom: 2 })
    expect((await store.get(mesa.id)).viewport).toEqual({ x: 5, y: -3, zoom: 2 })
  })

  it('borra la mesa y sus capturas', async () => {
    const mesa = await store.create('Borrar')
    const added = await store.addCard(mesa.id, card)
    await store.saveCapture(mesa.id, added.id, Buffer.from('jpeg'))
    await store.remove(mesa.id)
    await expect(store.get(mesa.id)).rejects.toThrow('La mesa no existe')
    expect(existsSync(join(baseDir, 'captures', mesa.id))).toBe(false)
    expect(store.capturePath(mesa.id, added.id)).toBeNull()
    expect(await store.list()).toEqual({ mesas: [], unreadable: [] })
  })

  it('get, rename y remove de una mesa inexistente lanzan', async () => {
    const id = randomUUID()
    await expect(store.get(id)).rejects.toThrow('La mesa no existe')
    await expect(store.rename(id, 'X')).rejects.toThrow('La mesa no existe')
    await expect(store.remove(id)).rejects.toThrow('La mesa no existe')
  })

  it('rechaza identificadores que no son UUID', async () => {
    await expect(store.get('../../etc/passwd')).rejects.toThrow('Identificador no válido')
    expect(() => store.capturePath('../x', randomUUID())).toThrow('Identificador no válido')
  })
})

describe('archivos ilegibles', () => {
  it('otra versión de esquema: list la omite, get lanza y no se sobrescribe', async () => {
    const good = await store.create('Buena')
    const id = randomUUID()
    const path = join(baseDir, 'mesas', `${id}.json`)
    const content = JSON.stringify({ schemaVersion: 99, id, name: 'Futura', createdAt: 'x', updatedAt: 'x', viewport: {}, cards: [] })
    await writeFile(path, content)

    expect(await store.list()).toEqual({ mesas: [expect.objectContaining({ id: good.id })], unreadable: [id] })
    await expect(store.get(id)).rejects.toThrow(/versión de esquema/)
    await expect(store.rename(id, 'Pisada')).rejects.toThrow(/versión de esquema/)
    await expect(store.addCard(id, card)).rejects.toThrow(/versión de esquema/)
    await expect(store.remove(id)).rejects.toThrow(/versión de esquema/)
    expect(await readFile(path, 'utf8')).toBe(content)
  })

  it('JSON inválido: list la omite y get lanza', async () => {
    const id = randomUUID()
    await mkdir(join(baseDir, 'mesas'), { recursive: true })
    await writeFile(join(baseDir, 'mesas', `${id}.json`), '{roto')
    expect(await store.list()).toEqual({ mesas: [], unreadable: [id] })
    await expect(store.get(id)).rejects.toThrow(/JSON/)
  })

  /** Escribe una mesa válida con una tarjeta y devuelve el archivo modificado por `tamper`. */
  async function writeTampered(tamper: (cardJson: Record<string, unknown>, mesa: Record<string, unknown>) => void) {
    const mesa = await store.create('Original')
    const added = await store.addCard(mesa.id, card)
    const path = join(baseDir, 'mesas', `${mesa.id}.json`)
    const json = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    tamper((json.cards as [Record<string, unknown>])[0], json)
    const content = JSON.stringify(json)
    await writeFile(path, content)
    return { id: mesa.id, cardId: added.id, path, content }
  }

  async function expectUnreadable(file: { id: string; path: string; content: string }): Promise<void> {
    expect(await store.list()).toEqual({ mesas: [], unreadable: [file.id] })
    await expect(store.get(file.id)).rejects.toThrow('no es válido')
    await expect(store.rename(file.id, 'Pisada')).rejects.toThrow()
    await expect(store.remove(file.id)).rejects.toThrow()
    expect(await readFile(file.path, 'utf8')).toBe(file.content)
  }

  it('tarjeta con URL file: no es legible y no se toca', async () => {
    await expectUnreadable(await writeTampered(c => (c.url = 'file:///etc/passwd')))
  })

  it('tarjeta sin size no es legible y no se toca', async () => {
    await expectUnreadable(await writeTampered(c => delete c.size))
  })

  it('ids de tarjeta duplicados no son legibles', async () => {
    await expectUnreadable(
      await writeTampered((c, m) => {
        m.cards = [c, { ...c }]
      }),
    )
  })

  it('viewport inválido no es legible', async () => {
    await expectUnreadable(await writeTampered((_c, m) => (m.viewport = { x: 0, y: 0 })))
  })

  it('el orden de las claves no hace ilegible una mesa válida', async () => {
    const mesa = await store.create('Orden')
    const path = join(baseDir, 'mesas', `${mesa.id}.json`)
    const stored = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    stored['viewport'] = { zoom: 1, y: 0, x: 0 }
    await writeFile(path, JSON.stringify(stored))
    expect((await store.get(mesa.id)).viewport).toEqual({ x: 0, y: 0, zoom: 1 })
  })

  it('list identifica los ilegibles junto a mesas válidas', async () => {
    const good = await store.create('Buena')
    await mkdir(join(baseDir, 'mesas'), { recursive: true })
    const broken = randomUUID()
    const partial = randomUUID()
    await writeFile(join(baseDir, 'mesas', `${broken}.json`), '{roto')
    await writeFile(join(baseDir, 'mesas', `${partial}.json`), JSON.stringify({ schemaVersion: SCHEMA_VERSION }))
    const listing = await store.list()
    expect(listing.mesas.map(m => m.id)).toEqual([good.id])
    expect([...listing.unreadable].sort()).toEqual([broken, partial].sort())
  })
})

describe('flush y persistencia', () => {
  it('flush espera a escrituras lanzadas sin await', async () => {
    const mesa = await store.create('Flush')
    void store.rename(mesa.id, 'Renombrada')
    const failing = store.rename(randomUUID(), 'X')
    failing.catch(() => undefined)
    await store.flush()
    const json = JSON.parse(await readFile(join(baseDir, 'mesas', `${mesa.id}.json`), 'utf8')) as { name: string }
    expect(json.name).toBe('Renombrada')
  })

  it('otra instancia sobre la misma carpeta ve los datos', async () => {
    const mesa = await store.create('Persistente')
    const added = await store.addCard(mesa.id, card)
    await store.setViewport(mesa.id, { x: 1, y: 2, zoom: 1.5 })
    await store.flush()
    const other = createMesaStore(baseDir)
    const loaded = await other.get(mesa.id)
    expect(loaded.cards).toEqual([added])
    expect(loaded.viewport).toEqual({ x: 1, y: 2, zoom: 1.5 })
    expect((await other.list()).mesas.map(m => m.id)).toEqual([mesa.id])
  })
})

describe('tarjetas', () => {
  it('añade con valores por defecto', async () => {
    setNow('2026-10-26T10:00:00.000Z')
    const mesa = await store.create('Tarjetas')
    setNow('2026-10-26T10:01:00.000Z')
    const added = await store.addCard(mesa.id, card)
    expect(added).toMatchObject({
      url: card.url,
      serviceId: 'web',
      position: card.position,
      size: DEFAULT_CARD_SIZE,
      title: null,
      capturedAt: null,
      createdAt: '2026-10-26T10:01:00.000Z',
    })
    const stored = await store.get(mesa.id)
    expect(stored.cards).toEqual([added])
    expect(stored.updatedAt).toBe('2026-10-26T10:01:00.000Z')
  })

  it('actualiza posición, tamaño y título', async () => {
    const mesa = await store.create('Mover')
    const added = await store.addCard(mesa.id, card)
    setNow('2030-01-01T00:00:00.000Z')
    const moved = await store.updateCard(mesa.id, added.id, { position: { x: 1, y: 2 } })
    expect(moved.position).toEqual({ x: 1, y: 2 })
    expect(moved.size).toEqual(DEFAULT_CARD_SIZE)
    expect(moved.updatedAt).toBe('2030-01-01T00:00:00.000Z')
    await store.updateCard(mesa.id, added.id, { size: { width: 400, height: 300 } })
    const titled = await store.setCardTitle(mesa.id, added.id, 'Ejemplo')
    expect(titled).toMatchObject({ position: { x: 1, y: 2 }, size: { width: 400, height: 300 }, title: 'Ejemplo' })
    const stored = await store.get(mesa.id)
    expect(stored.cards[0]).toEqual(titled)
    expect(stored.updatedAt).toBe('2030-01-01T00:00:00.000Z')
  })

  it('borra la tarjeta y su captura', async () => {
    const mesa = await store.create('Quitar')
    const keep = await store.addCard(mesa.id, card)
    const drop = await store.addCard(mesa.id, card)
    await store.saveCapture(mesa.id, drop.id, Buffer.from('jpeg'))
    await store.removeCard(mesa.id, drop.id)
    expect((await store.get(mesa.id)).cards.map(c => c.id)).toEqual([keep.id])
    expect(store.capturePath(mesa.id, drop.id)).toBeNull()
    expect(existsSync(join(baseDir, 'captures', mesa.id, `${drop.id}.jpg`))).toBe(false)
  })

  it('tarjeta inexistente lanza', async () => {
    const mesa = await store.create('Sin tarjeta')
    const id = randomUUID()
    await expect(store.updateCard(mesa.id, id, { position: { x: 0, y: 0 } })).rejects.toThrow('La tarjeta no existe')
    await expect(store.removeCard(mesa.id, id)).rejects.toThrow('La tarjeta no existe')
    await expect(store.saveCapture(mesa.id, id, Buffer.from('jpeg'))).rejects.toThrow('La tarjeta no existe')
    expect(existsSync(join(baseDir, 'captures', mesa.id))).toBe(false)
  })

  it('dos updateCard concurrentes conservan ambos cambios', async () => {
    const mesa = await store.create('Concurrente')
    const a = await store.addCard(mesa.id, card)
    const b = await store.addCard(mesa.id, card)
    await Promise.all([
      store.updateCard(mesa.id, a.id, { position: { x: 100, y: 100 } }),
      store.updateCard(mesa.id, b.id, { size: { width: 500, height: 500 } }),
      store.setCardTitle(mesa.id, a.id, 'A'),
    ])
    const stored = await store.get(mesa.id)
    expect(stored.cards.find(c => c.id === a.id)).toMatchObject({ position: { x: 100, y: 100 }, title: 'A' })
    expect(stored.cards.find(c => c.id === b.id)?.size).toEqual({ width: 500, height: 500 })
  })

  it('una operación fallida no bloquea la cola', async () => {
    const mesa = await store.create('Cola')
    const results = await Promise.allSettled([
      store.updateCard(mesa.id, randomUUID(), { position: { x: 0, y: 0 } }),
      store.addCard(mesa.id, card),
    ])
    expect(results.map(r => r.status)).toEqual(['rejected', 'fulfilled'])
    expect((await store.get(mesa.id)).cards).toHaveLength(1)
  })
})

describe('capturas', () => {
  it('saveCapture escribe el JPEG, actualiza capturedAt y capturePath', async () => {
    const mesa = await store.create('Capturas')
    const added = await store.addCard(mesa.id, card)
    expect(store.capturePath(mesa.id, added.id)).toBeNull()

    setNow('2026-10-26T15:00:00.000Z')
    const captured = await store.saveCapture(mesa.id, added.id, Buffer.from('jpeg-bytes'))
    expect(captured.capturedAt).toBe('2026-10-26T15:00:00.000Z')
    expect((await store.get(mesa.id)).cards[0]?.capturedAt).toBe('2026-10-26T15:00:00.000Z')

    const path = store.capturePath(mesa.id, added.id)
    expect(path).toBe(join(baseDir, 'captures', mesa.id, `${added.id}.jpg`))
    expect(await readFile(path as string, 'utf8')).toBe('jpeg-bytes')
    // Sin temporales sueltos tras la escritura atómica.
    expect(await readdir(join(baseDir, 'captures', mesa.id))).toEqual([`${added.id}.jpg`])
    expect(await readdir(join(baseDir, 'mesas'))).toEqual([`${mesa.id}.json`])
  })
})

describe('notas', () => {
  it('añade una nota vacía con tamaño por defecto', async () => {
    const mesa = await store.create('Notas')
    setNow('2026-10-26T10:00:00.000Z')
    const note = await store.addNote(mesa.id, { x: 48, y: 96 })
    expect(note).toMatchObject({
      text: '',
      position: { x: 48, y: 96 },
      size: DEFAULT_NOTE_SIZE,
      createdAt: '2026-10-26T10:00:00.000Z',
      updatedAt: '2026-10-26T10:00:00.000Z',
    })
    const stored = await store.get(mesa.id)
    expect(stored.notes).toEqual([note])
    expect(stored.updatedAt).toBe('2026-10-26T10:00:00.000Z')
  })

  it('actualiza texto, posición y tamaño por separado', async () => {
    const mesa = await store.create('Editar nota')
    const note = await store.addNote(mesa.id, { x: 0, y: 0 })
    setNow('2030-01-01T00:00:00.000Z')
    await store.updateNote(mesa.id, note.id, { text: 'Idea\ncon dos líneas' })
    await store.updateNote(mesa.id, note.id, { position: { x: 24, y: 48 } })
    const resized = await store.updateNote(mesa.id, note.id, { size: { width: 300, height: 200 } })
    expect(resized).toMatchObject({
      text: 'Idea\ncon dos líneas',
      position: { x: 24, y: 48 },
      size: { width: 300, height: 200 },
      updatedAt: '2030-01-01T00:00:00.000Z',
    })
    expect((await store.get(mesa.id)).notes).toEqual([resized])
  })

  it('borra la nota sin tocar el resto', async () => {
    const mesa = await store.create('Borrar nota')
    const keep = await store.addNote(mesa.id, { x: 0, y: 0 })
    const drop = await store.addNote(mesa.id, { x: 300, y: 0 })
    const added = await store.addCard(mesa.id, card)
    await store.removeNote(mesa.id, drop.id)
    const stored = await store.get(mesa.id)
    expect(stored.notes.map(n => n.id)).toEqual([keep.id])
    expect(stored.cards.map(c => c.id)).toEqual([added.id])
  })

  it('nota inexistente lanza', async () => {
    const mesa = await store.create('Sin nota')
    const id = randomUUID()
    await expect(store.updateNote(mesa.id, id, { text: 'x' })).rejects.toThrow('La nota no existe')
    await expect(store.removeNote(mesa.id, id)).rejects.toThrow('La nota no existe')
  })
})

describe('conexiones', () => {
  async function mesaWithElements() {
    const mesa = await store.create('Conexiones')
    const a = await store.addCard(mesa.id, card)
    const b = await store.addCard(mesa.id, card)
    const n1 = await store.addNote(mesa.id, { x: 0, y: 300 })
    const n2 = await store.addNote(mesa.id, { x: 300, y: 300 })
    return { mesaId: mesa.id, a, b, n1, n2 }
  }

  it('conecta tarjeta↔tarjeta, tarjeta↔nota y nota↔nota', async () => {
    const { mesaId, a, b, n1, n2 } = await mesaWithElements()
    setNow('2026-10-26T12:00:00.000Z')
    const cardCard = await store.addEdge(mesaId, a.id, b.id)
    const cardNote = await store.addEdge(mesaId, n1.id, a.id)
    const noteNote = await store.addEdge(mesaId, n1.id, n2.id)
    expect(cardNote).toMatchObject({ source: n1.id, target: a.id, createdAt: '2026-10-26T12:00:00.000Z' })
    const stored = await store.get(mesaId)
    expect(stored.edges).toEqual([cardCard, cardNote, noteNote])
    expect(stored.updatedAt).toBe('2026-10-26T12:00:00.000Z')
  })

  it('rechaza conectar un elemento consigo mismo', async () => {
    const { mesaId, a, n1 } = await mesaWithElements()
    await expect(store.addEdge(mesaId, a.id, a.id)).rejects.toThrow('consigo mismo')
    await expect(store.addEdge(mesaId, n1.id, n1.id)).rejects.toThrow('consigo mismo')
    expect((await store.get(mesaId)).edges).toEqual([])
  })

  it('rechaza repetir una conexión en cualquier sentido', async () => {
    const { mesaId, a, n1 } = await mesaWithElements()
    await store.addEdge(mesaId, a.id, n1.id)
    await expect(store.addEdge(mesaId, a.id, n1.id)).rejects.toThrow('Ya están conectados')
    await expect(store.addEdge(mesaId, n1.id, a.id)).rejects.toThrow('Ya están conectados')
    expect((await store.get(mesaId)).edges).toHaveLength(1)
  })

  it('rechaza IDs que no están en la mesa', async () => {
    const { mesaId, a } = await mesaWithElements()
    const other = await store.create('Otra')
    const foreign = await store.addNote(other.id, { x: 0, y: 0 })
    await expect(store.addEdge(mesaId, a.id, randomUUID())).rejects.toThrow('El elemento no existe')
    await expect(store.addEdge(mesaId, foreign.id, a.id)).rejects.toThrow('El elemento no existe')
    await expect(store.addEdge(mesaId, a.id, mesaId)).rejects.toThrow('El elemento no existe')
    await expect(store.addEdge(mesaId, 'no-es-uuid', a.id)).rejects.toThrow('Identificador no válido')
    expect((await store.get(mesaId)).edges).toEqual([])
  })

  it('borrar una conexión no toca los elementos', async () => {
    const { mesaId, a, b, n1 } = await mesaWithElements()
    const edge = await store.addEdge(mesaId, a.id, n1.id)
    const before = await store.get(mesaId)
    await store.removeEdge(mesaId, edge.id)
    const after = await store.get(mesaId)
    expect(after.edges).toEqual([])
    expect(after.cards).toEqual(before.cards)
    expect(after.notes).toEqual(before.notes)
    expect(after.cards.map(c => c.id)).toEqual([a.id, b.id])
    await expect(store.removeEdge(mesaId, edge.id)).rejects.toThrow('La conexión no existe')
  })

  it('borrar una nota borra sus conexiones en la misma escritura', async () => {
    const { mesaId, a, b, n1, n2 } = await mesaWithElements()
    await store.addEdge(mesaId, a.id, n1.id)
    await store.addEdge(mesaId, n1.id, n2.id)
    const keep = await store.addEdge(mesaId, a.id, b.id)
    await store.removeNote(mesaId, n1.id)
    const raw = JSON.parse(await readFile(join(baseDir, 'mesas', `${mesaId}.json`), 'utf8')) as {
      notes: { id: string }[]
      edges: unknown[]
    }
    expect(raw.notes.map(n => n.id)).toEqual([n2.id])
    expect(raw.edges).toEqual([keep])
  })

  it('borrar una tarjeta borra sus conexiones', async () => {
    const { mesaId, a, b, n1 } = await mesaWithElements()
    await store.addEdge(mesaId, a.id, b.id)
    await store.addEdge(mesaId, n1.id, a.id)
    const keep = await store.addEdge(mesaId, b.id, n1.id)
    await store.removeCard(mesaId, a.id)
    const stored = await store.get(mesaId)
    expect(stored.cards.map(c => c.id)).toEqual([b.id])
    expect(stored.edges).toEqual([keep])
  })
})

describe('migración de la versión 1', () => {
  /** Mesa sintética guardada con el esquema 1: tarjetas, sin notas ni conexiones. */
  async function writeV1(): Promise<{ id: string; path: string; v1: Record<string, unknown> }> {
    const id = randomUUID()
    const v1 = {
      schemaVersion: 1,
      id,
      name: 'Mesa antigua',
      createdAt: '2026-10-20T09:00:00.000Z',
      updatedAt: '2026-10-21T09:00:00.000Z',
      viewport: { x: 12, y: -8, zoom: 0.75 },
      cards: [
        {
          id: randomUUID(),
          url: 'https://example.com/referencia',
          serviceId: 'web',
          title: 'Referencia',
          position: { x: 24, y: 48 },
          size: { width: 320, height: 220 },
          capturedAt: '2026-10-21T08:59:00.000Z',
          createdAt: '2026-10-20T09:01:00.000Z',
          updatedAt: '2026-10-21T08:59:00.000Z',
        },
      ],
    }
    await mkdir(join(baseDir, 'mesas'), { recursive: true })
    const path = join(baseDir, 'mesas', `${id}.json`)
    await writeFile(path, JSON.stringify(v1))
    return { id, path, v1 }
  }

  it('se abre migrada sin pérdida y sin reescribir el archivo al leer', async () => {
    const { id, path, v1 } = await writeV1()
    const content = await readFile(path, 'utf8')
    const mesa = await store.get(id)
    expect(mesa).toEqual({ ...v1, schemaVersion: SCHEMA_VERSION, notes: [], edges: [] })
    expect((await store.list()).mesas).toEqual([expect.objectContaining({ id, name: 'Mesa antigua', cardCount: 1 })])
    expect(await readFile(path, 'utf8')).toBe(content)
  })

  it('la siguiente escritura la guarda como versión 2 conservando todo', async () => {
    const { id, path, v1 } = await writeV1()
    setNow('2026-10-26T10:00:00.000Z')
    const note = await store.addNote(id, { x: 400, y: 48 })
    const raw = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    expect(raw).toEqual({
      ...v1,
      schemaVersion: 2,
      updatedAt: '2026-10-26T10:00:00.000Z',
      notes: [note],
      edges: [],
    })
    expect(await createMesaStore(baseDir).get(id)).toEqual(raw)
  })

  it('una versión 1 con notas o conexiones no es legible', async () => {
    const { id, path, v1 } = await writeV1()
    const content = JSON.stringify({ ...v1, notes: [] })
    await writeFile(path, content)
    expect(await store.list()).toEqual({ mesas: [], unreadable: [id] })
    await expect(store.addNote(id, { x: 0, y: 0 })).rejects.toThrow('no es válido')
    expect(await readFile(path, 'utf8')).toBe(content)
  })
})

describe('archivos ilegibles de la versión 2', () => {
  /** Mesa válida con dos notas conectadas; `tamper` modifica el JSON en disco. */
  async function writeTampered(tamper: (mesa: Record<string, unknown>, ids: { a: string; b: string }) => void) {
    const mesa = await store.create('Original')
    const a = await store.addNote(mesa.id, { x: 0, y: 0 })
    const b = await store.addNote(mesa.id, { x: 300, y: 0 })
    await store.addEdge(mesa.id, a.id, b.id)
    const path = join(baseDir, 'mesas', `${mesa.id}.json`)
    const json = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    tamper(json, { a: a.id, b: b.id })
    const content = JSON.stringify(json)
    await writeFile(path, content)
    return { id: mesa.id, path, content }
  }

  const edgeOf = (mesa: Record<string, unknown>): Record<string, unknown> =>
    (mesa['edges'] as [Record<string, unknown>])[0]

  it.each([
    ['conexión a un elemento que no existe', (m: Record<string, unknown>) => (edgeOf(m)['target'] = randomUUID())],
    ['conexión de un elemento consigo', (m: Record<string, unknown>, ids: { a: string }) => (edgeOf(m)['target'] = ids.a)],
    [
      'conexión duplicada en sentido contrario',
      (m: Record<string, unknown>, ids: { a: string; b: string }) =>
        (m['edges'] = [edgeOf(m), { ...edgeOf(m), id: randomUUID(), source: ids.b, target: ids.a }]),
    ],
    ['sin lista de conexiones', (m: Record<string, unknown>) => delete m['edges']],
    ['nota sin texto', (m: Record<string, unknown>) => delete (m['notes'] as [Record<string, unknown>])[0]['text']],
  ])('%s: no es legible y no se toca', async (_label, tamper) => {
    const file = await writeTampered(tamper)
    expect(await store.list()).toEqual({ mesas: [], unreadable: [file.id] })
    await expect(store.get(file.id)).rejects.toThrow('no es válido')
    await expect(store.addNote(file.id, { x: 0, y: 0 })).rejects.toThrow()
    expect(await readFile(file.path, 'utf8')).toBe(file.content)
  })
})
