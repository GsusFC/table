import { mkdir, mkdtemp, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMesaStore } from '../store/mesaStore'
import type { MesaStore } from '../store/types'
import {
  createResultsWatcher,
  isImportableName,
  openEntry,
  placeNewResults,
  resultEntry,
  resultKindOf,
  resultsDirIn,
  type ResultsWatcher,
} from './results'

describe('nombres y tipos', () => {
  it('tipo por extensión', () => {
    expect(['a.png', 'b.JPG', 'c.jpeg', 'd.gif', 'e.webp', 'f.svg'].map(resultKindOf)).toEqual(Array(6).fill('image'))
    expect(['a.md', 'b.txt', 'c.json', 'd.csv', 'e.html'].map(resultKindOf)).toEqual(Array(5).fill('text'))
    expect(['a.pdf', 'sin-extension', 'c.zip'].map(resultKindOf)).toEqual(Array(3).fill('file'))
  })

  it('ignora ocultos, temporales y descargas a medias', () => {
    expect(['plan.md', 'Informe final.pdf'].every(isImportableName)).toBe(true)
    expect(['.DS_Store', '.plan.md.swp', 'a.tmp', 'b.crdownload', 'c.part', 'd.md~', '~$doc.docx', 'a:b'].some(isImportableName)).toBe(false)
  })
})

describe('colocación', () => {
  it('columna a la derecha de tarjetas y notas, debajo de los resultados que ya hay en ella', async () => {
    const base = { schemaVersion: 3 as const, id: 'm', name: 'M', createdAt: '', updatedAt: '', viewport: { x: 0, y: 0, zoom: 1 }, edges: [] }
    const item = (x: number, y: number, width: number, height: number) => ({ position: { x, y }, size: { width, height } })
    const mesa = {
      ...base,
      cards: [{ ...item(0, 100, 320, 220) }],
      notes: [{ ...item(400, 40, 240, 144) }],
      results: [{ ...item(720, 40, 280, 220) }],
    } as never
    expect(placeNewResults(mesa, 2)).toEqual([
      { x: 720, y: 284 },
      { x: 720, y: 528 },
    ])
    expect(placeNewResults({ ...base, cards: [], notes: [], results: [] } as never, 1)).toEqual([{ x: 0, y: 0 }])
  })
})

