import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { notionPageIdFromUrl, type NotionDatabase, type ProjectSnapshot, type ProjectState } from '../../shared/notion'
import { writeFileAtomic } from '../files'
import { log } from '../log'
import type { SettingsStore } from '../settings/settingsStore'
import { createNotionClient, NotionError } from './client'
import { extractProject, sanitizeSnapshot } from './project'

export interface ProjectService {
  /** Última ficha guardada de la página de esa URL para la base elegida, sin red. */
  cached(url: string): Promise<ProjectSnapshot | null>
  /** Lee la ficha en Notion y actualiza la caché; si falla, devuelve la caché con el motivo. */
  refresh(url: string): Promise<ProjectState>
  /** Bases compartidas con la integración, con el token guardado. */
  listDatabases(): Promise<NotionDatabase[]>
}

/** Caché en disco: la ficha y la base de la que se leyó. */
interface CacheFile {
  readonly databaseId: string
  readonly snapshot: ProjectSnapshot
}

/** `apiBase` solo existe en el smoke: devuelve la dirección del servidor local con fichas sintéticas. */
export function createProjectService(settings: SettingsStore, userData: string, apiBase?: () => string | undefined): ProjectService {
  const cacheDir = join(userData, 'notion-cache')
  /** Lecturas en curso por revisión de ajustes y página: un cambio de ajustes no reutiliza una lectura vieja. */
  const inflight = new Map<string, Promise<ProjectState>>()

  const cachePath = (pageId: string): string => join(cacheDir, `${pageId}.json`)

  /** Solo vale la caché leída de la base elegida ahora; se reconstruye con la lista cerrada. */
  async function readCache(pageId: string): Promise<ProjectSnapshot | null> {
    const database = settings.notionView().database
    if (!database || !settings.notionView().hasToken) {
      return null
    }
    try {
      const parsed = JSON.parse(await readFile(cachePath(pageId), 'utf8')) as Partial<CacheFile> | null
      return parsed?.databaseId === database.id ? sanitizeSnapshot(parsed.snapshot, pageId) : null
    } catch {
      return null
    }
  }

  async function load(pageId: string, revision: number): Promise<ProjectState> {
    const token = settings.notionToken()
    const database = settings.notionView().database
    if (!token || !database) {
      return { status: 'not-configured' }
    }
    const stale = (): boolean => settings.revision() !== revision
    try {
      const snapshot = extractProject(await createNotionClient(token, apiBase?.()).getPage(pageId), database.id, new Date().toISOString())
      // Si los ajustes cambiaron durante la lectura, el resultado no se guarda ni se usa.
      if (stale()) {
        return { status: 'not-configured' }
      }
      if (!snapshot) {
        await rm(cachePath(pageId), { force: true })
        return { status: 'not-project' }
      }
      const cache: CacheFile = { databaseId: database.id, snapshot }
      await writeFileAtomic(cachePath(pageId), JSON.stringify(cache)).catch((error: unknown) => {
        log('notion-cache-write-failed', { message: error instanceof Error ? error.message : String(error) })
      })
      log('notion-project-read', { status: 'ready' })
      return { status: 'ready', snapshot }
    } catch (error) {
      const code = error instanceof NotionError ? error.code : 'unexpected'
      log('notion-project-read', { status: 'error', code })
      if (stale()) {
        return { status: 'not-configured' }
      }
      const cached = await readCache(pageId)
      // Una página no compartida con la integración y sin copia previa se trata como web normal.
      if (code === 'not-found' && !cached) {
        return { status: 'not-project' }
      }
      const message = error instanceof NotionError ? error.message : 'No se pudo leer la ficha de Notion'
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
      // Leída con ajustes anteriores: se repite con los actuales.
      return settings.revision() === revision ? state : service.refresh(url)
    },

    async listDatabases() {
      const token = settings.notionToken()
      if (!token) {
        throw new Error('Guarda antes el token de Notion')
      }
      return createNotionClient(token, apiBase?.()).listDatabases()
    },
  }
  return service
}
