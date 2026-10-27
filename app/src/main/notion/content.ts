import { notionPageIdFromUrl } from '../../shared/notion'
import { cleanBlock, oneLine } from '../agent/context'
import { ALLOWED_PROPERTY_TYPES, hasMoney, isExcludedPropertyName, OMITTED_MARK, type TextLine } from './filters'
import { envelope, taggedJson, UnrecognizedResponseError, type DataSourceSchema } from './project'

/**
 * Lectura del contenido de páginas y bases de Notion (T-009) con el formato del
 * MCP oficial (comprobado el 2026-10-27):
 * - `notion-fetch` de una página: `text` con `<properties>{…}</properties>` y
 *   `<content>…</content>` (Markdown de Notion con etiquetas) y
 *   `page_last_edited_at`. Las bases del cuerpo aparecen como
 *   `<database url="…" data-source-url="collection://…">Título</database>`;
 *   las vistas enlazadas, sin `data-source-url`.
 * - `notion-fetch` de una base o vista enlazada: sus bases de origen
 *   (`<data-source url="{{collection://…}}">`) y sus vistas (`view://…`).
 * - `notion-query-data-sources` en modo `view`: las filas que muestra una vista
 *   (con sus filtros), `{ results: [{ <propiedad>: valor, url }], has_more, next_cursor }`.
 *   Table no usa los modos `rows` ni SQL: en planes sin Notion AI tienen una
 *   cuota que se agota; el modo `view` no.
 */

export interface PageContent {
  /** Título del sobre de la respuesta (no de las propiedades). */
  readonly title: string | null
  readonly editedAt: string | null
  readonly properties: Record<string, unknown>
  /** Cuerpo de la página tal como llega (Markdown de Notion con etiquetas). */
  readonly content: string
}

export function parsePageContent(raw: string): PageContent {
  const response = envelope(raw)
  const text = response['text'] as string
  const start = text.indexOf('<content>')
  const end = text.lastIndexOf('</content>')
  return {
    title: typeof response['title'] === 'string' ? response['title'] : null,
    editedAt: typeof response['page_last_edited_at'] === 'string' ? response['page_last_edited_at'] : null,
    properties: taggedJson(text, 'properties') ?? {},
    content: start >= 0 && end > start ? text.slice(start + '<content>'.length, end).replace(/^\n+|\n+$/g, '') : '',
  }
}

export interface DataSourceInfo {
  readonly name: string | null
  readonly schema: DataSourceSchema
}

/** Nombre y esquema de una base (`notion-fetch` de su `collection://`). */
export function parseDataSource(raw: string): DataSourceInfo {
  const response = envelope(raw)
  const state = taggedJson(response['text'] as string, 'data-source-state')
  const schema = asRecord(state?.['schema'])
  if (!schema) {
    throw new UnrecognizedResponseError()
  }
  const name = typeof state?.['name'] === 'string' ? state['name'] : typeof response['title'] === 'string' ? response['title'] : null
  return { name, schema }
}

