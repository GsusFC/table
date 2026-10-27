import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { MAX_TOOL_ITEMS, type AgentToolName } from '../../shared/agentTools'
import {
  DEFAULT_CARD_SIZE,
  DEFAULT_NOTE_SIZE,
  DEFAULT_RESULT_SIZE,
  edgeKey,
  type Edge,
  type ItemId,
  type Mesa,
  type MesaId,
  type Point,
  type Size,
} from '../../shared/model'
import type { ProjectSnapshot } from '../../shared/notion'
import { recognizeService, serviceById } from '../../shared/services'
import { parseCardPatch, parseHttpUrl, parseId, parseNoteText, parsePoint, parseResultFile } from '../../shared/validate'
import type { MesaStore } from '../store/types'
import { itemLabels, projectFields, RESULTS_DIR } from './context'
import { NOTION_DIR } from './notionFiles'
import { fileKey, isImportableName, placeNewResults, resultEntry, resultKindOf, resultsDirIn } from './results'

/**
 * Ejecución de las herramientas de la mesa (T-011) contra el almacén: las
 * mismas validaciones que la interfaz (URLs http(s), texto de notas, tamaños,
 * IDs de la mesa) y solo sobre la mesa de la sesión. Funcionan aunque la mesa
 * no esté abierta; las que dependen de la interfaz lo dicen.
 */

/** Sesión que llama: su mesa y el nombre del arnés (para la confirmación). */
export interface TableToolContext {
  readonly mesaId: MesaId
  readonly agentName: string
  /**
   * Se cancela si la sesión termina, el puente se desconecta o el agente
   * cancela la petición: una confirmación pendiente se retira y no se borra nada.
   */
  readonly signal: AbortSignal
}

/** Lo que Table pregunta a la persona antes de borrar. */
export interface RemovalRequest {
  readonly mesaId: MesaId
  readonly agentName: string
  readonly title: string
  /** Una línea por elemento o conexión. */
  readonly items: readonly string[]
}

/** Estado de la interfaz que conoce el proceso principal (lo informa el renderer). */
export interface TableUiState {
  /** Si la mesa está abierta en la ventana. */
  isOpen(mesaId: MesaId): boolean
  /** Selección actual (vacía si la mesa no está abierta). */
  selection(mesaId: MesaId): readonly ItemId[]
  /** Nota que la persona está editando, o null. */
  editingNote(mesaId: MesaId): string | null
  /** Selecciona y centra elementos en la vista. */
  show(mesaId: MesaId, ids: readonly ItemId[]): void
}

export interface TableToolDeps {
  readonly store: MesaStore
  /** Carpeta de trabajo de la mesa (comprobada). */
  workFolder(mesaId: MesaId): Promise<string>
  /** Ficha guardada (caché, sin red) de una URL de Notion. */
  cachedProject(url: string): Promise<ProjectSnapshot | null>
  /** Descarga la web de una tarjeta antes de borrarla; `kept` si avisó de cambios sin guardar. */
  unloadCard(cardId: string): Promise<'unloaded' | 'kept'>
  readonly ui: TableUiState
  /** Pregunta a la persona; true si acepta. Con `signal` cancelada, retira la pregunta y devuelve false. */
  confirm(request: RemovalRequest, signal: AbortSignal): Promise<boolean>
  /** Tras cada escritura: la interfaz vuelve a leer la mesa y muestra el aviso. */
  changed(mesaId: MesaId, notice: string): void
}

export type TableToolHandler = (context: TableToolContext, input: Readonly<Record<string, unknown>>) => Promise<unknown>

const NEAR_GAP = 40
const STACK_GAP = 24
const COLUMN_GAP = 80
/** Elementos de la confirmación; el resto se resume. */
const CONFIRM_LINES = 20
const COORDINATES =
  'Coordenadas del lienzo en px: `position` es la esquina superior izquierda; x crece hacia la derecha e y hacia abajo. `size` es ancho y alto.'

type ItemKind = 'card' | 'note' | 'result'

interface Placed {
  readonly id: ItemId
  readonly kind: ItemKind
  readonly position: Point
  readonly size: Size
}

