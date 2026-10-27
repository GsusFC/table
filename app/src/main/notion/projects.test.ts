import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import type * as FileSystem from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSettingsStore, type SettingsStore } from '../settings/settingsStore'
import {
  FIXTURE_PROJECT_PAGE,
  FIXTURE_PROJECT_PROPERTIES,
  FIXTURE_PROJECT_SCHEMA,
  FIXTURE_PROJECTS_SOURCE,
  fixtureDataSourceResponse,
  fixturePageResponse,
  fixtureSearchResponse,
} from './fixtures'
import { NotionError, type NotionMcp } from './mcp'
import { createProjectService } from './projects'

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof FileSystem>()
  return { ...actual, rm: vi.fn(actual.rm), writeFile: vi.fn(actual.writeFile) }
})

let userData: string
let settings: SettingsStore
const pageUrl = `https://www.notion.so/${FIXTURE_PROJECT_PAGE}`
const invalidSchema = { ...FIXTURE_PROJECT_SCHEMA, Status: { name: 'Status', type: 'rich_text' } }

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'table-projects-'))
  settings = createSettingsStore(userData, {
    isAvailable: () => true,
    encrypt: plain => Buffer.from(plain),
    decrypt: encrypted => encrypted.toString(),
  })
  await settings.connectNotion({ client: {}, tokens: {} }, { workspaceName: 'Espacio sintético', userName: null })
})

afterEach(async () => {
  await rm(userData, { recursive: true, force: true })
})