/** Bases de origen de una base o vista enlazada (`notion-fetch` de su URL). */
export function parseLinkedDataSources(raw: string): string[] {
  const text = envelope(raw)['text'] as string
  const found = new Set<string>()
  for (const match of text.matchAll(/<data-source\s+url="(?:\{\{)?(collection:\/\/[0-9a-f-]+)/gi)) {
    found.add(match[1]!.toLowerCase())
  }
  return [...found]
}

const VIEW_URL = /view:\/\/([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})/i

/** `view://` con el UUID en su forma con guiones y en minúsculas. */
function viewUrl(id: string): string | null {
  const hex = id.replace(/-/g, '').toLowerCase()
  return /^[0-9a-f]{32}$/.test(hex) ? `view://${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` : null
}

export interface DatabaseView {
  readonly viewUrl: string
  /** Base de la vista (`dataSourceUrl` de su JSON), si la respuesta lo dice. */
  readonly dataSourceUrl: string | null
  readonly name: string | null
  /**
   * La vista filtra filas (`simpleFilters` con valores o `advancedFilter`). Si
   * su JSON no se reconoce, se supone que sí.
   */
  readonly filtered: boolean
}

function viewDetails(block: string): Pick<DatabaseView, 'dataSourceUrl' | 'name' | 'filtered'> {
  const source = /collection:\/\/[0-9a-f-]{32,36}/i.exec(block)
  const dataSourceUrl = source ? source[0].toLowerCase() : null
  try {
    const json = asRecord(JSON.parse(block.trim()))
    if (!json) {
      return { dataSourceUrl, name: null, filtered: true }
    }
    const simple = json['simpleFilters']
    const advanced = asRecord(json['advancedFilter'])
    // Un filtro simple sin valores (la ficha muestra el botón, pero no filtra) no cuenta.
    const simpleFilters = Array.isArray(simple)
      ? simple.some(item => {
          const filter = asRecord(item)
          const values = filter?.['values'] ?? filter?.['value']
          return !filter || values === undefined || (Array.isArray(values) ? values.length > 0 : values !== null && values !== '')
        })
      : false
    const advancedFilter =
      json['advancedFilter'] !== undefined && json['advancedFilter'] !== null && (!advanced || Object.keys(advanced).length > 0)
    const filtered = simpleFilters || advancedFilter
    return { dataSourceUrl, name: typeof json['name'] === 'string' ? oneLine(json['name']) : null, filtered }
  } catch {
    return { dataSourceUrl, name: null, filtered: true }
  }
}

/**
 * Vistas de una base o vista enlazada (`notion-fetch` de su URL), en orden:
 * bloques `<view url="{{view://…}}">{json}</view>` con su base, su nombre y si
 * filtra. Sin bloques, se toman las `view://` del texto.
 */
export function parseDatabaseViews(raw: string): DatabaseView[] {
  const text = envelope(raw)['text'] as string
  const views: DatabaseView[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(/<view\b([^>]*)>([\s\S]*?)<\/view>/gi)) {
    const url = viewUrl(VIEW_URL.exec(match[1]!)?.[1] ?? '')
    if (url && !seen.has(url)) {
      seen.add(url)
      views.push({ viewUrl: url, ...viewDetails(match[2]!) })
    }
  }
  if (views.length === 0) {
    for (const match of text.matchAll(new RegExp(VIEW_URL.source, 'gi'))) {
      const url = viewUrl(match[1]!)
      if (url && !seen.has(url)) {
        seen.add(url)
        views.push({ viewUrl: url, dataSourceUrl: null, name: null, filtered: true })
      }
    }
  }
  return views
}

export interface QueryPage {
  readonly rows: readonly Record<string, unknown>[]
  readonly hasMore: boolean
  /** Cursor de la página siguiente, si Notion lo da. */
  readonly nextCursor: string | null
}

/** Una página de resultados de `notion-query-data-sources` (`{ results, has_more, next_cursor }`). */
export function parseQueryPage(raw: string): QueryPage {
  let parsed: Record<string, unknown> | null
  try {
    parsed = asRecord(JSON.parse(raw))
  } catch {
    throw new UnrecognizedResponseError()
  }
  if (!parsed || !Array.isArray(parsed['results'])) {
    throw new UnrecognizedResponseError()
  }
  const cursor = parsed['next_cursor'] ?? parsed['nextCursor']
  return {
    rows: parsed['results'].map(asRecord).filter((row): row is Record<string, unknown> => row !== null),
    hasMore: parsed['has_more'] === true,
    nextCursor: typeof cursor === 'string' && cursor.length > 0 ? cursor : null,
  }
}

export interface RowEntry {
  readonly pageId: string
  readonly title: string
  /** Valor de una propiedad «última edición» de la base, si tiene; si no, null. */
  readonly editedAt: string | null
}

function propertyNamesOfType(schema: DataSourceSchema, type: string): string[] {
  return Object.entries(schema)
    .filter(([, definition]) => asRecord(definition)?.['type'] === type)
    .map(([name]) => name)
}

/** Página de una fila de `notion-query-data-sources`; null si no tiene URL de página. */
export function rowEntry(row: Record<string, unknown>, schema: DataSourceSchema): RowEntry | null {
  const pageId = typeof row['url'] === 'string' ? notionPageIdFromUrl(row['url']) : null
  if (!pageId) {
    return null
  }
  const title = propertyNamesOfType(schema, 'title')
    .map(name => row[name])
    .find((value): value is string => typeof value === 'string')
  const editedAt = propertyNamesOfType(schema, 'last_edited_time')
    .map(name => row[name])
    .find((value): value is string => typeof value === 'string' && value.length > 0)
  return { pageId, title: oneLine(title ?? ''), editedAt: editedAt ?? null }
}

export interface DatabaseRef {
  /** URL de la base o de la vista enlazada. */
  readonly url: string | null
  /** `collection://…` en minúsculas; null en una vista enlazada (se resuelve con su URL). */
  readonly dataSourceUrl: string | null
  /** Vista que muestra la ficha, si la etiqueta la lleva (atributo `view://` o `?v=` en su URL). */
  readonly viewUrl: string | null
  readonly title: string
}

const DATABASE_TAG = /<database\b([^>]*?)\/>|<database\b([^>]*)>([\s\S]*?)<\/database>/g

function attribute(attributes: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attributes)
  return match ? match[1]!.replace(/^\{\{/, '').replace(/\}\}$/, '') : null
}

