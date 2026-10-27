import { createHash } from 'node:crypto'
import { lstat, mkdir, readdir, readFile, rm, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { Mesa, MesaId } from '../../shared/model'
import { notionPageIdFromUrl, type ProjectSnapshot } from '../../shared/notion'
import {
  DEFAULT_NOTION_SELECTION,
  isPageSelected,
  parseNotionSelection,
  type NotionContextPhase,
  type NotionContextProgress,
  type NotionPageSelection,
  type NotionTree,
} from '../../shared/notionContext'
import { writeFileAtomic } from '../files'
import { log } from '../log'
import {
  contentToLines,
  filterProperties,
  findDatabaseRefs,
  parseDataSource,
  parseLinkedDataSources,
  parsePageContent,
  parseRows,
  rowEntry,
  type DatabaseRef,
  type PropertyLine,
  type RowEntry,
} from '../notion/content'
import { FILTER_RULES_VERSION, hasMoney, redactMoney, safeLabel, type TextLine } from '../notion/filters'
import { NotionError, type NotionMcp } from '../notion/mcp'
import { UnrecognizedResponseError, type DataSourceSchema } from '../notion/project'
import { cleanBlock, oneLine } from './context'
import {
  formatIndex,
  formatPageFile,
  NOTION_DIR,
  NOTION_INDEX,
  pageFileName,
  plural,
  type IndexBase,
  type IndexPage,
  type IndexProject,
  type NotionContentSummary,
  type PageRecord,
} from './notionFiles'

/**
 * Contenido completo de Notion para los agentes (T-009). Para cada ficha de
 * proyecto de la mesa, Table lee su cuerpo, las bases incrustadas o enlazadas
 * en él (sin repetir una base) y el contenido de cada fila: dos niveles, nunca
 * bases dentro de las filas. Lo filtra y lo escribe en `notion/` de la carpeta
 * de la mesa. Se hace en dos pasos: listar el árbol (barato: la ficha y las
 * filas de sus bases) y leer solo las páginas elegidas que cambiaron.
 *
 * Todo el trabajo de una mesa va en cola (una lectura o publicación a la vez).
 * Cada trabajo tiene su señal de cancelación y la comprueba antes de cada
 * escritura: desconectar Notion, borrar la mesa o guardar otra selección lo
 * cancela, y no se escribe nada después.
 */

export interface NotionContentLimits {
  /** Páginas como mucho por mesa (cuerpos de ficha incluidos). */
  readonly maxPages: number
  /** Bytes como mucho del conjunto de archivos de página. */
  readonly maxBytes: number
  /** Bytes como mucho del cuerpo de una página. */
  readonly maxPageBytes: number
  /** Bases distintas como mucho por ficha. */
  readonly maxBases: number
  /** Filas por base: el máximo de `notion-query-data-sources` en modo `rows`, que no da cursor. */
  readonly rowsPerBase: number
  /** Lecturas simultáneas a Notion. */
  readonly concurrency: number
}

export const DEFAULT_LIMITS: NotionContentLimits = {
  maxPages: 400,
  maxBytes: 2 * 1024 * 1024,
  maxPageBytes: 200 * 1024,
  maxBases: 20,
  rowsPerBase: 100,
  concurrency: 3,
}

export interface NotionContentOptions {
  readonly mcp: NotionMcp
  /** Revisión de la conexión con Notion: si cambia, la lectura en curso se descarta. */
  readonly revision: () => number
  readonly connected: () => boolean
  readonly getMesa: (mesaId: MesaId) => Promise<Mesa>
  /** Carpeta de trabajo de la mesa (absoluta, ya creada). */
  readonly workFolder: (mesa: Mesa) => Promise<string>
  /** Ficha guardada (T-003) de una URL de Notion: decide qué tarjetas son fichas de proyecto. */
  readonly cachedProject: (url: string) => Promise<ProjectSnapshot | null>
  /** Datos de Table (userData): caché del contenido y selecciones, fuera de la carpeta de la mesa. */
  readonly dataDir: string
  readonly onProgress: (progress: NotionContextProgress) => void
  /** Tras escribir `notion/`: reescribe `TABLE.md` con el resumen. */
  readonly onWritten: (mesaId: MesaId) => Promise<void>
  readonly now?: () => string
  readonly limits?: Partial<NotionContentLimits>
}

export interface NotionContent {
  /** Lee y escribe en segundo plano; si ya hay una lectura de la mesa, se repite al terminar. Nunca rechaza. */
  request(mesaId: MesaId): Promise<void>
  /** Árbol de las fichas de la mesa (cuerpo, bases y páginas) con su selección; no lee el contenido de las páginas. */
  tree(mesaId: MesaId): Promise<NotionTree>
  /**
   * Guarda la selección de páginas de esas fichas, cancela la lectura en curso,
   * aplica la selección enseguida con lo ya leído (sin red: lo desmarcado sale
   * de `notion/`) y vuelve a leer en segundo plano.
   */
  setSelection(mesaId: MesaId, selections: Readonly<Record<string, NotionPageSelection>>): Promise<void>
  /** Resumen de la última lectura escrita, o null. */
  summary(mesaId: MesaId): Promise<NotionContentSummary | null>
  /** Último progreso emitido de la mesa, o null. */
  progress(mesaId: MesaId): NotionContextProgress | null
  /** Mesa borrada: cancela y espera su trabajo, y borra su caché y su selección. */
  forget(mesaId: MesaId): Promise<void>
  /** Notion desconectado: cancela y espera todo el trabajo y borra el contenido guardado (las selecciones se conservan). */
  clearCache(): Promise<void>
}

class CancelledError extends Error {
  constructor() {
    super('Lectura cancelada')
    this.name = 'CancelledError'
  }
}

/** Errores que invalidan toda la lectura (no solo una página). */
function isFatal(error: unknown): boolean {
  return error instanceof CancelledError || (error instanceof NotionError && error.code !== 'not-found' && error.code !== 'unexpected')
}

/** Marca de la base número `index` del cuerpo de una ficha; se sustituye al publicar. */
const BASE_TOKEN = /\u0000(\d+)\u0000/g

/** Aviso sustituto si un aviso menciona algo económico. */
const HIDDEN_WARNING = 'Un aviso no se muestra porque mencionaba posible información económica.'

/** Referencia a una base desde el cuerpo de una ficha, con las bases a las que lleva. */
interface SnapshotRef {
  readonly title: string
  readonly sources: readonly string[]
}

interface SnapshotProject {
  readonly pageId: string
  readonly title: string
  readonly url: string
  readonly editedAt: string | null
  readonly fetchedAt: string
  /** Cuerpo ya filtrado, con las bases como marcas BASE_TOKEN. */
  readonly body: readonly string[]
  readonly bodyOmitted: number
  readonly bodyTruncated: boolean
  readonly refs: readonly SnapshotRef[]
  /** Bases de esta ficha (las ya vistas en otra ficha de la mesa no se repiten). */
  readonly bases: readonly string[]
}

interface SnapshotBase {
  readonly dataSourceUrl: string
  readonly title: string
  readonly rows: readonly RowEntry[]
  readonly truncated: boolean
  /** El nombre de la base (en la ficha o el suyo propio) indica información económica: no se lee. */
  readonly moneyName: boolean
  /** Reglas de filtrado y esquema con que se filtraron sus páginas. */
  readonly schemaKey: string
}

/** Árbol leído (sin el contenido de las filas), ya filtrado: se guarda para aplicar una selección sin red. */
interface Snapshot {
  readonly projects: readonly SnapshotProject[]
  readonly bases: Readonly<Record<string, SnapshotBase>>
  readonly warnings: readonly string[]
}

interface Listing {
  readonly snapshot: Snapshot
  /** Esquemas leídos en esta lectura, para filtrar las propiedades de las filas. */
  readonly schemas: ReadonlyMap<string, DataSourceSchema>
}

interface CacheFile {
  readonly version: 2
  readonly pages: Record<string, PageRecord>
  readonly snapshot: Snapshot | null
  readonly summary: NotionContentSummary | null
}

const TOOL_ROWS = 'notion-query-data-sources'

/**
 * Clave de las reglas que se aplicaron a las páginas de una base: versión de
 * los filtros y nombre y tipo de cada propiedad. Si cambia (una propiedad de
 * texto pasa a ser fórmula, se renombra…), las páginas guardadas no se reutilizan.
 */
export function schemaKey(schema: DataSourceSchema): string {
  const entries = Object.entries(schema)
    .map(([name, definition]) => {
      const type = typeof definition === 'object' && definition !== null ? (definition as Record<string, unknown>)['type'] : null
      return [name, typeof type === 'string' ? type : '?']
    })
    .sort(([a], [b]) => (a! < b! ? -1 : a! > b! ? 1 : 0))
  return `${FILTER_RULES_VERSION}:${createHash('sha256').update(JSON.stringify(entries)).digest('hex').slice(0, 24)}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** Página guardada en caché con solo los campos esperados: un archivo alterado no cuela otra cosa. */
function sanitizeRecord(value: unknown, pageId: string): PageRecord | null {
  const record = asRecord(value)
  if (
    !record ||
    record['pageId'] !== pageId ||
    typeof record['title'] !== 'string' ||
    typeof record['url'] !== 'string' ||
    typeof record['fetchedAt'] !== 'string' ||
    typeof record['omitted'] !== 'number' ||
    typeof record['schemaKey'] !== 'string' ||
    !Array.isArray(record['body']) ||
    !Array.isArray(record['properties'])
  ) {
    return null
  }
  const properties = record['properties'].flatMap((item: unknown): PropertyLine[] => {
    const property = asRecord(item)
    return typeof property?.['name'] === 'string' && typeof property['value'] === 'string'
      ? [{ name: property['name'], value: property['value'] }]
      : []
  })
  return {
    pageId,
    title: record['title'],
    url: record['url'],
    editedAt: stringOrNull(record['editedAt']),
    rowEditedAt: stringOrNull(record['rowEditedAt']),
    fetchedAt: record['fetchedAt'],
    base: stringOrNull(record['base']),
    properties,
    body: strings(record['body']),
    omitted: record['omitted'],
    truncated: record['truncated'] === true,
    schemaKey: record['schemaKey'],
  }
}

function sanitizeRow(value: unknown): RowEntry | null {
  const row = asRecord(value)
  const pageId = typeof row?.['pageId'] === 'string' && /^[0-9a-f]{32}$/.test(row['pageId']) ? row['pageId'] : null
  return row && pageId && typeof row['title'] === 'string' ? { pageId, title: row['title'], editedAt: stringOrNull(row['editedAt']) } : null
}

function sanitizeSnapshot(value: unknown): Snapshot | null {
  const snapshot = asRecord(value)
  const bases = asRecord(snapshot?.['bases'])
  if (!snapshot || !bases || !Array.isArray(snapshot['projects'])) {
    return null
  }
  const parsedBases: Record<string, SnapshotBase> = {}
  for (const [url, item] of Object.entries(bases)) {
    const base = asRecord(item)
    if (!base || typeof base['title'] !== 'string' || typeof base['schemaKey'] !== 'string' || !Array.isArray(base['rows'])) {
      return null
    }
    parsedBases[url] = {
      dataSourceUrl: url,
      title: base['title'],
      rows: base['rows'].map(sanitizeRow).filter((row): row is RowEntry => row !== null),
      truncated: base['truncated'] === true,
      moneyName: base['moneyName'] !== false,
      schemaKey: base['schemaKey'],
    }
  }
  const projects: SnapshotProject[] = []
  for (const item of snapshot['projects']) {
    const project = asRecord(item)
    if (
      !project ||
      typeof project['pageId'] !== 'string' ||
      typeof project['title'] !== 'string' ||
      typeof project['url'] !== 'string' ||
      typeof project['fetchedAt'] !== 'string' ||
      typeof project['bodyOmitted'] !== 'number' ||
      !Array.isArray(project['refs'])
    ) {
      return null
    }
    projects.push({
      pageId: project['pageId'],
      title: project['title'],
      url: project['url'],
      editedAt: stringOrNull(project['editedAt']),
      fetchedAt: project['fetchedAt'],
      body: strings(project['body']),
      bodyOmitted: project['bodyOmitted'],
      bodyTruncated: project['bodyTruncated'] === true,
      refs: project['refs'].map(asRecord).map(ref => ({ title: typeof ref?.['title'] === 'string' ? ref['title'] : '', sources: strings(ref?.['sources']) })),
      bases: strings(project['bases']).filter(url => Object.hasOwn(parsedBases, url)),
    })
  }
  return { projects, bases: parsedBases, warnings: strings(snapshot['warnings']) }
}

function sanitizeSummary(value: unknown): NotionContentSummary | null {
  const summary = asRecord(value)
  const numbers = ['projects', 'pages', 'excludedByChoice', 'filteredPages', 'omittedLines'] as const
  if (!summary || typeof summary['readAt'] !== 'string' || !numbers.every(key => typeof summary[key] === 'number')) {
    return null
  }
  return {
    readAt: summary['readAt'],
    projects: summary['projects'] as number,
    pages: summary['pages'] as number,
    excludedByChoice: summary['excludedByChoice'] as number,
    filteredPages: summary['filteredPages'] as number,
    omittedLines: summary['omittedLines'] as number,
    warnings: strings(summary['warnings']),
  }
}

/** Avisos sin nada que parezca económico (un título o un error pueden llevarlo). */
function safeWarnings(warnings: readonly string[]): string[] {
  return [...new Set(warnings.map(warning => (hasMoney(warning) ? HIDDEN_WARNING : warning)))]
}

/** Ejecuta `run` sobre cada elemento con como mucho `limit` a la vez; conserva el orden. */
async function mapLimit<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await run(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

interface PlanBase {
  readonly base: SnapshotBase
  readonly chosen: readonly RowEntry[]
  readonly excluded: number
  /** Omitidas por un título económico o por el límite de páginas. */
  readonly filtered: number
}

interface PlanProject {
  readonly project: SnapshotProject
  /** `limit`: elegido, pero fuera por el límite de páginas. */
  readonly body: 'included' | 'excluded' | 'limit'
  readonly bases: readonly PlanBase[]
}

interface Plan {
  readonly projects: readonly PlanProject[]
  readonly excludedByChoice: number
  readonly filteredPages: number
  readonly warnings: readonly string[]
}

/**
 * Qué entra: lo elegido, sin títulos económicos ni bases con nombre económico,
 * hasta el límite de páginas (primero los cuerpos de las fichas, luego las filas).
 */
function makePlan(snapshot: Snapshot, selections: Readonly<Record<string, NotionPageSelection>>, maxPages: number): Plan {
  const fichaIds = new Set(snapshot.projects.map(project => project.pageId))
  let budget = maxPages
  let excludedByChoice = 0
  let filteredPages = 0
  let moneyTitles = 0
  let overPages = 0
  const bodies = snapshot.projects.map(project => {
    const selection = selections[project.pageId] ?? DEFAULT_NOTION_SELECTION
    if (!selection.body) {
      excludedByChoice += 1
      return 'excluded' as const
    }
    if (budget <= 0) {
      overPages += 1
      return 'limit' as const
    }
    budget -= 1
    return 'included' as const
  })
  const projects = snapshot.projects.map((project, index): PlanProject => {
    const selection = selections[project.pageId] ?? DEFAULT_NOTION_SELECTION
    const bases = project.bases.flatMap((url): PlanBase[] => {
      const base = snapshot.bases[url]
      if (!base) {
        return []
      }
      const chosen: RowEntry[] = []
      let excluded = 0
      let filtered = 0
      for (const row of base.rows) {
        if (fichaIds.has(row.pageId)) {
          continue
        }
        if (hasMoney(row.title)) {
          filtered += 1
          moneyTitles += 1
        } else if (!isPageSelected(selection, base.dataSourceUrl, row.pageId)) {
          excluded += 1
        } else if (budget <= 0) {
          filtered += 1
          overPages += 1
        } else {
          budget -= 1
          chosen.push(row)
        }
      }
      excludedByChoice += excluded
      filteredPages += filtered
      return [{ base, chosen, excluded, filtered }]
    })
    return { project, body: bodies[index]!, bases }
  })
  const moneyBases = Object.values(snapshot.bases).filter(base => base.moneyName).length
  filteredPages += moneyBases + bodies.filter(body => body === 'limit').length
  const warnings: string[] = []
  if (moneyTitles > 0) {
    warnings.push(`${moneyTitles === 1 ? '1 página se omitió' : `${moneyTitles} páginas se omitieron`} porque su título indica información económica.`)
  }
  if (moneyBases > 0) {
    warnings.push(`${moneyBases === 1 ? '1 base se omitió' : `${moneyBases} bases se omitieron`} porque su nombre indica información económica.`)
  }
  if (overPages > 0) {
    warnings.push(`Se alcanzó el límite de ${maxPages} páginas (cuerpos de ficha incluidos): ${overPages === 1 ? '1 página no se leyó' : `${overPages} páginas no se leyeron`}.`)
  }
  return { projects, excludedByChoice, filteredPages, warnings }
}

export function createNotionContent(options: NotionContentOptions): NotionContent {
  const limits: NotionContentLimits = { ...DEFAULT_LIMITS, ...options.limits }
  const now = options.now ?? (() => new Date().toISOString())
  const cacheDir = join(options.dataDir, 'notion-content')
  const selectionDir = join(options.dataDir, 'notion-selection')
  const progresses = new Map<MesaId, NotionContextProgress>()
  /** Cola de trabajo por mesa y señales de lo que está en ella. */
  const chains = new Map<MesaId, Promise<unknown>>()
  const controllers = new Map<MesaId, Set<AbortController>>()
  /** Bucle de lecturas por mesa: `again` repite al terminar; `current` es la lectura en curso. */
  const loops = new Map<MesaId, { again: boolean; current: AbortController | null; done: Promise<void> }>()

  const cachePath = (mesaId: MesaId): string => join(cacheDir, `${mesaId}.json`)
  const selectionPath = (mesaId: MesaId): string => join(selectionDir, `${mesaId}.json`)

  /** Encola un trabajo de la mesa con su señal; las demás operaciones de la mesa esperan su turno. */
  function serial<T>(mesaId: MesaId, controller: AbortController, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    let active = controllers.get(mesaId)
    if (!active) {
      active = new Set()
      controllers.set(mesaId, active)
    }
    active.add(controller)
    const next = (chains.get(mesaId) ?? Promise.resolve()).then(() => run(controller.signal))
    const settled = next
      .catch(() => undefined)
      .finally(() => {
        active.delete(controller)
        if (chains.get(mesaId) === settled) {
          chains.delete(mesaId)
        }
      })
    chains.set(mesaId, settled)
    return next
  }

  /** Cancela todo el trabajo de la mesa y espera a que termine (sin escrituras pendientes). */
  async function stopMesa(mesaId: MesaId): Promise<void> {
    const loop = loops.get(mesaId)
    if (loop) {
      loop.again = false
    }
    for (const controller of controllers.get(mesaId) ?? []) {
      controller.abort()
    }
    await loop?.done
    await chains.get(mesaId)
  }

  async function readCache(mesaId: MesaId): Promise<CacheFile> {
    try {
      const parsed = asRecord(JSON.parse(await readFile(cachePath(mesaId), 'utf8')))
      if (parsed?.['version'] !== 2) {
        return { version: 2, pages: {}, snapshot: null, summary: null }
      }
      const pages: Record<string, PageRecord> = {}
      for (const [pageId, record] of Object.entries(asRecord(parsed['pages']) ?? {})) {
        const sanitized = sanitizeRecord(record, pageId)
        if (sanitized) {
          pages[pageId] = sanitized
        }
      }
      return { version: 2, pages, snapshot: sanitizeSnapshot(parsed['snapshot']), summary: sanitizeSummary(parsed['summary']) }
    } catch {
      return { version: 2, pages: {}, snapshot: null, summary: null }
    }
  }

  async function readSelections(mesaId: MesaId): Promise<Record<string, NotionPageSelection>> {
    let parsed: Record<string, unknown> | null
    try {
      parsed = asRecord(JSON.parse(await readFile(selectionPath(mesaId), 'utf8')))
    } catch {
      return {}
    }
    const selections: Record<string, NotionPageSelection> = {}
    for (const [pageId, selection] of Object.entries(parsed ?? {})) {
      try {
        selections[pageId] = parseNotionSelection(selection)
      } catch {
        // Una selección dañada vuelve al valor por defecto: todo.
      }
    }
    return selections
  }

  function emit(
    mesaId: MesaId,
    phase: NotionContextPhase,
    done: number,
    total: number,
    warnings: readonly string[],
    extra?: { message?: string; pages?: number; projects?: number },
  ): void {
    const progress: NotionContextProgress = {
      mesaId,
      phase,
      done,
      total,
      warnings: safeWarnings(warnings),
      message: extra?.message ?? null,
      pages: extra?.pages ?? 0,
      projects: extra?.projects ?? 0,
      at: now(),
    }
    progresses.set(mesaId, progress)
    options.onProgress(progress)
  }

  function guard(signal: AbortSignal, revision: number | null): () => void {
    return () => {
      if (signal.aborted || (revision !== null && options.revision() !== revision)) {
        throw new CancelledError()
      }
    }
  }

  /** Fichas de proyecto de la mesa (según la caché de T-003), sin repetir página. */
  async function projectCards(mesa: Mesa): Promise<{ pageId: string; url: string; snapshot: ProjectSnapshot }[]> {
    const found = new Map<string, { pageId: string; url: string; snapshot: ProjectSnapshot }>()
    for (const card of mesa.cards) {
      const pageId = card.serviceId === 'notion' ? notionPageIdFromUrl(card.url) : null
      if (!pageId || found.has(pageId)) {
        continue
      }
      const snapshot = await options.cachedProject(card.url)
      if (snapshot) {
        found.set(pageId, { pageId, url: card.url, snapshot })
      }
    }
    return [...found.values()]
  }

  /** Paso 1: la ficha de cada proyecto y las filas de sus bases (con su esquema, leído en cada lectura). */
  async function list(mesa: Mesa, check: () => void): Promise<Listing> {
    const warnings: string[] = []
    const bases: Record<string, SnapshotBase> = {}
    const schemas = new Map<string, DataSourceSchema>()
    const projects: SnapshotProject[] = []
    // Una ficha con muchas vistas enlazadas no puede disparar lecturas sin fin.
    const maxRefs = limits.maxBases * 3
    for (const card of await projectCards(mesa)) {
      const page = parsePageContent(await options.mcp.read('notion-fetch', { id: card.pageId }))
      check()
      const title = safeLabel(oneLine(card.snapshot.title), 'Proyecto sin título')
      const refs = findDatabaseRefs(page.content)
      const snapshotRefs: SnapshotRef[] = []
      const owned: string[] = []
      let overBases = 0
      for (const [index, ref] of refs.entries()) {
        if (index >= maxRefs) {
          snapshotRefs.push({ title: ref.title, sources: [] })
          continue
        }
        const kept: string[] = []
        for (const url of await resolveSources(ref, title, warnings, check)) {
          if (Object.hasOwn(bases, url)) {
            kept.push(url)
            continue
          }
          if (owned.length >= limits.maxBases) {
            overBases += 1
            continue
          }
          const listed = await listBase(url, ref, warnings, check)
          if (listed) {
            bases[url] = listed.base
            schemas.set(url, listed.schema)
            owned.push(url)
            kept.push(url)
          }
        }
        snapshotRefs.push({ title: ref.title, sources: kept })
      }
      if (overBases > 0 || refs.length > maxRefs) {
        warnings.push(`La ficha «${title}» tiene más de ${limits.maxBases} bases; Table lee las ${limits.maxBases} primeras.`)
      }
      const lines = contentToLines(page.content, (_ref, index) => `\u0000${index}\u0000`)
      const redacted = redactMoney(lines)
      const { body, truncated } = truncateBody(redacted.lines)
      projects.push({
        pageId: card.pageId,
        title,
        url: card.url,
        editedAt: page.editedAt,
        fetchedAt: now(),
        body,
        bodyOmitted: redacted.omitted,
        bodyTruncated: truncated,
        refs: snapshotRefs,
        bases: owned,
      })
    }
    return { snapshot: { projects, bases, warnings }, schemas }
  }

  async function resolveSources(ref: DatabaseRef, project: string, warnings: string[], check: () => void): Promise<readonly string[]> {
    if (ref.dataSourceUrl) {
      return [ref.dataSourceUrl]
    }
    try {
      const sources = ref.url ? parseLinkedDataSources(await options.mcp.read('notion-fetch', { id: ref.url })) : []
      check()
      if (sources.length === 0) {
        warnings.push(`Una vista enlazada de la ficha «${project}» no lleva a ninguna base legible.`)
      }
      return sources
    } catch (error) {
      if (isFatal(error)) {
        throw error
      }
      warnings.push(`No se pudo leer una vista enlazada de la ficha «${project}».`)
      return []
    }
  }

  /** Esquema y filas de una base. El esquema se lee siempre: decide qué propiedades salen. */
  async function listBase(
    url: string,
    ref: DatabaseRef,
    warnings: string[],
    check: () => void,
  ): Promise<{ base: SnapshotBase; schema: DataSourceSchema } | null> {
    try {
      const info = parseDataSource(await options.mcp.read('notion-fetch', { id: url }))
      check()
      const name = oneLine(info.name ?? '')
      // El nombre en la ficha y el propio de la base: cualquiera de los dos puede ser económico.
      const moneyName = hasMoney(ref.title) || hasMoney(name)
      const title = moneyName ? 'Base omitida' : ref.title || name || 'Base sin título'
      const key = schemaKey(info.schema)
      if (moneyName) {
        return { base: { dataSourceUrl: url, title, rows: [], truncated: false, moneyName, schemaKey: key }, schema: info.schema }
      }
      const page = parseRows(await options.mcp.read(TOOL_ROWS, { data: { mode: 'rows', data_source_url: url, limit: limits.rowsPerBase } }))
      check()
      const seen = new Set<string>()
      const rows: RowEntry[] = []
      for (const row of page.rows) {
        const entry = rowEntry(row, info.schema)
        if (entry && !seen.has(entry.pageId)) {
          seen.add(entry.pageId)
          rows.push(entry)
        }
      }
      if (page.hasMore) {
        warnings.push(`La base «${title}» tiene más de ${limits.rowsPerBase} filas; Table lee las ${limits.rowsPerBase} primeras.`)
      }
      return { base: { dataSourceUrl: url, title, rows, truncated: page.hasMore, moneyName, schemaKey: key }, schema: info.schema }
    } catch (error) {
      if (isFatal(error)) {
        throw error
      }
      warnings.push(`No se pudo leer la base «${safeLabel(ref.title, 'sin título')}».`)
      return null
    }
  }

  function truncateBody(lines: readonly string[]): { body: string[]; truncated: boolean } {
    let bytes = 0
    for (let index = 0; index < lines.length; index += 1) {
      bytes += Buffer.byteLength(lines[index]!) + 1
      if (bytes > limits.maxPageBytes) {
        return { body: lines.slice(0, index), truncated: true }
      }
    }
    return { body: [...lines], truncated: false }
  }

  async function readRow(row: RowEntry, base: SnapshotBase, schema: DataSourceSchema, check: () => void): Promise<PageRecord> {
    const page = parsePageContent(await options.mcp.read('notion-fetch', { id: row.pageId }))
    check()
    const properties = filterProperties(page.properties, schema)
    const lines: TextLine[] = contentToLines(
      page.content,
      ref => `[Base «${safeLabel(ref.title, 'sin título')}»: no incluida (Table lee la ficha y las páginas de sus bases, no bases más profundas)]`,
    )
    const redacted = redactMoney(lines)
    const { body, truncated } = truncateBody(redacted.lines)
    return {
      pageId: row.pageId,
      title: safeLabel(row.title || oneLine(page.title ?? ''), 'Sin título'),
      url: `https://www.notion.so/${row.pageId}`,
      editedAt: page.editedAt,
      rowEditedAt: row.editedAt,
      fetchedAt: now(),
      base: base.title,
      properties: properties.lines,
      body,
      omitted: redacted.omitted + properties.omitted,
      truncated,
      schemaKey: base.schemaKey,
    }
  }

  /** Página guardada que sigue valiendo para esa base (mismas reglas y esquema). */
  function usable(record: PageRecord | undefined, base: SnapshotBase): record is PageRecord {
    return !!record && record.schemaKey === base.schemaKey && record.base === base.title
  }

  /** Cuerpo de la ficha: cada marca de base se sustituye por una referencia al índice. */
  function bodyRecord(project: SnapshotProject, snapshot: Snapshot, included: ReadonlyMap<string, number>): PageRecord {
    const describe = (index: number): string => {
      const ref = project.refs[index]
      const label = safeLabel(ref?.title ?? '', 'sin título')
      if (!ref || ref.sources.length === 0) {
        return `[Base «${label}»: no incluida]`
      }
      return ref.sources
        .map(url => {
          const base = snapshot.bases[url]
          if (!base) {
            return `[Base «${label}»: no se pudo leer]`
          }
          if (base.moneyName) {
            return '[Base omitida: su nombre indica información económica]'
          }
          return `[Base «${base.title}»: ${plural(included.get(url) ?? 0, 'página', 'páginas')} en notion/index.md]`
        })
        .join(' ')
    }
    return {
      pageId: project.pageId,
      title: project.title,
      url: project.url,
      editedAt: project.editedAt,
      rowEditedAt: null,
      fetchedAt: project.fetchedAt,
      base: null,
      properties: [],
      body: project.body.map(line => cleanBlock(line.replace(BASE_TOKEN, (_token, index: string) => describe(Number(index))))),
      omitted: project.bodyOmitted,
      truncated: project.bodyTruncated,
      schemaKey: '',
    }
  }

  /** `notion/` tiene que ser una carpeta normal de la carpeta de la mesa (no un enlace simbólico). */
  async function notionDir(folder: string, create: boolean): Promise<string | null> {
    const dir = join(folder, NOTION_DIR)
    try {
      const stats = await lstat(dir)
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new Error('notion/ en la carpeta de la mesa no es una carpeta normal: Table no escribe en ella')
      }
      return dir
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
      if (!create) {
        return null
      }
      await mkdir(dir, { recursive: true })
      return dir
    }
  }

  /**
   * Publica en `notion/` lo elegido que ya está leído (sin red), guarda la
   * caché y reescribe `TABLE.md`. Comprueba la cancelación antes de cada escritura.
   */
  async function publish(
    mesaId: MesaId,
    mesa: Mesa,
    snapshot: Snapshot,
    pages: Readonly<Record<string, PageRecord>>,
    selections: Readonly<Record<string, NotionPageSelection>>,
    extraWarnings: readonly string[],
    check: () => void,
  ): Promise<void> {
    const plan = makePlan(snapshot, selections, limits.maxPages)
    const readAt = now()
    const files = new Map<string, string>()
    let bytes = 0
    let overSize = 0
    const add = (record: PageRecord): IndexPage | null => {
      let file = pageFileName(record.title, record.pageId)
      if (files.has(file)) {
        // Dos páginas con el mismo título y el mismo inicio de ID: el ID completo las distingue.
        file = file.replace(/[0-9a-f]{8}\.md$/, `${record.pageId}.md`)
      }
      const text = formatPageFile(record)
      const size = Buffer.byteLength(text)
      if (bytes + size > limits.maxBytes) {
        overSize += 1
        return null
      }
      bytes += size
      files.set(file, text)
      return { file, page: record }
    }
    let omittedLines = 0
    const indexProjects: IndexProject[] = plan.projects.map(({ project, body, bases }) => {
      const included = new Map(bases.map(base => [base.base.dataSourceUrl, base.chosen.filter(row => usable(pages[row.pageId], base.base)).length]))
      let bodyEntry: IndexPage | 'excluded' | null = body === 'excluded' ? 'excluded' : null
      if (body === 'included') {
        const record = bodyRecord(project, snapshot, included)
        bodyEntry = add(record)
        omittedLines += bodyEntry ? record.omitted : 0
      }
      const indexBases: IndexBase[] = bases
        .filter(base => !base.base.moneyName)
        .map(base => {
          const listed: IndexPage[] = []
          let tooBig = 0
          for (const row of base.chosen) {
            const record = pages[row.pageId]
            if (!usable(record, base.base)) {
              continue
            }
            const entry = add(record)
            if (entry) {
              listed.push(entry)
              omittedLines += entry.page.omitted
            } else {
              tooBig += 1
            }
          }
          return {
            title: base.base.title,
            total: base.base.rows.length,
            truncated: base.base.truncated,
            excludedByChoice: base.excluded,
            filteredPages: base.filtered + tooBig,
            pages: listed,
          }
        })
      return {
        title: project.title,
        url: project.url,
        body: bodyEntry,
        bases: indexBases,
        filteredBases: project.bases.filter(url => snapshot.bases[url]?.moneyName).length,
      }
    })
    const warnings = [...snapshot.warnings, ...plan.warnings, ...extraWarnings]
    if (overSize > 0) {
      const size = limits.maxBytes >= 1024 * 1024 ? `${Math.round(limits.maxBytes / 1024 / 1024)} MB` : `${Math.round(limits.maxBytes / 1024)} KB`
      warnings.push(`Se alcanzó el límite de ${size}: ${overSize === 1 ? '1 página no se incluyó' : `${overSize} páginas no se incluyeron`}.`)
    }
    const summary: NotionContentSummary = {
      readAt,
      projects: snapshot.projects.length,
      pages: files.size,
      excludedByChoice: plan.excludedByChoice,
      filteredPages: plan.filteredPages + overSize,
      omittedLines,
      warnings: safeWarnings(warnings),
    }
    const folder = await options.workFolder(mesa)
    check()
    const dir = await notionDir(folder, snapshot.projects.length > 0)
    if (dir) {
      for (const [name, text] of files) {
        check()
        await writeFileAtomic(join(dir, name), text)
      }
      check()
      await writeFileAtomic(join(dir, NOTION_INDEX), formatIndex({ generatedAt: readAt, projects: indexProjects, summary }))
      // Lo que ya no está en el árbol (o en la selección) se quita: la carpeta es de Table.
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.name.endsWith('.md') && entry.name !== NOTION_INDEX && !files.has(entry.name) && (entry.isFile() || entry.isSymbolicLink())) {
          check()
          await unlink(join(dir, entry.name)).catch(() => undefined)
        }
      }
    }
    // Se guardan las páginas leídas de todas las filas del árbol: volver a marcar una no exige leerla.
    const kept: Record<string, PageRecord> = {}
    for (const base of Object.values(snapshot.bases)) {
      for (const row of base.rows) {
        const record = pages[row.pageId]
        if (usable(record, base)) {
          kept[row.pageId] = record
        }
      }
    }
    check()
    await writeFileAtomic(cachePath(mesaId), JSON.stringify({ version: 2, pages: kept, snapshot, summary } satisfies CacheFile))
    check()
    await options.onWritten(mesaId)
    check()
    emit(mesaId, 'done', 0, 0, summary.warnings, { pages: files.size, projects: summary.projects })
    log('notion-content-written', { projects: summary.projects, pages: summary.pages, warnings: summary.warnings.length })
  }

  /** Lectura completa: árbol, filas elegidas que cambiaron y publicación. */
  async function runOnce(mesaId: MesaId, signal: AbortSignal): Promise<void> {
    const check = guard(signal, options.revision())
    check()
    const mesa = await options.getMesa(mesaId)
    check()
    const hasNotionCards = mesa.cards.some(card => card.serviceId === 'notion')
    if (hasNotionCards) {
      emit(mesaId, 'listing', 0, 0, [])
    }
    // Sin conexión no se toca nada; una mesa sin tarjetas de Notion no la necesita (y limpia lo que quedara).
    if (!options.connected() && hasNotionCards) {
      emit(mesaId, 'error', 0, 0, [], { message: 'Notion no está conectado: conecta en Ajustes para leer el contenido de las fichas' })
      return
    }
    const { snapshot, schemas } = await list(mesa, check)
    const selections = await readSelections(mesaId)
    const cache = await readCache(mesaId)
    check()
    const plan = makePlan(snapshot, selections, limits.maxPages)
    const toRead = plan.projects.flatMap(project => project.bases.flatMap(base => base.chosen.map(row => ({ row, base: base.base }))))
    const readWarnings: string[] = []
    let done = 0
    if (hasNotionCards) {
      emit(mesaId, 'reading', done, toRead.length, [...snapshot.warnings, ...plan.warnings])
    }
    const records = await mapLimit(toRead, limits.concurrency, async ({ row, base }): Promise<PageRecord | null> => {
      const cached = cache.pages[row.pageId]
      try {
        // Sin cambios (misma marca de edición, mismas reglas y esquema): sale de la caché.
        if (usable(cached, base) && row.editedAt && cached.rowEditedAt === row.editedAt) {
          return cached
        }
        check()
        return await readRow(row, base, schemas.get(base.dataSourceUrl) ?? {}, check)
      } catch (error) {
        if (isFatal(error)) {
          throw error
        }
        const label = safeLabel(row.title, 'sin título')
        if (usable(cached, base)) {
          readWarnings.push(`No se pudo actualizar «${label}»; se usa la copia del ${cached.fetchedAt.slice(0, 10)}.`)
          return cached
        }
        readWarnings.push(`No se pudo leer «${label}» de la base «${base.title}».`)
        return null
      } finally {
        done += 1
        if (!signal.aborted) {
          emit(mesaId, 'reading', done, toRead.length, [...snapshot.warnings, ...plan.warnings, ...readWarnings])
        }
      }
    })
    check()
    const pages: Record<string, PageRecord> = { ...cache.pages }
    for (const [index, { row }] of toRead.entries()) {
      const record = records[index]
      if (record) {
        pages[row.pageId] = record
      } else {
        delete pages[row.pageId]
      }
    }
    if (hasNotionCards) {
      emit(mesaId, 'writing', toRead.length, toRead.length, [...snapshot.warnings, ...plan.warnings, ...readWarnings])
    }
    await publish(mesaId, mesa, snapshot, pages, selections, readWarnings, check)
  }

  async function runSafely(mesaId: MesaId, signal: AbortSignal): Promise<void> {
    try {
      await runOnce(mesaId, signal)
    } catch (error) {
      if (error instanceof CancelledError || signal.aborted) {
        log('notion-content-cancelled', {})
        return
      }
      const code = error instanceof NotionError ? error.code : error instanceof UnrecognizedResponseError ? 'unrecognized' : 'unexpected'
      log('notion-content-failed', { code })
      const message =
        error instanceof NotionError || error instanceof UnrecognizedResponseError
          ? error.message
          : error instanceof Error && error.message.startsWith('notion/')
            ? error.message
            : 'No se pudo leer el contenido de Notion'
      emit(mesaId, 'error', 0, 0, [], { message })
    }
  }

  /** Aplica la selección guardada con lo ya leído, sin red. */
  async function publishLocal(mesaId: MesaId, signal: AbortSignal): Promise<void> {
    const check = guard(signal, null)
    const cache = await readCache(mesaId)
    if (!cache.snapshot) {
      return
    }
    const mesa = await options.getMesa(mesaId)
    const selections = await readSelections(mesaId)
    check()
    await publish(mesaId, mesa, cache.snapshot, cache.pages, selections, [], check)
  }

  const service: NotionContent = {
    request(mesaId) {
      const running = loops.get(mesaId)
      if (running) {
        running.again = true
        return running.done
      }
      const loop = { again: false, current: null as AbortController | null, done: Promise.resolve() }
      loops.set(mesaId, loop)
      loop.done = (async () => {
        try {
          do {
            loop.again = false
            const controller = new AbortController()
            loop.current = controller
            await serial(mesaId, controller, signal => runSafely(mesaId, signal))
          } while (loop.again)
        } finally {
          loop.current = null
          if (loops.get(mesaId) === loop) {
            loops.delete(mesaId)
          }
        }
      })()
      return loop.done
    },

    async tree(mesaId) {
      if (!options.connected()) {
        throw new NotionError('Conecta Notion en Ajustes para elegir páginas', 'unauthorized')
      }
      const check = guard(new AbortController().signal, options.revision())
      const { snapshot } = await list(await options.getMesa(mesaId), check)
      const selections = await readSelections(mesaId)
      const fichaIds = new Set(snapshot.projects.map(project => project.pageId))
      let hidden = 0
      const projects = snapshot.projects.map(project => ({
        pageId: project.pageId,
        title: project.title,
        url: project.url,
        selection: selections[project.pageId] ?? DEFAULT_NOTION_SELECTION,
        bases: project.bases.flatMap(url => {
          const base = snapshot.bases[url]
          if (!base || base.moneyName) {
            hidden += base ? 1 : 0
            return []
          }
          const pages = base.rows.filter(row => {
            const money = hasMoney(row.title)
            hidden += money ? 1 : 0
            return !money && !fichaIds.has(row.pageId)
          })
          return [{ dataSourceUrl: base.dataSourceUrl, title: base.title, truncated: base.truncated, pages }]
        }),
      }))
      const warnings = safeWarnings(snapshot.warnings)
      if (hidden > 0) {
        warnings.push(`${hidden === 1 ? '1 página o base no aparece' : `${hidden} páginas o bases no aparecen`}: su nombre indica información económica y Table no la lee.`)
      }
      return { projects, warnings }
    },

    async setSelection(mesaId, selections) {
      const stored = await readSelections(mesaId)
      await writeFileAtomic(selectionPath(mesaId), JSON.stringify({ ...stored, ...selections }))
      // La lectura en curso se hizo con la selección anterior: se cancela y se repite.
      const loop = loops.get(mesaId)
      if (loop) {
        loop.again = true
        loop.current?.abort()
      }
      await serial(mesaId, new AbortController(), signal => publishLocal(mesaId, signal)).catch((error: unknown) => {
        if (!(error instanceof CancelledError)) {
          log('notion-content-local-failed', { message: error instanceof Error ? error.message : String(error) })
        }
      })
      void service.request(mesaId)
    },

    async summary(mesaId) {
      return (await readCache(mesaId)).summary
    },

    progress(mesaId) {
      return progresses.get(mesaId) ?? null
    },

    async forget(mesaId) {
      await stopMesa(mesaId)
      progresses.delete(mesaId)
      await rm(cachePath(mesaId), { force: true })
      await rm(selectionPath(mesaId), { force: true })
    },

    async clearCache() {
      const mesas = new Set([...loops.keys(), ...chains.keys(), ...controllers.keys()])
      await Promise.all([...mesas].map(stopMesa))
      progresses.clear()
      await rm(cacheDir, { recursive: true, force: true })
    },
  }
  return service
}
