/**
 * Respuestas sintéticas con el formato de `notion-fetch` del MCP de Notion
 * (comprobado el 2026-10-26). Las usan los tests y el smoke; ningún dato real.
 * Los campos excluidos llevan el texto SECRETO para comprobar que no se filtran.
 */

export const FIXTURE_PROJECTS_SOURCE = 'collection://11111111-2222-4333-8444-555555555555'
export const FIXTURE_OTHER_SOURCE = 'collection://66666666-2222-4333-8444-555555555555'

export const FIXTURE_PROJECT_PROPERTIES: Record<string, unknown> = {
  Title: 'Proyecto sintético',
  Status: 'In progress',
  Services: ['Branding', 'Web'],
  'date:Start Date:start': '2026-10-01',
  'date:Start Date:is_datetime': 0,
  'date:Due Date:is_datetime': 0,
  'Remaining days': 'formulaResult://11111111-2222-4333-8444-555555555555/aaaa/eWM6YQ',
  Budget: 'SECRETO-PRESUPUESTO 12.000 €',
  Lead: 'https://example.com/SECRETO-LEAD',
  'Notion Link': 'https://example.com/SECRETO-ENLACE',
  Preview: '["SECRETO-PREVIEW.png"]',
  url: 'https://www.notion.so/aaaaaaaabbbb4ccc8dddeeeeeeeeeeee',
}

export const FIXTURE_PROJECT_SCHEMA: Record<string, unknown> = {
  Title: { name: 'Title', type: 'title' },
  Status: {
    name: 'Status',
    type: 'status',
    groups: {
      to_do: [{ name: 'Not started', color: 'default' }],
      in_progress: [{ name: 'In progress', color: 'orange' }],
      complete: [{ name: 'Done', color: 'green' }],
    },
  },
  Services: { name: 'Services', type: 'multi_select', options: [{ name: 'Branding', color: 'blue' }, { name: 'Web', color: 'green' }] },
  'Start Date': { name: 'Start Date', type: 'date' },
  'Due Date': { name: 'Due Date', type: 'date' },
  'Remaining days': { name: 'Remaining days', type: 'formula' },
  Budget: { name: 'Budget', type: 'rich_text' },
  Account: { name: 'Account', type: 'relation' },
  Leaders: { name: 'Leaders', type: 'person' },
}

/** Respuesta de `notion-fetch` para una página de una base. */
export function fixturePageResponse(
  pageUrl: string,
  dataSourceUrl: string | null,
  properties: Record<string, unknown>,
  editedAt = '2026-10-25T09:30:00.000Z',
): string {
  const parent = dataSourceUrl ? `<ancestor-path>\n<parent-data-source url="${dataSourceUrl}" name="Base sintética"/>\n</ancestor-path>\n` : ''
  const text = `Here is the result of "fetch" for the Page with URL ${pageUrl} as of 2026-10-26T20:00:00.000Z:
<page url="${pageUrl}">
${parent}<properties>
${JSON.stringify(properties)}
</properties>
<content>
<p>Presupuesto acordado: SECRETO-CUERPO 9.000 €</p>
</content>
</page>`
  return JSON.stringify({ metadata: { type: 'page' }, title: 'Página sintética', url: pageUrl, text, page_last_edited_at: editedAt })
}

/** Respuesta de `notion-fetch` para una base (fuente de datos), con su esquema. */
export function fixtureDataSourceResponse(dataSourceUrl: string, schema: Record<string, unknown>): string {
  const state = { name: 'Base sintética', schema }
  const text = `Here is the result of "fetch" for the Data Source ${dataSourceUrl}:
<data-source url="{{${dataSourceUrl}}}">
<data-source-state>
${JSON.stringify(state)}
</data-source-state>
</data-source>`
  return JSON.stringify({ metadata: { type: 'data-source' }, title: 'Base sintética', url: dataSourceUrl, text })
}