describe('vigilancia de resultados/', () => {
  let baseDir: string
  let store: MesaStore
  let watcher: ResultsWatcher
  const changed = vi.fn()
  /** Retraso al preparar la carpeta de cada mesa, para provocar carreras. */
  const folderDelay = new Map<string, number>()

  /** Carpeta de trabajo de cada mesa, creada como lo hace `WorkFolders`. */
  async function work(mesaId: string): Promise<string> {
    const folder = join(baseDir, `trabajo-${mesaId}`)
    await mkdir(folder, { recursive: true })
    return folder
  }

  beforeEach(async () => {
    baseDir = await realpath(await mkdtemp(join(tmpdir(), 'table-results-')))
    store = createMesaStore(baseDir)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    changed.mockReset()
    folderDelay.clear()
    watcher = createResultsWatcher({
      store,
      workFolder: async mesaId => {
        await delay(folderDelay.get(mesaId) ?? 0)
        return work(mesaId)
      },
      onChanged: changed,
      debounceMs: 20,
      stableMs: 80,
    })
  })

  afterEach(async () => {
    watcher.close()
    vi.restoreAllMocks()
    await rm(baseDir, { recursive: true, force: true })
  })

  async function until(probe: () => Promise<boolean>): Promise<void> {
    for (let i = 0; i < 100; i += 1) {
      if (await probe()) {
        return
      }
      await delay(30)
    }
    throw new Error('tiempo agotado')
  }

  const results = async (mesaId: string) => (await store.get(mesaId)).results

  it('crea la carpeta, importa archivos nuevos cuando dejan de cambiar y no duplica', async () => {
    const mesa = await store.create('Vigilada')
    await store.addNote(mesa.id, { x: 0, y: 0 })
    await watcher.watch(mesa.id)
    const dir = join(await work(mesa.id), 'resultados')
    await writeFile(join(dir, 'plan.md'), '# Plan\n')
    await writeFile(join(dir, 'boceto.png'), Buffer.from([0x89, 0x50]))
    await writeFile(join(dir, '.oculto'), 'x')
    await writeFile(join(dir, 'descarga.crdownload'), 'x')
    await mkdir(join(dir, 'subcarpeta'))
    await until(async () => (await results(mesa.id)).length === 2)
    const found = await results(mesa.id)
    expect(found.map(result => [result.file, result.kind])).toEqual([
      ['boceto.png', 'image'],
      ['plan.md', 'text'],
    ])
    expect(found[0]!.position.x).toBeGreaterThan(240)
    expect(changed).toHaveBeenCalledWith(mesa.id)
    await watcher.watch(mesa.id)
    expect(await results(mesa.id)).toHaveLength(2)
  })

  it('un archivo que sigue creciendo no se importa hasta que lleva el intervalo entero sin cambiar', async () => {
    const mesa = await store.create('Escritura lenta')
    await watcher.watch(mesa.id)
    const path = join(await work(mesa.id), 'resultados', 'largo.txt')
    for (let i = 0; i < 6; i += 1) {
      await writeFile(path, 'x'.repeat(i + 1))
      await delay(40)
      expect(await results(mesa.id)).toEqual([])
    }
    await until(async () => (await results(mesa.id)).length === 1)
  })

  it('al abrir la mesa importa lo que ya había; un archivo borrado deja la tarjeta como no encontrada', async () => {
    const mesa = await store.create('Previa')
    const dir = join(await work(mesa.id), 'resultados')
    await mkdir(dir)
    await writeFile(join(dir, 'datos.csv'), 'a,b\n')
    await watcher.watch(mesa.id)
    await until(async () => (await results(mesa.id)).length === 1)
    const [result] = await results(mesa.id)
    expect(await watcher.missing(mesa.id)).toEqual([])
    changed.mockReset()
    await unlink(join(dir, 'datos.csv'))
    await until(async () => changed.mock.calls.length > 0)
    expect(await results(mesa.id)).toHaveLength(1)
    expect(await watcher.missing(mesa.id)).toEqual([result!.id])
    expect(await watcher.resolve(mesa.id, result!.id)).toBeNull()
  })

  it('un cambio en un archivo conocido renueva su tarjeta y avisa', async () => {
    const mesa = await store.create('Cambios')
    await watcher.watch(mesa.id)
    const path = join(await work(mesa.id), 'resultados', 'plan.md')
    await writeFile(path, 'uno')
    await until(async () => (await results(mesa.id)).length === 1)
    const [before] = await results(mesa.id)
    changed.mockReset()
    await delay(20)
    await writeFile(path, 'dos, más largo')
    await until(async () => (await results(mesa.id))[0]!.updatedAt !== before!.updatedAt)
    expect(changed).toHaveBeenCalledWith(mesa.id)
    expect(await results(mesa.id)).toHaveLength(1)
  })

  it('una tarjeta quitada no vuelve mientras el archivo siga; si desaparece y vuelve, sí', async () => {
    const mesa = await store.create('Descartes')
    await watcher.watch(mesa.id)
    const path = join(await work(mesa.id), 'resultados', 'plan.md')
    await writeFile(path, 'uno')
    await until(async () => (await results(mesa.id)).length === 1)
    await store.removeResult(mesa.id, (await results(mesa.id))[0]!.id)
    await writeFile(path, 'uno modificado')
    await delay(300)
    expect(await results(mesa.id)).toEqual([])
    await unlink(path)
    await until(async () => (await store.get(mesa.id)).dismissedResults.length === 0)
    await writeFile(path, 'nuevo')
    await until(async () => (await results(mesa.id)).length === 1)
  })

  it('una preparación superada por otra mesa o por dejar de vigilar no instala nada', async () => {
    const slow = await store.create('Lenta')
    const fast = await store.create('Rápida')
    const ignored = await store.create('Ignorada')
    folderDelay.set(slow.id, 80)
    folderDelay.set(ignored.id, 80)
    await Promise.all([watcher.watch(slow.id), watcher.watch(fast.id)])
    const stopped = watcher.watch(ignored.id)
    await watcher.watch(null)
    await stopped
    await watcher.watch(fast.id)
    for (const mesa of [slow, fast, ignored]) {
      await writeFile(join(await work(mesa.id), 'resultados', 'plan.md'), 'x')
    }
    await until(async () => (await results(fast.id)).length === 1)
    await delay(300)
    expect(await results(slow.id)).toEqual([])
    expect(await results(ignored.id)).toEqual([])
  })

  it('rechaza enlaces simbólicos: archivos que son enlaces y «resultados» que lleva fuera', async () => {
    const mesa = await store.create('Enlaces')
    const folder = await work(mesa.id)
    const dir = await resultsDirIn(folder)
    await writeFile(join(folder, 'fuera.md'), 'secreto')
    await writeFile(join(dir, 'dentro.md'), 'ok')
    await symlink(join(folder, 'fuera.md'), join(dir, 'enlace.md'))
    expect(await resultEntry(dir, 'enlace.md')).toBeNull()
    expect(await resultEntry(dir, '../fuera.md')).toBeNull()
    expect(await resultEntry(dir, 'no-existe.md')).toBeNull()
    const inside = await resultEntry(dir, 'dentro.md')
    expect(inside?.path).toBe(join(dir, 'dentro.md'))
    const opened = await openEntry(inside!)
    expect((await opened!.handle.readFile('utf8'))).toBe('ok')
    await opened!.handle.close()
    // Cambiado por otro archivo tras comprobarlo: el descriptor no coincide.
    await unlink(join(dir, 'dentro.md'))
    await writeFile(join(dir, 'dentro.md'), 'otro')
    expect(await openEntry(inside!)).toBeNull()

    const other = await store.create('Carpeta enlazada')
    const otherFolder = await work(other.id)
    await mkdir(join(baseDir, 'externa'))
    await symlink(join(baseDir, 'externa'), join(otherFolder, 'resultados'))
    await expect(resultsDirIn(otherFolder)).rejects.toThrow('no es una carpeta de la mesa')
    await expect(watcher.watch(other.id)).rejects.toThrow('no es una carpeta de la mesa')
  })
})