describe('revalidación del esquema de proyectos', () => {
  it('deja de exportar una ficha y borra su copia si Status cambia de status a rich_text', async () => {
    let schema = FIXTURE_PROJECT_SCHEMA
    const mcp: NotionMcp = {
      async read(_tool, args) {
        return args.id === FIXTURE_PROJECTS_SOURCE
          ? fixtureDataSourceResponse(FIXTURE_PROJECTS_SOURCE, schema)
          : fixturePageResponse(pageUrl, FIXTURE_PROJECTS_SOURCE, FIXTURE_PROJECT_PROPERTIES)
      },
    }
    const service = createProjectService(settings, mcp, userData)
    expect(await service.refresh(pageUrl)).toMatchObject({ status: 'ready' })
    expect(await service.cached(pageUrl)).not.toBeNull()

    schema = invalidSchema
    expect(await service.refresh(pageUrl)).toEqual({ status: 'not-project' })
    expect(await service.cached(pageUrl)).toBeNull()
    expect(await createProjectService(settings, mcp, userData).cached(pageUrl)).toBeNull()
  })

  it('no recupera una ficha invalidada si falla borrar su caché y solo la habilita al guardar otra válida', async () => {
    let schema = FIXTURE_PROJECT_SCHEMA
    let offline = false
    const mcp: NotionMcp = {
      async read(_tool, args) {
        if (offline) throw new NotionError('Sin conexión con Notion', 'offline')
        return args.id === FIXTURE_PROJECTS_SOURCE
          ? fixtureDataSourceResponse(FIXTURE_PROJECTS_SOURCE, schema)
          : fixturePageResponse(pageUrl, FIXTURE_PROJECTS_SOURCE, FIXTURE_PROJECT_PROPERTIES)
      },
    }
    const service = createProjectService(settings, mcp, userData)
    expect(await service.refresh(pageUrl)).toMatchObject({ status: 'ready' })
    const original = await service.cached(pageUrl)
    const cachePath = join(userData, 'notion-cache', `${FIXTURE_PROJECT_PAGE}.json`)
    const persisted = await readFile(cachePath, 'utf8')
    schema = invalidSchema
    vi.mocked(rm).mockRejectedValueOnce(Object.assign(new Error('Ruta o contenido que no debe exponerse'), { code: 'EACCES' }))
    expect(await service.refresh(pageUrl)).toEqual({
      status: 'error',
      message: 'La ficha ya no es un proyecto; no se pudo borrar su copia local',
      cached: null,
    })
    expect(await readFile(cachePath, 'utf8')).toBe(persisted)
    expect(await service.cached(pageUrl)).toBeNull()
    offline = true
    expect(await service.refresh(pageUrl)).toEqual({ status: 'error', message: 'Sin conexión con Notion', cached: null })
    expect(await service.cached(pageUrl)).toBeNull()

    offline = false
    schema = FIXTURE_PROJECT_SCHEMA
    vi.mocked(writeFile).mockRejectedValueOnce(Object.assign(new Error('No se pudo guardar la copia'), { code: 'EACCES' }))
    expect(await service.refresh(pageUrl)).toMatchObject({ status: 'ready' })
    expect(await service.cached(pageUrl)).toBeNull()
    expect(await readFile(cachePath, 'utf8')).toBe(persisted)
    offline = true
    expect(await service.refresh(pageUrl)).toEqual({ status: 'error', message: 'Sin conexión con Notion', cached: null })
    offline = false
    expect(await service.refresh(pageUrl)).toMatchObject({ status: 'ready' })
    const repaired = await service.cached(pageUrl)
    expect(repaired).not.toBeNull()
    expect(repaired?.pageId).toBe(original?.pageId)
    offline = true
    expect(await service.refresh(pageUrl)).toEqual({ status: 'error', message: 'Sin conexión con Notion', cached: repaired })
  })

  it('conserva la ficha offline si la revalidación no puede consultar Notion', async () => {
    let offline = false
    const mcp: NotionMcp = {
      async read(_tool, args) {
        if (args.id === FIXTURE_PROJECTS_SOURCE) {
          if (offline) throw new NotionError('Sin conexión con Notion', 'offline')
          return fixtureDataSourceResponse(FIXTURE_PROJECTS_SOURCE, FIXTURE_PROJECT_SCHEMA)
        }
        return fixturePageResponse(pageUrl, FIXTURE_PROJECTS_SOURCE, FIXTURE_PROJECT_PROPERTIES)
      },
    }
    const service = createProjectService(settings, mcp, userData)
    const first = await service.refresh(pageUrl)
    expect(first.status).toBe('ready')
    if (first.status !== 'ready') throw new Error('Falta la ficha sintética')
    offline = true
    expect(await service.refresh(pageUrl)).toEqual({ status: 'error', message: 'Sin conexión con Notion', cached: first.snapshot })
    expect(await service.cached(pageUrl)).toEqual(first.snapshot)
  })

  it('revalida bases rechazadas y conocidas en cada búsqueda, una vez por base y búsqueda', async () => {
    let schema: Record<string, unknown> = invalidSchema
    let sourceReads = 0
    const mcp: NotionMcp = {
      async read(tool) {
        if (tool === 'notion-search') {
          return fixtureSearchResponse([
            { id: FIXTURE_PROJECT_PAGE, title: 'Proyecto uno', dataSourceUrl: FIXTURE_PROJECTS_SOURCE },
            { id: 'bbbbbbbbbbbb4ccc8dddeeeeeeeeeeee', title: 'Proyecto dos', dataSourceUrl: FIXTURE_PROJECTS_SOURCE },
          ])
        }
        sourceReads += 1
        return fixtureDataSourceResponse(FIXTURE_PROJECTS_SOURCE, schema)
      },
    }
    const service = createProjectService(settings, mcp, userData)
    expect(await service.search('Proyecto')).toEqual([])
    expect(sourceReads).toBe(1)
    schema = FIXTURE_PROJECT_SCHEMA
    expect(await service.search('Proyecto')).toHaveLength(2)
    expect(sourceReads).toBe(2)
    schema = invalidSchema
    expect(await service.search('Proyecto')).toEqual([])
    expect(sourceReads).toBe(3)
  })

  it('comparte solo el esquema en curso entre actualizaciones concurrentes', async () => {
    const schemaReady = Promise.withResolvers<void>()
    const schemaStarted = Promise.withResolvers<void>()
    const pagesStarted = Promise.withResolvers<void>()
    let sourceReads = 0
    let pageReads = 0
    const mcp: NotionMcp = {
      async read(_tool, args) {
        if (args.id === FIXTURE_PROJECTS_SOURCE) {
          sourceReads += 1
          schemaStarted.resolve()
          await schemaReady.promise
          return fixtureDataSourceResponse(FIXTURE_PROJECTS_SOURCE, FIXTURE_PROJECT_SCHEMA)
        }
        pageReads += 1
        if (pageReads === 2) pagesStarted.resolve()
        return fixturePageResponse(`https://www.notion.so/${String(args.id)}`, FIXTURE_PROJECTS_SOURCE, FIXTURE_PROJECT_PROPERTIES)
      },
    }
    const service = createProjectService(settings, mcp, userData)
    const first = service.refresh(pageUrl)
    const second = service.refresh('https://www.notion.so/bbbbbbbbbbbb4ccc8dddeeeeeeeeeeee')
    await Promise.all([schemaStarted.promise, pagesStarted.promise])
    schemaReady.resolve()
    expect((await Promise.all([first, second])).map(result => result.status)).toEqual(['ready', 'ready'])
    expect(sourceReads).toBe(1)
    await service.refresh(pageUrl)
    expect(sourceReads).toBe(2)
  })
})
