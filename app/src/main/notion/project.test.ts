import { describe, expect, it } from 'vitest'
import { notionPageIdFromUrl } from '../../shared/notion'
import {
  FIXTURE_PROJECT_PROPERTIES,
  FIXTURE_PROJECT_SCHEMA,
  FIXTURE_PROJECTS_SOURCE,
  fixtureDataSourceResponse,
  fixturePageResponse,
} from './fixtures'
import {
  buildSnapshot,
  isProjectSchema,
  parseDataSourceSchema,
  parseFetchedPage,
  sanitizeSnapshot,
  UnrecognizedResponseError,
} from './project'

const PAGE_ID = 'aaaaaaaabbbb4ccc8dddeeeeeeeeeeee'
const PAGE_URL = `https://www.notion.so/${PAGE_ID}`
const FETCHED_AT = '2026-10-26T12:00:00.000Z'

function projectSnapshot() {
  const page = parseFetchedPage(fixturePageResponse(PAGE_URL, FIXTURE_PROJECTS_SOURCE, FIXTURE_PROJECT_PROPERTIES))
  const schema = parseDataSourceSchema(fixtureDataSourceResponse(FIXTURE_PROJECTS_SOURCE, FIXTURE_PROJECT_SCHEMA))
  return buildSnapshot(PAGE_ID, page, schema, FETCHED_AT)
}

describe('ficha desde notion-fetch', () => {
  it('copia solo el título y los campos permitidos, con los colores del esquema', () => {
    const snapshot = projectSnapshot()
    expect(snapshot.title).toBe('Proyecto sintético')
    expect(snapshot.editedAt).toBe('2026-10-25T09:30:00.000Z')
    expect(snapshot.fields.map(field => field.value)).toEqual([
      { kind: 'status', option: { name: 'In progress', color: 'orange' } },
      { kind: 'tags', options: [{ name: 'Branding', color: 'blue' }, { name: 'Web', color: 'green' }] },
      { kind: 'date', start: '2026-10-01', end: null },
      { kind: 'date', start: null, end: null },
    ])
    expect(JSON.stringify(snapshot)).not.toMatch(/SECRETO|Budget|Lead|Notion Link|Preview|formulaResult/)
  })

  it('lee la base de la página y reconoce el esquema de proyectos', () => {
    expect(parseFetchedPage(fixturePageResponse(PAGE_URL, FIXTURE_PROJECTS_SOURCE, {})).dataSourceUrl).toBe(FIXTURE_PROJECTS_SOURCE)
    expect(parseFetchedPage(fixturePageResponse(PAGE_URL, null, {})).dataSourceUrl).toBeNull()
    expect(isProjectSchema(FIXTURE_PROJECT_SCHEMA)).toBe(true)
    expect(isProjectSchema({ ...FIXTURE_PROJECT_SCHEMA, Status: { type: 'select' } })).toBe(false)
    expect(isProjectSchema({ Name: { type: 'title' } })).toBe(false)
  })

  it('vacíos sin inventar datos y tipos inesperados marcados', () => {
    const page = parseFetchedPage(
      fixturePageResponse(PAGE_URL, FIXTURE_PROJECTS_SOURCE, { Title: 'Vacío', Services: 'Branding', Status: 3 }),
    )
    const snapshot = buildSnapshot(PAGE_ID, page, FIXTURE_PROJECT_SCHEMA, FETCHED_AT)
    expect(snapshot.fields.map(field => field.value)).toEqual([
      { kind: 'incompatible', actualType: 'number' },
      { kind: 'incompatible', actualType: 'string' },
      { kind: 'date', start: null, end: null },
      { kind: 'date', start: null, end: null },
    ])
  })

  it('rechaza respuestas con otro formato', () => {
    expect(() => parseFetchedPage('no es json')).toThrow(UnrecognizedResponseError)
    expect(() => parseFetchedPage(JSON.stringify({ text: '<page>sin propiedades</page>' }))).toThrow(UnrecognizedResponseError)
    expect(() => parseDataSourceSchema(JSON.stringify({ text: '<data-source-state>{roto</data-source-state>' }))).toThrow(
      UnrecognizedResponseError,
    )
  })
})

describe('sanitizeSnapshot', () => {
  it('reconstruye una caché alterada con la lista cerrada', () => {
    const snapshot = projectSnapshot()
    const tampered = {
      ...snapshot,
      Opportunity: 'SECRETO-OPORTUNIDAD',
      fields: [
        ...snapshot.fields,
        { name: 'Budget', label: 'Presupuesto', value: { kind: 'tags', options: [{ name: 'SECRETO-PRESUPUESTO' }] } },
        { name: 'Status', label: 'Estado', value: { kind: 'status', option: { name: 'SECRETO-DUPLICADO' }, extra: 'SECRETO' } },
      ],
    }
    const clean = sanitizeSnapshot(tampered, PAGE_ID)
    expect(clean).toEqual(snapshot)
    expect(JSON.stringify(clean)).not.toMatch(/SECRETO|Budget|Opportunity/)
  })

  it('rechaza la caché de otra página o incompleta', () => {
    const snapshot = projectSnapshot()
    expect(sanitizeSnapshot(snapshot, 'otra')).toBeNull()
    expect(sanitizeSnapshot({ ...snapshot, fetchedAt: undefined }, PAGE_ID)).toBeNull()
  })
})

describe('notionPageIdFromUrl', () => {
  it('lee el ID al final del último segmento o en ?p=', () => {
    expect(notionPageIdFromUrl('https://www.notion.so/equipo/Mi-proyecto-0123456789abcdef0123456789abcdef')).toBe(
      '0123456789abcdef0123456789abcdef',
    )
    expect(notionPageIdFromUrl('https://app.notion.com/p/equipo/Mi-proyecto-0123456789ABCDEF0123456789ABCDEF?pvs=4')).toBe(
      '0123456789abcdef0123456789abcdef',
    )
    expect(notionPageIdFromUrl('https://www.notion.so/equipo/fedcba98765432100123456789abcdef?p=0123456789abcdef0123456789abcdef')).toBe(
      '0123456789abcdef0123456789abcdef',
    )
    expect(notionPageIdFromUrl('https://www.notion.so/equipo/01234567-89ab-cdef-0123-456789abcdef')).toBe(
      '0123456789abcdef0123456789abcdef',
    )
  })

  it('devuelve null si no hay ID', () => {
    expect(notionPageIdFromUrl('https://www.notion.so/')).toBeNull()
    expect(notionPageIdFromUrl('https://www.notion.so/equipo/Mi-proyecto')).toBeNull()
    expect(notionPageIdFromUrl('no es una url')).toBeNull()
  })
})