function placedItems(mesa: Mesa): Map<ItemId, Placed> {
  const items = new Map<ItemId, Placed>()
  for (const card of mesa.cards) {
    items.set(card.id, { id: card.id, kind: 'card', position: card.position, size: card.size })
  }
  for (const note of mesa.notes) {
    items.set(note.id, { id: note.id, kind: 'note', position: note.position, size: note.size })
  }
  for (const result of mesa.results) {
    items.set(result.id, { id: result.id, kind: 'result', position: result.position, size: result.size })
  }
  return items
}

/** Entrada sin campos desconocidos (los esquemas declaran `additionalProperties: false`). */
function checkKeys(input: Readonly<Record<string, unknown>>, allowed: readonly string[]): void {
  const unknown = Object.keys(input).filter(key => !allowed.includes(key))
  if (unknown.length > 0) {
    throw new Error(`Campo no admitido: ${unknown.join(', ')}`)
  }
}

function idList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TOOL_ITEMS) {
    throw new Error(`${label}: una lista de 1 a ${MAX_TOOL_ITEMS} IDs`)
  }
  return [...new Set(value.map(parseId))]
}

function requireItem(items: ReadonlyMap<ItemId, Placed>, id: unknown): Placed {
  const parsed = parseId(id)
  const item = items.get(parsed)
  if (!item) {
    throw new Error(`El elemento ${parsed} no está en la mesa de esta sesión`)
  }
  return item
}

function overlaps(position: Point, size: Size, other: Placed): boolean {
  return (
    position.x < other.position.x + other.size.width &&
    other.position.x < position.x + size.width &&
    position.y < other.position.y + other.size.height &&
    other.position.y < position.y + size.height
  )
}

/**
 * Posición calculada por Table (`near` o a la derecha de todo), redondeada y
 * con los mismos límites que una posición dada: fuera del lienzo la mesa
 * dejaría de ser legible. No se recorta al borde (taparía otro elemento sin
 * avisar): se pide una posición explícita.
 */
function computed(point: Point): Point {
  const rounded = { x: Math.round(point.x), y: Math.round(point.y) }
  try {
    return parsePoint(rounded)
  } catch {
    throw new Error('La posición calculada queda fuera del lienzo: indica una `position` explícita.')
  }
}

/** A la derecha de `anchor`; si tapa otro elemento, baja hasta quedar libre. */
function placeNear(items: ReadonlyMap<ItemId, Placed>, anchor: Placed, size: Size): Point {
  let candidate: Point = { x: anchor.position.x + anchor.size.width + NEAR_GAP, y: anchor.position.y }
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const hit = [...items.values()].find(item => overlaps(candidate, size, item))
    if (!hit) {
      break
    }
    candidate = { x: candidate.x, y: hit.position.y + hit.size.height + STACK_GAP }
  }
  return computed(candidate)
}

