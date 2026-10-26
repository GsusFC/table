import {
  PROJECT_FIELDS,
  PROJECT_TITLE_FIELD,
  type NotionOption,
  type ProjectField,
  type ProjectFieldValue,
  type ProjectSnapshot,
} from '../../shared/notion'

/**
 * Lectura de la respuesta de `notion-fetch` del MCP de Notion. La respuesta es
 * un JSON cuyo `text` lleva etiquetas como `<parent-data-source url="collection://…">`,
 * `<properties>{…}</properties>` (página) o `<data-source-state>{…}</data-source-state>`
 * (base). Si el formato cambia, se trata como respuesta no reconocida; nunca se adivina.
 */

/** Propiedades de una página tal como las devuelve el MCP, más su base. */
export interface FetchedPage {
  /** `collection://<id>` de la base (fuente de datos) a la que pertenece; null si no está en una base. */
  readonly dataSourceUrl: string | null
  readonly properties: Record<string, unknown>
  readonly editedAt: string | null
}

/** Esquema de una base: nombre de propiedad → definición (`type`, `options`, `groups`…). */
export type DataSourceSchema = Record<string, unknown>

export class UnrecognizedResponseError extends Error {
  constructor() {
    super('Respuesta de Notion no reconocida')
    this.name = 'UnrecognizedResponseError'
  }
}

function envelope(raw: string): Record<string, unknown> {
  try {
    const parsed = asRecord(JSON.parse(raw))
    if (parsed && typeof parsed['text'] === 'string') {
      return parsed
    }
  } catch {
    // Se informa abajo.
  }
  throw new UnrecognizedResponseError()
}

function taggedJson(text: string, tag: string): Record<string, unknown> | null {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text)
  if (!match) {
    return null
  }
  try {
    return asRecord(JSON.parse(match[1]!))
  } catch {
    throw new UnrecognizedResponseError()
  }
}

export function parseFetchedPage(raw: string): FetchedPage {
  const response = envelope(raw)
  const text = response['text'] as string
  const properties = taggedJson(text, 'properties')
  if (!properties) {
    throw new UnrecognizedResponseError()
  }
  const parent = /<parent-data-source\s+url="(collection:\/\/[0-9a-f-]+)"/i.exec(text)
  return {
    dataSourceUrl: parent ? parent[1]! : null,
    properties,
    editedAt: typeof response['page_last_edited_at'] === 'string' ? response['page_last_edited_at'] : null,
  }
}

export function parseDataSourceSchema(raw: string): DataSourceSchema {
  const state = taggedJson(envelope(raw)['text'] as string, 'data-source-state')
  const schema = asRecord(state?.['schema'])
  if (!schema) {
    throw new UnrecognizedResponseError()
  }
  return schema
}

/** Verdadero si el esquema tiene `Title` y todos los campos permitidos con su tipo: es una base de proyectos. */
export function isProjectSchema(schema: DataSourceSchema): boolean {
  if (asRecord(schema[PROJECT_TITLE_FIELD])?.['type'] !== 'title') {
    return false
  }
  return PROJECT_FIELDS.every(field => asRecord(schema[field.name])?.['type'] === field.type)
}

/**
 * Ficha del proyecto con la lista cerrada: solo `Title` y PROJECT_FIELDS. El
 * resto de propiedades (presupuesto, oportunidad, relaciones, personas…) no se
 * copia nunca. Los colores de las opciones salen del esquema de la base.
 */
export function buildSnapshot(pageId: string, page: FetchedPage, schema: DataSourceSchema, fetchedAt: string): ProjectSnapshot {
  const title = page.properties[PROJECT_TITLE_FIELD]
  const fields: ProjectField[] = PROJECT_FIELDS.map(field => ({
    name: field.name,
    label: field.label,
    value: readField(field.name, field.type, page.properties, schemaOptions(asRecord(schema[field.name]))),
  }))
  return {
    pageId,
    title: typeof title === 'string' ? title.trim() : '',
    fields,
    fetchedAt,
    editedAt: page.editedAt ?? fetchedAt,
  }
}

