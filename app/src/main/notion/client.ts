import { net } from 'electron'
import { normalizeNotionId, type NotionDatabase } from '../../shared/notion'
import { isProjectDatabase } from './project'

const NOTION_VERSION = '2022-06-28'
const TIMEOUT_MS = 10_000

/**
 * Error de Notion con un mensaje apto para la interfaz y los logs: nunca
 * incluye el token, la respuesta ni contenido de la ficha.
 */
export class NotionError extends Error {
  constructor(
    message: string,
    readonly code: 'unauthorized' | 'not-found' | 'rate-limited' | 'offline' | 'unexpected',
  ) {
    super(message)
    this.name = 'NotionError'
  }
}

export interface NotionClient {
  /**
   * Bases de proyectos compartidas con la integración. Compartir una base
   * comparte también las bases dentro de sus páginas; solo se devuelven las
   * que tienen el esquema de proyectos.
   */
  listDatabases(): Promise<NotionDatabase[]>
  getPage(pageId: string): Promise<unknown>
}

/** `apiBase` solo cambia en el smoke, que usa un servidor local con fichas sintéticas. */
export function createNotionClient(token: string, apiBase = 'https://api.notion.com'): NotionClient {
  async function request(path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<unknown> {
    let response: Response
    try {
      response = await net.fetch(`${apiBase}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': NOTION_VERSION,
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      throw new NotionError('Sin conexión con Notion', 'offline')
    }
    if (response.status === 401) {
      throw new NotionError('Notion no acepta el token: revisa Ajustes', 'unauthorized')
    }
    if (response.status === 403 || response.status === 404) {
      throw new NotionError('La página no existe o no está compartida con la integración de Table', 'not-found')
    }
    if (response.status === 429) {
      throw new NotionError('Notion pide esperar antes de volver a consultar', 'rate-limited')
    }
    if (!response.ok) {
      throw new NotionError(`Notion respondió con un error (${response.status})`, 'unexpected')
    }
    try {
      return await response.json()
    } catch {
      throw new NotionError('Respuesta de Notion no válida', 'unexpected')
    }
  }

  return {
    getPage(pageId) {
      return request(`/v1/pages/${encodeURIComponent(pageId)}`, { method: 'GET' })
    },

    async listDatabases() {
      const databases: NotionDatabase[] = []
      let cursor: string | undefined
      // Pocas bases compartidas con la integración; el límite evita un bucle sin fin.
      for (let page = 0; page < 10; page += 1) {
        const body = await request('/v1/search', {
          method: 'POST',
          body: { filter: { property: 'object', value: 'database' }, page_size: 100, start_cursor: cursor },
        })
        const record = body as { results?: unknown; has_more?: unknown; next_cursor?: unknown }
        for (const result of Array.isArray(record.results) ? record.results : []) {
          const database = readDatabase(result)
          if (database) {
            databases.push(database)
          }
        }
        if (record.has_more !== true || typeof record.next_cursor !== 'string') {
          break
        }
        cursor = record.next_cursor
      }
      return databases.sort((a, b) => a.title.localeCompare(b.title, 'es'))
    },
  }
}

function readDatabase(value: unknown): NotionDatabase | null {
  const record = value as { id?: unknown; title?: unknown; properties?: unknown } | null
  const id = typeof record?.id === 'string' ? normalizeNotionId(record.id) : null
  if (!id || !isProjectDatabase(record?.properties)) {
    return null
  }
  const title = Array.isArray(record?.title)
    ? record.title.map(part => (typeof part?.plain_text === 'string' ? part.plain_text : '')).join('').trim()
    : ''
  return { id, title: title || 'Base sin título' }
}