/** `position` explícita, junto a `near` o, sin ninguna, a la derecha de todo. */
function placement(mesa: Mesa, input: Readonly<Record<string, unknown>>, size: Size): Point {
  if (input['position'] !== undefined) {
    return parsePoint(input['position'])
  }
  const items = placedItems(mesa)
  if (input['near'] !== undefined) {
    return placeNear(items, requireItem(items, input['near']), size)
  }
  const all = [...items.values()]
  if (all.length === 0) {
    return { x: 0, y: 0 }
  }
  return computed({
    x: Math.max(...all.map(item => item.position.x + item.size.width)) + COLUMN_GAP,
    y: Math.min(...all.map(item => item.position.y)),
  })
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`
}

/** Resumen de una mesa para el agente. */
function describeMesa(mesa: Mesa, workFolder: string): unknown {
  const sources = new Map<ItemId, ItemId[]>()
  for (const edge of mesa.edges) {
    sources.set(edge.source, [...(sources.get(edge.source) ?? []), edge.target])
    sources.set(edge.target, [...(sources.get(edge.target) ?? []), edge.source])
  }
  return {
    id: mesa.id,
    name: mesa.name,
    workFolder,
    coordinates: COORDINATES,
    cards: mesa.cards.map(card => ({
      id: card.id,
      service: serviceById(card.serviceId).name,
      title: card.title,
      url: card.url,
      position: card.position,
      size: card.size,
    })),
    notes: mesa.notes.map(note => ({ id: note.id, text: note.text, position: note.position, size: note.size })),
    results: mesa.results.map(result => ({
      id: result.id,
      file: `${RESULTS_DIR}/${result.file}`,
      kind: result.kind,
      sources: sources.get(result.id) ?? [],
      position: result.position,
      size: result.size,
    })),
    edges: mesa.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target })),
  }
}

const NO_DETAILS = { projects: new Map(), frames: new Map() } as const

function summarize(lines: readonly string[]): string[] {
  return lines.length <= CONFIRM_LINES ? [...lines] : [...lines.slice(0, CONFIRM_LINES), `y ${lines.length - CONFIRM_LINES} más`]
}

/** Por qué no se borró nada: la persona no aceptó, o la petición se canceló (sesión cerrada, agente que dejó de esperar). */
function rejectedMessage(signal: AbortSignal): string {
  return signal.aborted
    ? 'La petición se canceló (la sesión terminó o el agente dejó de esperar): no se ha borrado nada.'
    : 'La persona no aceptó el borrado: no se ha borrado nada.'
}

export function createTableToolHandlers(deps: TableToolDeps): Readonly<Record<AgentToolName, TableToolHandler>> {
  const { store } = deps

  async function connectOnce(mesaId: MesaId, edges: readonly Edge[], source: ItemId, target: ItemId): Promise<Edge> {
    const existing = edges.find(edge => edgeKey(edge.source, edge.target) === edgeKey(source, target))
    return existing ?? store.addEdge(mesaId, source, target)
  }

  return {
    async table_get_mesa({ mesaId }, input) {
      checkKeys(input, [])
      return describeMesa(await store.get(mesaId), await deps.workFolder(mesaId))
    },

    async table_get_selection({ mesaId }, input) {
      checkKeys(input, [])
      if (!deps.ui.isOpen(mesaId)) {
        return { open: false, items: [], message: 'La mesa no está abierta en Table: no hay selección.' }
      }
      const mesa = await store.get(mesaId)
      const items = placedItems(mesa)
      const labels = itemLabels(mesa, NO_DETAILS)
      return {
        open: true,
        items: deps.ui
          .selection(mesaId)
          .filter(id => items.has(id))
          .map(id => ({ id, kind: items.get(id)!.kind, label: labels.get(id) })),
      }
    },

    async table_get_project({ mesaId }, input) {
      checkKeys(input, [])
      const mesa = await store.get(mesaId)
      const projects = []
      for (const card of mesa.cards.filter(candidate => candidate.serviceId === 'notion')) {
        const snapshot = await deps.cachedProject(card.url)
        if (snapshot) {
          projects.push({
            cardId: card.id,
            url: card.url,
            title: snapshot.title,
            fields: Object.fromEntries(projectFields(snapshot).map(field => [field.label, field.value])),
            readAt: snapshot.fetchedAt,
            editedAt: snapshot.editedAt,
          })
        }
      }
      const notionDir = join(await deps.workFolder(mesaId), NOTION_DIR)
      const info = await lstat(notionDir).catch(() => null)
      // Igual que al escribirla: una `notion/` que no es una carpeta normal no se lee.
      const files =
        info?.isDirectory() && !info.isSymbolicLink()
          ? (await readdir(notionDir, { withFileTypes: true }))
              .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
              .map(entry => `${NOTION_DIR}/${entry.name}`)
              .sort()
          : []
      return { projects, notionFiles: files }
    },

    async table_add_card({ mesaId }, input) {
      checkKeys(input, ['url', 'position', 'near'])
      const url = parseHttpUrl(input['url'])
      const position = placement(await store.get(mesaId), input, DEFAULT_CARD_SIZE)
      const card = await store.addCard(mesaId, { url, serviceId: recognizeService(url).id, position })
      deps.changed(mesaId, 'El agente añadió una tarjeta')
      return { id: card.id, service: serviceById(card.serviceId).name, url: card.url, position: card.position, size: card.size }
    },

    async table_add_note({ mesaId }, input) {
      checkKeys(input, ['text', 'position', 'near'])
      const text = parseNoteText(input['text'])
      const position = placement(await store.get(mesaId), input, DEFAULT_NOTE_SIZE)
      const note = await store.addNote(mesaId, position, text)
      deps.changed(mesaId, 'El agente añadió una nota')
      return { id: note.id, position: note.position, size: note.size }
    },

    async table_update_note({ mesaId }, input) {
      checkKeys(input, ['noteId', 'text'])
      const noteId = parseId(input['noteId'])
      const text = parseNoteText(input['text'])
      const mesa = await store.get(mesaId)
      if (!mesa.notes.some(note => note.id === noteId)) {
        throw new Error(`La nota ${noteId} no está en la mesa de esta sesión`)
      }
      if (deps.ui.editingNote(mesaId) === noteId) {
        throw new Error('La persona está editando esta nota ahora; inténtalo cuando termine.')
      }
      const note = await store.updateNote(mesaId, noteId, { text })
      deps.changed(mesaId, 'El agente cambió una nota')
      return { id: note.id, text: note.text }
    },

    async table_move_items({ mesaId }, input) {
      checkKeys(input, ['items'])
      const raw = input['items']
      if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_TOOL_ITEMS) {
        throw new Error(`items: una lista de 1 a ${MAX_TOOL_ITEMS} elementos`)
      }
      const items = placedItems(await store.get(mesaId))
      // Todo se valida antes de mover nada.
      const moves = raw.map((entry: unknown) => {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
          throw new Error('Cada elemento de items es un objeto con id, position y/o size')
        }
        const { id, ...patch } = entry as Record<string, unknown>
        const parsed = parseCardPatch(patch)
        if (parsed.position === undefined && parsed.size === undefined) {
          throw new Error('Cada elemento de items necesita position o size')
        }
        return { item: requireItem(items, id), patch: parsed }
      })
      const moved = []
      for (const { item, patch } of moves) {
        const updated =
          item.kind === 'card'
            ? await store.updateCard(mesaId, item.id, patch)
            : item.kind === 'note'
              ? await store.updateNote(mesaId, item.id, patch)
              : await store.updateResult(mesaId, item.id, patch)
        moved.push({ id: updated.id, position: updated.position, size: updated.size })
      }
      deps.changed(mesaId, moved.length === 1 ? 'El agente movió un elemento' : `El agente movió ${moved.length} elementos`)
      return { moved }
    },

    async table_connect({ mesaId }, input) {
      checkKeys(input, ['source', 'target'])
      const mesa = await store.get(mesaId)
      const items = placedItems(mesa)
      const source = requireItem(items, input['source'])
      const target = requireItem(items, input['target'])
      const edge = await store.addEdge(mesaId, source.id, target.id)
      deps.changed(mesaId, 'El agente conectó dos elementos')
      return { id: edge.id, source: edge.source, target: edge.target }
    },

    async table_add_result({ mesaId }, input) {
      checkKeys(input, ['file', 'sources', 'position'])
      const file = parseResultFile(input['file'])
      if (!isImportableName(file)) {
        throw new Error(`«${file}» parece un archivo temporal u oculto; escribe el archivo con su nombre final`)
      }
      let mesa = await store.get(mesaId)
      const items = placedItems(mesa)
      const sources = input['sources'] === undefined ? [] : idList(input['sources'], 'sources').map(id => requireItem(items, id))
      const position = input['position'] === undefined ? undefined : parsePoint(input['position'])
      // Las mismas reglas que la vigilancia de `resultados/`: archivo normal directamente en la carpeta.
      const dir = await resultsDirIn(await deps.workFolder(mesaId))
      if (!(await resultEntry(dir, file))) {
        throw new Error(`No hay un archivo normal «${file}» directamente en ${RESULTS_DIR}/`)
      }
      const key = fileKey(file)
      let result = mesa.results.find(existing => fileKey(existing.file) === key)
      const imported = !result
      if (!result) {
        const at =
          position ?? (sources[0] ? placeNear(items, sources[0], DEFAULT_RESULT_SIZE) : placeNewResults(mesa, 1)[0]!)
        // Si la persona lo había quitado de la mesa, el agente lo vuelve a registrar a propósito.
        const undismiss = mesa.dismissedResults.filter(dismissed => fileKey(dismissed) === key)
        await store.reconcileResults(mesaId, { add: [{ file, kind: resultKindOf(file), position: at }], touch: [], undismiss })
        mesa = await store.get(mesaId)
        result = mesa.results.find(existing => fileKey(existing.file) === key)
        if (!result) {
          throw new Error(`No se pudo registrar «${file}»`)
        }
      }
      const edges = []
      for (const source of sources) {
        edges.push(await connectOnce(mesaId, mesa.edges, source.id, result.id))
      }
      deps.changed(mesaId, imported ? 'El agente añadió un resultado' : 'El agente conectó un resultado con sus fuentes')
      return {
        id: result.id,
        file: `${RESULTS_DIR}/${result.file}`,
        kind: result.kind,
        imported,
        edges: edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target })),
      }
    },

    async table_show_items({ mesaId }, input) {
      checkKeys(input, ['ids'])
      const items = placedItems(await store.get(mesaId))
      const ids = idList(input['ids'], 'ids').map(id => requireItem(items, id).id)
      if (!deps.ui.isOpen(mesaId)) {
        return { shown: false, message: 'La mesa no está abierta en Table: no se puede mostrar nada.' }
      }
      deps.ui.show(mesaId, ids)
      return { shown: true, ids }
    },

    async table_remove_items({ mesaId, agentName, signal }, input) {
      checkKeys(input, ['ids'])
      const mesa = await store.get(mesaId)
      const items = placedItems(mesa)
      const targets = idList(input['ids'], 'ids').map(id => requireItem(items, id))
      const labels = itemLabels(mesa, NO_DETAILS)
      const accepted = await deps.confirm(
        {
          mesaId,
          agentName,
          title: `${agentName} quiere borrar ${plural(targets.length, 'elemento', 'elementos')} de la mesa`,
          items: summarize(targets.map(item => labels.get(item.id) ?? item.id)),
        },
        signal,
      )
      if (!accepted || signal.aborted) {
        return { removed: [], rejected: true, message: rejectedMessage(signal) }
      }
      const removed: ItemId[] = []
      const kept: ItemId[] = []
      for (const item of targets) {
        // Si la sesión termina a mitad, no se sigue borrando.
        if (signal.aborted) {
          break
        }
        if (item.kind === 'card') {
          if ((await deps.unloadCard(item.id)) === 'kept') {
            kept.push(item.id)
            continue
          }
          await store.removeCard(mesaId, item.id)
        } else if (item.kind === 'note') {
          await store.removeNote(mesaId, item.id)
        } else {
          // El archivo se queda en `resultados/` y no vuelve a importarse.
          await store.removeResult(mesaId, item.id)
        }
        removed.push(item.id)
      }
      if (removed.length > 0) {
        deps.changed(mesaId, removed.length === 1 ? 'El agente borró un elemento' : `El agente borró ${removed.length} elementos`)
      }
      return {
        removed,
        rejected: false,
        ...(kept.length > 0 ? { kept, message: 'Algunas tarjetas no se borraron: su web avisó de cambios sin guardar.' } : {}),
      }
    },

    async table_disconnect({ mesaId, agentName, signal }, input) {
      checkKeys(input, ['edgeIds'])
      const mesa = await store.get(mesaId)
      const labels = itemLabels(mesa, NO_DETAILS)
      const edges = idList(input['edgeIds'], 'edgeIds').map(id => {
        const edge = mesa.edges.find(candidate => candidate.id === id)
        if (!edge) {
          throw new Error(`La conexión ${id} no está en la mesa de esta sesión`)
        }
        return edge
      })
      const accepted = await deps.confirm(
        {
          mesaId,
          agentName,
          title: `${agentName} quiere borrar ${plural(edges.length, 'conexión', 'conexiones')} de la mesa`,
          items: summarize(edges.map(edge => `${labels.get(edge.source) ?? edge.source} ↔ ${labels.get(edge.target) ?? edge.target}`)),
        },
        signal,
      )
      if (!accepted || signal.aborted) {
        return { removed: [], rejected: true, message: rejectedMessage(signal) }
      }
      const removed: string[] = []
      for (const edge of edges) {
        if (signal.aborted) {
          break
        }
        await store.removeEdge(mesaId, edge.id)
        removed.push(edge.id)
      }
      if (removed.length > 0) {
        deps.changed(mesaId, removed.length === 1 ? 'El agente borró una conexión' : `El agente borró ${removed.length} conexiones`)
      }
      return { removed, rejected: false }
    },
  }
}
