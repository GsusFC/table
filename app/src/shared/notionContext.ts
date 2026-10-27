/**
 * Contenido completo de Notion para los agentes (T-009): progreso de la
 * lectura, árbol de la ficha (cuerpo, bases y sus páginas) y la selección de
 * páginas que la persona elige para el agente. Solo IDs y títulos viajan al
 * renderer; el contenido filtrado se queda en archivos de la carpeta de la mesa.
 */
import type { MesaId } from './model'
import { normalizeNotionId } from './notion'

export type NotionContextPhase = 'listing' | 'reading' | 'writing' | 'done' | 'error'

/** Progreso de la lectura de Notion de una mesa (main → renderer). */
export interface NotionContextProgress {
  readonly mesaId: MesaId
  readonly phase: NotionContextPhase
  /** Páginas ya resueltas (leídas o tomadas de la caché) y total de la fase. */
  readonly done: number
  readonly total: number
  readonly warnings: readonly string[]
  /** Motivo, solo con `phase: 'error'`. */
  readonly message: string | null
  /** Páginas en `notion/` y fichas de proyecto de la mesa al terminar (`phase: 'done'`). */
  readonly pages: number
  readonly projects: number
  readonly at: string
}

/**
 * Selección de una base: todas salvo `pages` (por defecto; las páginas nuevas
 * entran) o solo `pages` (las nuevas quedan fuera).
 */
export interface NotionBaseSelection {
  readonly mode: 'all-except' | 'only'
  readonly pages: readonly string[]
}

/** Selección de páginas de una ficha de proyecto. Por defecto, todo. */
export interface NotionPageSelection {
  /** Cuerpo de la ficha. */
  readonly body: boolean
  /** Por `collection://…` de la base; una base sin entrada entra entera. */
  readonly bases: Readonly<Record<string, NotionBaseSelection>>
}

export const DEFAULT_NOTION_SELECTION: NotionPageSelection = { body: true, bases: {} }

export function isPageSelected(selection: NotionPageSelection, dataSourceUrl: string, pageId: string): boolean {
  const base = selection.bases[dataSourceUrl]
  if (!base) {
    return true
  }
  return base.mode === 'all-except' ? !base.pages.includes(pageId) : base.pages.includes(pageId)
}

/**
 * Marca o desmarca una página: cambia solo esa página y conserva el modo de la
 * base y el estado de todas las demás (también las que no están en el árbol
 * mostrado, p. ej. filas que Table no llegó a listar).
 */
export function togglePage(previous: NotionBaseSelection | undefined, pageId: string, checked: boolean): NotionBaseSelection {
  const base = previous ?? { mode: 'all-except', pages: [] }
  const pages = base.pages.filter(id => id !== pageId)
  // En «todas salvo» la lista son las desmarcadas; en «solo», las marcadas.
  const listed = base.mode === 'all-except' ? !checked : checked
  return { mode: base.mode, pages: listed ? [...pages, pageId] : pages }
}

/**
 * Marca o desmarca la base entera: es la única acción que cambia el modo.
 * Marcada → «todas salvo» (las nuevas entran); desmarcada → «solo» (las nuevas
 * no). Las páginas que no están en el árbol mostrado conservan su estado
 * cuando el modo anterior lo permite.
 */
export function toggleBase(previous: NotionBaseSelection | undefined, visiblePageIds: readonly string[], checked: boolean): NotionBaseSelection {
  const base = previous ?? { mode: 'all-except', pages: [] }
  const visible = new Set(visiblePageIds)
  const hidden = base.pages.filter(id => !visible.has(id))
  if (checked) {
    return { mode: 'all-except', pages: base.mode === 'all-except' ? hidden : [] }
  }
  return { mode: 'only', pages: base.mode === 'only' ? hidden : [] }
}

export interface NotionTreePage {
  readonly pageId: string
  readonly title: string
  readonly editedAt: string | null
}

export interface NotionTreeBase {
  readonly dataSourceUrl: string
  readonly title: string
  readonly pages: readonly NotionTreePage[]
  /** La base tiene más filas de las que Table lee. */
  readonly truncated: boolean
}

export interface NotionTreeProject {
  readonly pageId: string
  readonly title: string
  readonly url: string
  readonly bases: readonly NotionTreeBase[]
  readonly selection: NotionPageSelection
}

/** Árbol de las fichas de la mesa, para elegir páginas («Elegir páginas de Notion…»). */
export interface NotionTree {
  readonly projects: readonly NotionTreeProject[]
  readonly warnings: readonly string[]
}

/** Límites de una selección recibida (IPC o disco). */
const MAX_PROJECTS = 50
const MAX_BASES = 100
const MAX_PAGES = 5000

const DATA_SOURCE_URL = /^collection:\/\/[0-9a-f-]{32,36}$/i

export function isDataSourceUrl(value: string): boolean {
  return DATA_SOURCE_URL.test(value)
}

function parseBaseSelection(value: unknown): NotionBaseSelection | null {
  const record = asRecord(value)
  if (!record || (record['mode'] !== 'all-except' && record['mode'] !== 'only') || !Array.isArray(record['pages'])) {
    return null
  }
  if (record['pages'].length > MAX_PAGES) {
    return null
  }
  const pages = new Set<string>()
  for (const page of record['pages']) {
    const id = typeof page === 'string' ? normalizeNotionId(page) : null
    if (!id) {
      return null
    }
    pages.add(id)
  }
  return { mode: record['mode'], pages: [...pages] }
}

/** Selección de una ficha validada; lanza si no tiene la forma esperada. */
export function parseNotionSelection(value: unknown): NotionPageSelection {
  const record = asRecord(value)
  const bases = asRecord(record?.['bases'])
  if (!record || typeof record['body'] !== 'boolean' || !bases || Object.keys(bases).length > MAX_BASES) {
    throw new Error('Selección de páginas no válida')
  }
  const parsed: Record<string, NotionBaseSelection> = {}
  for (const [url, base] of Object.entries(bases)) {
    const selection = parseBaseSelection(base)
    if (!isDataSourceUrl(url) || !selection) {
      throw new Error('Selección de páginas no válida')
    }
    parsed[url.toLowerCase()] = selection
  }
  return { body: record['body'], bases: parsed }
}

/** Selecciones de una mesa por ID de la ficha; lanza si alguna no es válida. */
export function parseNotionSelections(value: unknown): Record<string, NotionPageSelection> {
  const record = asRecord(value)
  if (!record || Object.keys(record).length > MAX_PROJECTS) {
    throw new Error('Selección de páginas no válida')
  }
  const parsed: Record<string, NotionPageSelection> = {}
  for (const [pageId, selection] of Object.entries(record)) {
    const id = normalizeNotionId(pageId)
    if (!id) {
      throw new Error('Selección de páginas no válida')
    }
    parsed[id] = parseNotionSelection(selection)
  }
  return parsed
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}
