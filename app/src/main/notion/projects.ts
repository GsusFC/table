import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { notionPageIdFromUrl, type ProjectSnapshot, type ProjectState } from '../../shared/notion'
import { writeFileAtomic } from '../files'
import { log } from '../log'
import type { SettingsStore } from '../settings/settingsStore'
import { NotionError, type NotionMcp } from './mcp'
import {
  buildSnapshot,
  isProjectSchema,
  parseDataSourceSchema,
  parseFetchedPage,
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
}

/** Caché en disco: la ficha y la base de la que se leyó. */
interface CacheFile {
  readonly dataSourceUrl: string
  readonly snapshot: ProjectSnapshot
}

export function createProjectService(settings: SettingsStore, mcp: NotionMcp, userData: string): ProjectService {
  const cacheDir = join(userData, 'notion-cache')
  /** Lecturas en curso por revisión de la conexión y página: reconectar no reutiliza una lectura vieja. */
  const inflight = new Map<string, Promise<ProjectState>>()
  /** Esquemas de base ya leídos en esta conexión; deciden si una página es una ficha de proyecto. */
  let schemas: { revision: number; byUrl: Map<string, Promise<DataSourceSchema>> } = { revision: -1, byUrl: new Map() }

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
    if (schemas.revision !== revision) {
      schemas = { revision, byUrl: new Map() }
    }
    let schema = schemas.byUrl.get(dataSourceUrl)
    if (!schema) {
      const byUrl = schemas.byUrl
      schema = mcp.read('notion-fetch', { id: dataSourceUrl }).then(parseDataSourceSchema)
      schema.catch(() => byUrl.delete(dataSourceUrl))
      byUrl.set(dataSourceUrl, schema)
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
      // Una página a la que la cuenta no tiene acceso y sin copia previa se trata como web normal.
      if (code === 'not-found' && !cached) {
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
  }
  return service
}
