import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CARD_SIZE, DEFAULT_VIEWPORT, SCHEMA_VERSION } from '../../shared/model'
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
