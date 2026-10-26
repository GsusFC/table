/**
 * Ficha del proyecto leída de Notion (T-003) a través del MCP oficial, con la
 * cuenta de Notion de cada persona. Solo viajan al renderer los campos de la
 * lista permitida; las credenciales nunca salen del proceso principal.
 */
import type { IsoDate } from './model'

/** Color de una opción de Notion (`default`, `gray`, `orange`…). */
export type NotionColor = string

export interface NotionOption {
  readonly name: string
  readonly color: NotionColor
}

export type ProjectFieldValue =
  | { readonly kind: 'status'; readonly option: NotionOption | null }
  | { readonly kind: 'tags'; readonly options: readonly NotionOption[] }
  /** Fechas ISO de Notion (`2026-10-26` o con hora); `end` solo en rangos. */
  | { readonly kind: 'date'; readonly start: string | null; readonly end: string | null }
  /** La propiedad no existe en la ficha. */
  | { readonly kind: 'missing' }
  /** Existe con otro tipo: no se interpreta para no inventar datos. */
  | { readonly kind: 'incompatible'; readonly actualType: string }

export interface ProjectField {
  /** Nombre de la propiedad en Notion. */
  readonly name: string
  /** Etiqueta en la interfaz. */
  readonly label: string
  readonly value: ProjectFieldValue
}

/** Copia de la ficha tal como se leyó; se guarda como caché fechada. */
export interface ProjectSnapshot {
  readonly pageId: string
  readonly title: string
  readonly fields: readonly ProjectField[]
  /** Momento de la lectura en Table. */
  readonly fetchedAt: IsoDate
  /** Última edición de la ficha en Notion. */
  readonly editedAt: IsoDate
}

/**
 * Estado de la ficha de una tarjeta de Notion:
 * - `not-configured`: Notion no está conectado en Ajustes.
 * - `not-project`: la página no es una ficha de una base de proyectos; tarjeta web normal.
 * - `ready`: leída ahora.
 * - `error`: no se pudo leer; se muestra la caché, si hay, con su fecha.
 */
export type ProjectState =
  | { readonly status: 'not-configured' }
  | { readonly status: 'not-project' }
  | { readonly status: 'ready'; readonly snapshot: ProjectSnapshot }
  | { readonly status: 'error'; readonly message: string; readonly cached: ProjectSnapshot | null }

/** Conexión con Notion visible en la interfaz: quién está conectado, nunca credenciales. */
export interface NotionSettingsView {
  readonly connected: boolean
  readonly workspaceName: string | null
  readonly userName: string | null
}

/** Proyecto encontrado al buscar por nombre en Notion («Vincular proyecto»). */
export interface ProjectSearchResult {
  readonly pageId: string
  readonly title: string
  /** URL de la ficha, sin parámetros; es la URL de la tarjeta que se crea. */
  readonly url: string
  /** Ruta en Notion (`Espacio / Base`), para distinguir títulos parecidos. */
  readonly path: string | null
  readonly editedAt: string | null
}

/**
 * Campos permitidos (lista cerrada): nombre en Notion, etiqueta y tipo esperado.
 * Una base es de proyectos si tiene `Title` y todos estos campos con su tipo.
 * `Remaining days` no está: es una fórmula y el MCP de Notion no devuelve su valor.
 */
export const PROJECT_FIELDS = [
  { name: 'Status', label: 'Estado', type: 'status' },
  { name: 'Services', label: 'Servicios', type: 'multi_select' },
  { name: 'Start Date', label: 'Inicio', type: 'date' },
  { name: 'Due Date', label: 'Entrega', type: 'date' },
] as const

/** Propiedad con el nombre del proyecto. */
export const PROJECT_TITLE_FIELD = 'Title'

/** ID de Notion (32 hex, con o sin guiones) en minúsculas y sin guiones. */
export function normalizeNotionId(id: string): string | null {
  const compact = id.replace(/-/g, '').toLowerCase()
  return /^[0-9a-f]{32}$/.test(compact) ? compact : null
}

/**
 * ID de la página de una URL de Notion: `?p=` (página abierta en vista previa)
 * o los 32 hex al final del último segmento (`Nombre-<id>`).
 */
export function notionPageIdFromUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const peek = parsed.searchParams.get('p')
  if (peek) {
    const id = normalizeNotionId(peek)
    if (id) {
      return id
    }
  }
  const last = parsed.pathname.split('/').filter(Boolean).at(-1) ?? ''
  const match = /([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(last)
  return match ? normalizeNotionId(match[1]!) : null
}