/** Vista de una etiqueta de base: un atributo con `view://` o el parámetro `?v=` de su URL. */
function refView(attributes: string, url: string | null): string | null {
  const inTag = VIEW_URL.exec(attributes)
  if (inTag) {
    return viewUrl(inTag[1]!)
  }
  try {
    const v = url ? new URL(url).searchParams.get('v') : null
    return v ? viewUrl(v) : null
  } catch {
    return null
  }
}

function databaseRef(match: RegExpMatchArray): DatabaseRef {
  const attributes = match[1] ?? match[2] ?? ''
  const source = /collection:\/\/[0-9a-f-]+/i.exec(attribute(attributes, 'data-source-url') ?? '')
  const url = attribute(attributes, 'url')
  return {
    url,
    dataSourceUrl: source ? source[0].toLowerCase() : null,
    viewUrl: refView(attributes, url),
    title: oneLine((match[3] ?? '').replace(/<[^>]*>/g, '')),
  }
}

/** Bases incrustadas y vistas enlazadas del cuerpo de una página, en orden. */
export function findDatabaseRefs(content: string): DatabaseRef[] {
  return Array.from(content.matchAll(DATABASE_TAG), databaseRef)
}

/** Atributos de bloque al final de la línea: `{color="gray_bg"}`, `{toggle="true"}`. */
const BLOCK_ATTRIBUTES = /\s*\{(?:[\w-]+="[^"]*"\s*)+\}\s*$/
const ANY_TAG = /<\/?[a-zA-Z][\w-]*(?:\s[^<>]*)?\/?>/g
const ENTITIES: Readonly<Record<string, string>> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' }
/** Etiquetas de estructura de una tabla; una línea con ellas no lleva texto propio. */
const TABLE_TOKEN = /<table\b[^>]*>|<\/table>|<tr\b[^>]*>|<\/tr>|<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>|<\/?colgroup\b[^>]*>|<col\b[^>]*>/g

/**
 * Texto legible de una línea: sin etiquetas, sin URLs de archivos firmadas ni
 * contenido incrustado; las menciones de personas no llevan su nombre.
 */
function inlineText(text: string): string {
  return text
    .replace(BLOCK_ATTRIBUTES, '')
    .replace(/<mention-user\b[^>]*\/>|<mention-user\b[^>]*>[\s\S]*?<\/mention-user>/g, '(persona)')
    .replace(/<mention-date\b([^>]*?)\/?>(?:<\/mention-date>)?/g, (_match, attributes: string) =>
      [attribute(attributes, 'start'), attribute(attributes, 'end')].filter(Boolean).join(' → '),
    )
    .replace(/<page\b[^>]*>([\s\S]*?)<\/page>/g, (_match, title: string) => `[Página «${title}», no incluida]`)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_match, caption: string) => (caption ? `[Imagen: ${caption}]` : '[Imagen]'))
    .replace(/<(file|pdf|audio|video|image)\b[^>]*>([\s\S]*?)<\/\1>/g, (_match, _tag: string, caption: string) =>
      caption ? `[Archivo: ${caption}]` : '[Archivo]',
    )
    .replace(/<(?:file|pdf|audio|video|image)\b[^>]*\/>/g, '[Archivo]')
    .replace(/<embed\b[^>]*>[\s\S]*?<\/embed>|<embed\b[^>]*\/?>/g, '')
    .replace(/<br\s*\/?>/g, ' ')
    .replace(ANY_TAG, '')
    .replace(/&(?:lt|gt|amp|quot|#39|nbsp);/g, entity => ENTITIES[entity] ?? entity)
    .trimEnd()
}

/** Contenedores de Notion cuyo contenido se omite entero si una de sus líneas es económica. */
const CONTAINER_OPEN = /^<(callout|details|column|blockquote)\b[^>]*>/
const CONTAINER_CLOSE = /^<\/(callout|details|column|blockquote)>/

/**
 * Cuerpo de una página como líneas de texto legible con su sangría. Cada base
 * se sustituye por el texto de `describeDatabase` (con su posición entre las
 * bases del cuerpo, en el orden de `findDatabaseRefs`); las tablas, por una
 * línea por fila (`| a | b |`). Cada línea lleva los bloques que la contienen
 * (aviso destacado, desplegable, columna, cita) para omitirlos enteros.
 */
export function contentToLines(content: string, describeDatabase: (ref: DatabaseRef, index: number) => string): TextLine[] {
  const lines: TextLine[] = []
  let tables = 0
  let table: { id: number; indent: number; blocks: readonly number[] } | null = null
  let row: string[] | null = null
  let refIndex = 0
  let blocks = 0
  const open: number[] = []
  let quote: number | null = null
  const flushRow = (): void => {
    if (table && row && row.some(cell => cell.length > 0)) {
      lines.push({ indent: table.indent, text: `| ${row.join(' | ')} |`, table: table.id, blocks: table.blocks })
    }
    row = null
  }
  for (const rawLine of cleanBlock(content).split('\n')) {
    const indent = /^\t*/.exec(rawLine)![0].length
    const line = rawLine.slice(indent).trim()
    // Las citas de varias líneas (`> …` seguidas) forman un bloque.
    if (line.startsWith('>')) {
      if (quote === null) {
        blocks += 1
        quote = blocks
      }
    } else if (line.length > 0) {
      quote = null
    }
    const containers = quote === null ? [...open] : [...open, quote]
    const opening = CONTAINER_OPEN.exec(line)
    if (opening && !new RegExp(`</${opening[1]}>`).test(line)) {
      blocks += 1
      open.push(blocks)
      containers.push(blocks)
    }
    if (CONTAINER_CLOSE.test(line)) {
      open.pop()
    }
    const tokens = Array.from(line.matchAll(TABLE_TOKEN))
    if (tokens.length > 0) {
      refIndex += Array.from(line.matchAll(DATABASE_TAG)).length
      for (const token of tokens) {
        const tag = token[0]
        if (tag.startsWith('<table')) {
          tables += 1
          table = { id: tables, indent, blocks: containers }
        } else if (tag === '</table>') {
          flushRow()
          table = null
        } else if (tag.startsWith('<tr')) {
          flushRow()
          row = []
        } else if (tag === '</tr>') {
          flushRow()
        } else if (token[1] !== undefined) {
          row ??= []
          row.push(oneLine(inlineText(token[1])))
        }
      }
      continue
    }
    const withBases = line.replace(DATABASE_TAG, (...match) => {
      const description = describeDatabase(databaseRef(match as unknown as RegExpMatchArray), refIndex)
      refIndex += 1
      return description
    })
    const text = inlineText(withBases)
    if (text.trim().length > 0) {
      lines.push(containers.length > 0 ? { indent, text: text.trim(), blocks: containers } : { indent, text: text.trim() })
    } else if (line.length === 0) {
      lines.push({ indent: 0, text: '' })
    }
  }
  flushRow()
  return lines
}

export interface PropertyLine {
  readonly name: string
  readonly value: string
}

export interface FilteredProperties {
  readonly lines: readonly PropertyLine[]
  /** Propiedades de la base que no salen (tipo o nombre excluidos). */
  readonly excluded: number
  /** Valores sustituidos por OMITTED_MARK. */
  readonly omitted: number
}

function stringList(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    return value.every(item => typeof item === 'string') ? (value as string[]) : null
  }
  if (typeof value === 'string' && value.startsWith('[')) {
    try {
      return stringList(JSON.parse(value))
    } catch {
      return [value]
    }
  }
  return typeof value === 'string' ? [value] : null
}

