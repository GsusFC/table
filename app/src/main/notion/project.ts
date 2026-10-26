import {
  normalizeNotionId,
  PROJECT_FIELDS,
  PROJECT_TITLE_FIELD,
  type NotionOption,
  type ProjectField,
  type ProjectFieldValue,
  type ProjectSnapshot,
} from '../../shared/notion'

/**
 * Convierte una página de la API de Notion en la ficha del proyecto. Lista
 * cerrada: solo se leen `Title` y PROJECT_FIELDS; el resto de propiedades
 * (presupuesto, oportunidad, relaciones, personas…) no se copia nunca.
 * Devuelve null si la página no pertenece a la base de proyectos.
 */
export function extractProject(page: unknown, databaseId: string, fetchedAt: string): ProjectSnapshot | null {
  const record = asRecord(page)
  const parent = asRecord(record?.['parent'])
  if (!record || parent?.['type'] !== 'database_id' || typeof parent['database_id'] !== 'string') {
    return null
  }
  if (normalizeNotionId(parent['database_id']) !== normalizeNotionId(databaseId)) {
    return null
  }
  const pageId = typeof record['id'] === 'string' ? normalizeNotionId(record['id']) : null
  if (!pageId) {
    return null
  }
  const properties = asRecord(record['properties']) ?? {}
  const titleProperty = asRecord(properties[PROJECT_TITLE_FIELD])
  const title = titleProperty?.['type'] === 'title' ? plainText(titleProperty['title']) : ''
  const fields: ProjectField[] = PROJECT_FIELDS.map(field => ({
    name: field.name,
    label: field.label,
    value: readField(asRecord(properties[field.name]), field.type),
  }))
  return {
    pageId,
    title,
    fields,
    fetchedAt,
    editedAt: typeof record['last_edited_time'] === 'string' ? record['last_edited_time'] : fetchedAt,
  }
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
    case 'text':
      return { kind: 'text', text: typeof value['text'] === 'string' ? value['text'] : '' }
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
      return readDate(value)
    case 'incompatible':
      return { kind: 'incompatible', actualType: typeof value['actualType'] === 'string' ? value['actualType'] : 'desconocido' }
    default:
      return { kind: 'missing' }
  }
}

function readField(property: Record<string, unknown> | null, expected: string): ProjectFieldValue {
  if (!property) {
    return { kind: 'missing' }
  }
  const type = typeof property['type'] === 'string' ? property['type'] : 'desconocido'
  if (type !== expected) {
    return { kind: 'incompatible', actualType: type }
  }
  const value = property[type]
  switch (type) {
    case 'status':
      return { kind: 'status', option: readOption(value) }
    case 'multi_select':
      return {
        kind: 'tags',
        options: Array.isArray(value) ? value.map(readOption).filter((option): option is NotionOption => option !== null) : [],
      }
    case 'date':
      return readDate(value)
    case 'formula':
      return readFormula(asRecord(value))
    default:
      return { kind: 'incompatible', actualType: type }
  }
}

function readFormula(formula: Record<string, unknown> | null): ProjectFieldValue {
  switch (formula?.['type']) {
    case 'string':
      return { kind: 'text', text: typeof formula['string'] === 'string' ? formula['string'] : '' }
    case 'number':
      return { kind: 'text', text: typeof formula['number'] === 'number' ? String(formula['number']) : '' }
    case 'boolean':
      return { kind: 'text', text: formula['boolean'] === true ? 'Sí' : 'No' }
    case 'date':
      return readDate(formula['date'])
    default:
      return { kind: 'incompatible', actualType: `formula:${String(formula?.['type'])}` }
  }
}

function readDate(value: unknown): ProjectFieldValue {
  const date = asRecord(value)
  return {
    kind: 'date',
    start: typeof date?.['start'] === 'string' ? date['start'] : null,
    end: typeof date?.['end'] === 'string' ? date['end'] : null,
  }
}

function readOption(value: unknown): NotionOption | null {
  const option = asRecord(value)
  if (!option || typeof option['name'] !== 'string') {
    return null
  }
  return { name: option['name'], color: typeof option['color'] === 'string' ? option['color'] : 'default' }
}

function plainText(value: unknown): string {
  if (!Array.isArray(value)) {
    return ''
  }
  return value
    .map(part => {
      const text = asRecord(part)?.['plain_text']
      return typeof text === 'string' ? text : ''
    })
    .join('')
    .trim()
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}
