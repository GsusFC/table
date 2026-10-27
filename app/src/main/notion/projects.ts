import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { notionPageIdFromUrl, type ProjectSearchResult, type ProjectSnapshot, type ProjectState } from '../../shared/notion'
import { writeFileAtomic } from '../files'
import { log } from '../log'
import type { SettingsStore } from '../settings/settingsStore'
import { NotionError, type NotionMcp } from './mcp'
import {
  buildSnapshot,
  isProjectSchema,
  parseDataSourceSchema,
  parseFetchedPage,
  parseSearchResults,
  sanitizeSnapshot,
  UnrecognizedResponseError,
  type DataSourceSchema,
} from './project'

export interface ProjectService {
  /** Última ficha guardada de la página de esa URL, sin red. */
  cached(url: string): Promise<ProjectSnapshot | null>
  /** Lee la ficha en Notion y actualiza la caché; si falla, devuelve la caché con el motivo. */
  refresh(url: string): Promise<ProjectState>
  /** Borra las fichas guardadas (al desconectar Notion). */
  clearCache(): Promise<void>
  /**
   * Busca fichas de proyecto por nombre. Solo devuelve páginas de bases con el
   * esquema de proyectos; ningún contenido de la ficha, solo título, URL y ruta.
   */
  search(query: string): Promise<ProjectSearchResult[]>
}

/** Caracteres mínimos para buscar proyectos. */
const MIN_SEARCH_LENGTH = 2

/** Caché en disco: la ficha y la base de la que se leyó. */
interface CacheFile {
  readonly dataSourceUrl: string
  readonly snapshot: ProjectSnapshot
}

export function createProjectService(settings: SettingsStore, mcp: NotionMcp, userData: string): ProjectService {
  const cacheDir = join(userData, 'notion-cache')
  /** Lecturas en curso por revisión de la conexión y página: reconectar no reutiliza una lectura vieja. */
  const inflight = new Map<string, Promise<ProjectState>>()
  /**
   * Lo aprendido con la conexión actual: esquemas de base leídos (deciden si una
   * página es una ficha) y bases de proyectos conocidas (acotan la búsqueda).
   * Se vacía al conectar otra cuenta.
   */
  let session: { revision: number; schemas: Map<string, Promise<DataSourceSchema>>; projectSources: Set<string> } = {
    revision: -1,
    schemas: new Map(),
    projectSources: new Set(),
  }
  function sessionFor(revision: number): typeof session {
    if (session.revision !== revision) {
      session = { revision, schemas: new Map(), projectSources: new Set() }
    }
    return session
  }

  const cachePath = (pageId: string): string => join(cacheDir, `${pageId}.json`)

  async function readCache(pageId: string): Promise<ProjectSnapshot | null> {
    if (!settings.notionView().connected) {
      return null
    }
    try {
      const parsed = JSON.parse(await readFile(cachePath(pageId), 'utf8')) as Partial<CacheFile> | null
      return typeof parsed?.dataSourceUrl === 'string' ? sanitizeSnapshot(parsed.snapshot, pageId) : null
    } catch {
      return null
    }
  }

  function schemaOf(dataSourceUrl: string, revision: number): Promise<DataSourceSchema> {
    const { schemas } = sessionFor(revision)
    let schema = schemas.get(dataSourceUrl)
    if (!schema) {
      schema = mcp.read('notion-fetch', { id: dataSourceUrl }).then(parseDataSourceSchema)
      schema.catch(() => schemas.delete(dataSourceUrl))
      schemas.set(dataSourceUrl, schema)
    }
    return schema
  }

  async function load(pageId: string, revision: number): Promise<ProjectState> {
    if (!settings.notionView().connected) {
      return { status: 'not-configured' }
    }
    const stale = (): boolean => settings.revision() !== revision
    try {
      const page = parseFetchedPage(await mcp.read('notion-fetch', { id: pageId }))
      const schema = page.dataSourceUrl ? await schemaOf(page.dataSourceUrl, revision) : null
      // Si la conexión cambió durante la lectura, el resultado no se guarda ni se usa.
      if (stale()) {
        return { status: 'not-configured' }
      }
      if (!page.dataSourceUrl || !schema || !isProjectSchema(schema)) {
        await rm(cachePath(pageId), { force: true })
        return { status: 'not-project' }
      }
      sessionFor(revision).projectSources.add(page.dataSourceUrl)
      const snapshot = buildSnapshot(pageId, page, schema, new Date().toISOString())
      const cache: CacheFile = { dataSourceUrl: page.dataSourceUrl, snapshot }
      await writeFileAtomic(cachePath(pageId), JSON.stringify(cache)).catch((error: unknown) => {
        log('notion-cache-write-failed', { message: error instanceof Error ? error.message : String(error) })
      })
      log('notion-project-read', { status: 'ready' })
      return { status: 'ready', snapshot }
    } catch (error) {
      const code = error instanceof NotionError ? error.code : error instanceof UnrecognizedResponseError ? 'unrecognized' : 'unexpected'
      log('notion-project-read', { status: 'error', code })
      if (stale()) {
        return { status: 'not-configured' }
      }
      const cached = await readCache(pageId)
      // Una página a la que la cuenta no tiene acceso (o un ID que Notion rechaza) y sin copia previa se trata como web normal.
      if ((code === 'not-found' || code === 'invalid') && !cached) {
        return { status: 'not-project' }
      }
      const message = error instanceof Error && (error instanceof NotionError || error instanceof UnrecognizedResponseError)
        ? error.message
        : 'No se pudo leer la ficha de Notion'
      return { status: 'error', message, cached }
    }
  }

  const service: ProjectService = {
    async cached(url) {
      const pageId = notionPageIdFromUrl(url)
      return pageId ? readCache(pageId) : null
    },

    async refresh(url) {
      const pageId = notionPageIdFromUrl(url)
      if (!pageId) {
        return { status: 'not-project' }
      }
      const revision = settings.revision()
      const key = `${revision}:${pageId}`
      let task = inflight.get(key)
      if (!task) {
        task = load(pageId, revision).finally(() => inflight.delete(key))
        inflight.set(key, task)
      }
      const state = await task
      // Leída con otra conexión: se repite con la actual.
      return settings.revision() === revision ? state : service.refresh(url)
    },

    async clearCache() {
      await rm(cacheDir, { recursive: true, force: true })
    },

    async search(query) {
      const text = query.trim()
      if (text.length < MIN_SEARCH_LENGTH) {
        return []
      }
      if (!settings.notionView().connected) {
        throw new NotionError('Conecta Notion en Ajustes para buscar proyectos', 'unauthorized')
      }
      const revision = settings.revision()
      const { projectSources } = sessionFor(revision)
      // Con una base de proyectos ya conocida se busca dentro de ella: resultados más precisos.
      const known = [...projectSources]
      const args: Record<string, unknown> = known.length > 0 ? { query: text, data_source_url: known[0] } : { query: text }
      const hits = parseSearchResults(await mcp.read('notion-search', args))
      const results: ProjectSearchResult[] = []
      for (const hit of hits) {
        if (!hit.dataSourceUrl) {
          continue
        }
        if (!projectSources.has(hit.dataSourceUrl)) {
          if (!isProjectSchema(await schemaOf(hit.dataSourceUrl, revision))) {
            continue
          }
          projectSources.add(hit.dataSourceUrl)
        }
        const { dataSourceUrl: _source, ...result } = hit
        results.push(result)
      }
      return results
    },
  }
  return service
}