function readField(
  name: string,
  type: (typeof PROJECT_FIELDS)[number]['type'],
  properties: Record<string, unknown>,
  options: ReadonlyMap<string, string>,
): ProjectFieldValue {
  const option = (value: string): NotionOption => ({ name: value, color: options.get(value) ?? 'default' })
  switch (type) {
    case 'status': {
      const value = properties[name]
      if (value === undefined || value === null || value === '') {
        return { kind: 'status', option: null }
      }
      return typeof value === 'string' ? { kind: 'status', option: option(value) } : { kind: 'incompatible', actualType: typeof value }
    }
    case 'multi_select': {
      const value = properties[name]
      if (value === undefined || value === null) {
        return { kind: 'tags', options: [] }
      }
      return Array.isArray(value) && value.every(item => typeof item === 'string')
        ? { kind: 'tags', options: value.map(option) }
        : { kind: 'incompatible', actualType: typeof value }
    }
    case 'date': {
      const start = properties[`date:${name}:start`]
      const end = properties[`date:${name}:end`]
      return { kind: 'date', start: typeof start === 'string' ? start : null, end: typeof end === 'string' ? end : null }
    }
  }
}

/** Nombre de opción → color, de `options` (selección múltiple) o `groups` (estado). */
function schemaOptions(definition: Record<string, unknown> | null): ReadonlyMap<string, string> {
  const colors = new Map<string, string>()
  const add = (list: unknown): void => {
    for (const item of Array.isArray(list) ? list : []) {
      const option = asRecord(item)
      if (typeof option?.['name'] === 'string' && typeof option['color'] === 'string') {
        colors.set(option['name'], option['color'])
      }
    }
  }
  add(definition?.['options'])
  for (const group of Object.values(asRecord(definition?.['groups']) ?? {})) {
    add(group)
  }
  return colors
}

/**
 * Reconstruye una ficha guardada en caché con la misma lista cerrada: un archivo
 * alterado no puede colar propiedades ni campos fuera de PROJECT_FIELDS.
 */
export function sanitizeSnapshot(value: unknown, pageId: string): ProjectSnapshot | null {
  const record = asRecord(value)
  if (
    !record ||
    record['pageId'] !== pageId ||
    typeof record['title'] !== 'string' ||
    typeof record['fetchedAt'] !== 'string' ||
    typeof record['editedAt'] !== 'string' ||
    !Array.isArray(record['fields'])
  ) {
    return null
  }
  const stored = record['fields'].map(asRecord)
  const fields: ProjectField[] = PROJECT_FIELDS.map(field => {
    const match = stored.find(candidate => candidate?.['name'] === field.name)
    return { name: field.name, label: field.label, value: sanitizeValue(asRecord(match?.['value'])) }
  })
  return { pageId, title: record['title'], fields, fetchedAt: record['fetchedAt'], editedAt: record['editedAt'] }
}

function sanitizeValue(value: Record<string, unknown> | null): ProjectFieldValue {
  switch (value?.['kind']) {
    case 'status':
      return { kind: 'status', option: readOption(value['option']) }
    case 'tags':
      return {
        kind: 'tags',
        options: Array.isArray(value['options'])
          ? value['options'].map(readOption).filter((option): option is NotionOption => option !== null)
          : [],
      }
    case 'date':
      return {
        kind: 'date',
        start: typeof value['start'] === 'string' ? value['start'] : null,
        end: typeof value['end'] === 'string' ? value['end'] : null,
      }
    case 'incompatible':
      return { kind: 'incompatible', actualType: typeof value['actualType'] === 'string' ? value['actualType'] : 'desconocido' }
    default:
      return { kind: 'missing' }
  }
}

function readOption(value: unknown): NotionOption | null {
  const option = asRecord(value)
  if (!option || typeof option['name'] !== 'string') {
    return null
  }
  return { name: option['name'], color: typeof option['color'] === 'string' ? option['color'] : 'default' }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}