function propertyValue(name: string, type: string, properties: Record<string, unknown>): string {
  switch (type) {
    case 'date': {
      const start = properties[`date:${name}:start`]
      const end = properties[`date:${name}:end`]
      if (typeof start !== 'string' || !start) {
        return ''
      }
      return typeof end === 'string' && end ? `${start} → ${end}` : start
    }
    case 'checkbox': {
      const value = properties[name]
      return value === true || value === '__YES__' ? 'sí' : value === false || value === '__NO__' ? 'no' : ''
    }
    case 'multi_select':
      return (stringList(properties[name]) ?? []).join(', ')
    default: {
      const value = properties[name]
      return typeof value === 'string' ? inlineText(value) : ''
    }
  }
}

/**
 * Propiedades que pueden llegar al agente: las del esquema con un tipo de
 * ALLOWED_PROPERTY_TYPES y un nombre no comercial ni económico, salvo el
 * título (va como encabezado). Lo que no está en el esquema no sale nunca.
 */
export function filterProperties(properties: Record<string, unknown>, schema: DataSourceSchema): FilteredProperties {
  const lines: PropertyLine[] = []
  let excluded = 0
  let omitted = 0
  for (const [name, definition] of Object.entries(schema)) {
    const type = asRecord(definition)?.['type']
    if (type === 'title') {
      continue
    }
    if (typeof type !== 'string' || !Object.hasOwn(ALLOWED_PROPERTY_TYPES, type) || isExcludedPropertyName(name)) {
      excluded += 1
      continue
    }
    const value = oneLine(propertyValue(name, type, properties))
    if (!value) {
      continue
    }
    if (hasMoney(value)) {
      omitted += 1
      lines.push({ name: oneLine(name), value: OMITTED_MARK })
    } else {
      lines.push({ name: oneLine(name), value })
    }
  }
  return { lines, excluded, omitted }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}
