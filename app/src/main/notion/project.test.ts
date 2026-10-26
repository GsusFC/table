import { describe, expect, it } from 'vitest'
import { notionPageIdFromUrl } from '../../shared/notion'
import { extractProject, isProjectDatabase, sanitizeSnapshot } from './project'

const DATABASE_ID = '11111111-2222-4333-8444-555555555555'
const PAGE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const FETCHED_AT = '2026-10-26T12:00:00.000Z'

/** Ficha sintética con todos los campos excluidos rellenos con valores centinela. */
function fixturePage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    object: 'page',
    id: PAGE_ID,
    last_edited_time: '2026-10-25T09:30:00.000Z',
    parent: { type: 'database_id', database_id: DATABASE_ID },
    properties: {
      Title: { type: 'title', title: [{ plain_text: 'Proyecto ' }, { plain_text: 'de prueba' }] },
      Status: { type: 'status', status: { name: 'In progress', color: 'orange' } },
      Services: { type: 'multi_select', multi_select: [{ name: 'Branding', color: 'blue' }, { name: 'Web', color: 'green' }] },
      'Start Date': { type: 'date', date: { start: '2026-10-01', end: null } },
      'Due Date': { type: 'date', date: null },
      'Remaining days': { type: 'formula', formula: { type: 'number', number: 34 } },
      Budget: { type: 'rich_text', rich_text: [{ plain_text: 'SECRETO-PRESUPUESTO 12.000 €' }] },
      Opportunity: { type: 'relation', relation: [{ id: 'SECRETO-OPORTUNIDAD' }] },
      Account: { type: 'relation', relation: [{ id: 'SECRETO-CUENTA' }] },
      Leaders: { type: 'people', people: [{ id: 'SECRETO-PERSONA', name: 'SECRETO-NOMBRE' }] },
      Lead: { type: 'url', url: 'https://example.com/SECRETO-LEAD' },
      'Notion Link': { type: 'url', url: 'https://example.com/SECRETO-ENLACE' },
      Preview: { type: 'files', files: [{ name: 'SECRETO-PREVIEW.png' }] },
      ...overrides,
    },
  }
}

describe('extractProject', () => {
  it('copia solo el título y los campos permitidos', () => {
    const snapshot = extractProject(fixturePage(), DATABASE_ID, FETCHED_AT)
    expect(snapshot).not.toBeNull()
    expect(snapshot!.pageId).toBe('aaaaaaaabbbb4ccc8dddeeeeeeeeeeee')
    expect(snapshot!.title).toBe('Proyecto de prueba')
    expect(snapshot!.fields.map(field => field.name)).toEqual(['Status', 'Services', 'Start Date', 'Due Date', 'Remaining days'])
    expect(snapshot!.fields.map(field => field.value)).toEqual([
      { kind: 'status', option: { name: 'In progress', color: 'orange' } },
      { kind: 'tags', options: [{ name: 'Branding', color: 'blue' }, { name: 'Web', color: 'green' }] },
      { kind: 'date', start: '2026-10-01', end: null },
      { kind: 'date', start: null, end: null },
      { kind: 'text', text: '34' },
    ])
    expect(JSON.stringify(snapshot)).not.toMatch(/SECRETO|Budget|Opportunity|Account|Leaders|Lead|Notion Link|Preview/)
  })

  it('no reconoce como ficha una página de otra base o que no está en una base', () => {
    expect(extractProject(fixturePage(), '99999999999949998999999999999999', FETCHED_AT)).toBeNull()
    expect(extractProject({ ...fixturePage(), parent: { type: 'page_id', page_id: DATABASE_ID } }, DATABASE_ID, FETCHED_AT)).toBeNull()
    expect(extractProject(null, DATABASE_ID, FETCHED_AT)).toBeNull()
  })

  it('marca campos ausentes o de otro tipo sin inventar valores', () => {
    const snapshot = extractProject(
      fixturePage({ Status: undefined, Services: { type: 'rich_text', rich_text: [{ plain_text: 'Branding' }] } }),
      DATABASE_ID,
      FETCHED_AT,
    )
    expect(snapshot!.fields[0]!.value).toEqual({ kind: 'missing' })
    expect(snapshot!.fields[1]!.value).toEqual({ kind: 'incompatible', actualType: 'rich_text' })
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

describe('sanitizeSnapshot', () => {
  it('reconstruye una caché alterada con la lista cerrada', () => {
    const snapshot = extractProject(fixturePage(), DATABASE_ID, FETCHED_AT)!
    const tampered = {
      ...snapshot,
      Opportunity: 'SECRETO-OPORTUNIDAD',
      fields: [
        ...snapshot.fields,
        { name: 'Budget', label: 'Presupuesto', value: { kind: 'text', text: 'SECRETO-PRESUPUESTO' } },
        { name: 'Status', label: 'Estado', value: { kind: 'text', text: 'SECRETO-DUPLICADO', extra: 'SECRETO' } },
      ],
    }
    const clean = sanitizeSnapshot(tampered, snapshot.pageId)
    expect(clean).toEqual(snapshot)
    expect(JSON.stringify(clean)).not.toMatch(/SECRETO|Budget|Opportunity/)
  })

  it('rechaza la caché de otra página o incompleta', () => {
    const snapshot = extractProject(fixturePage(), DATABASE_ID, FETCHED_AT)!
    expect(sanitizeSnapshot(snapshot, 'otra')).toBeNull()
    expect(sanitizeSnapshot({ ...snapshot, fetchedAt: undefined }, snapshot.pageId)).toBeNull()
  })
})

describe('isProjectDatabase', () => {
  const schema = {
    Title: { type: 'title' },
    Status: { type: 'status' },
    Services: { type: 'multi_select' },
    'Start Date': { type: 'date' },
    'Due Date': { type: 'date' },
    'Remaining days': { type: 'formula' },
  }

  it('reconoce el esquema de proyectos aunque tenga más propiedades', () => {
    expect(isProjectDatabase({ ...schema, Budget: { type: 'rich_text' } })).toBe(true)
  })

  it('descarta bases sin algún campo o con otro tipo', () => {
    expect(isProjectDatabase({ Name: { type: 'title' } })).toBe(false)
    expect(isProjectDatabase({ ...schema, Status: { type: 'select' } })).toBe(false)
    expect(isProjectDatabase({ ...schema, Title: undefined, Name: { type: 'title' } })).toBe(false)
    expect(isProjectDatabase(null)).toBe(false)
  })
})
