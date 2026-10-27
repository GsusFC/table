import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, unlinkSync } from 'node:fs'
import { readdir, readFile, rm, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DEFAULT_AGENT_NOTION,
  DEFAULT_CARD_SIZE,
  DEFAULT_NOTE_SIZE,
  DEFAULT_RESULT_SIZE,
  DEFAULT_VIEWPORT,
  edgeKey,
  SCHEMA_VERSION,
  type Card,
  type CardId,
  type CardPatch,
  type Edge,
  type EdgeId,
  type AgentNotionMode,
  type Mesa,
  type MesaId,
  type MesaListing,
  type MesaSummary,
  type Note,
  type NoteId,
  type NotePatch,
  type ItemId,
  type Point,
  type Result,
  type ResultId,
  type ResultPatch,
  type Viewport,
} from '../../shared/model'
import {
  parseAgentNotionMode,
  parseHttpUrl,
  parseId,
  parseMesaName,
  parseNoteText,
  parsePoint,
  parseResultFile,
  parseResultKind,
  parseSize,
  parseViewport,
} from '../../shared/validate'
import { writeFileAtomic } from '../files'
import { log } from '../log'
import type { MesaStore } from './types'

const MESA_EXTENSION = '.json'

function now(): string {
  return new Date().toISOString()
}

function isErrnoCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === code
}

const INVALID = 'El archivo de la mesa no es válido'

/** Lanza si `value` no es una fecha ISO en texto. */
function checkDate(value: unknown): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(INVALID)
  }
  return value
}

/** Igualdad estructural sin depender del orden de las claves. */
function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
    return Object.is(a, b)
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false
  }
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  return (
    aKeys.length === bKeys.length &&
    aKeys.every(
      key => Object.hasOwn(b, key) && sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
  )
}

/**
 * Exige que el validador acepte el valor sin modificarlo (mismas claves y
 * valores, en cualquier orden); su error se unifica.
 */
function checkSame<T>(value: unknown, parse: (v: unknown) => T): T {
  let parsed: T
  try {
    parsed = parse(value)
  } catch (error) {
    throw new Error(INVALID, { cause: error })
  }
  if (!sameValue(parsed, value)) {
    throw new Error(INVALID)
  }
  return parsed
}

function checkCard(value: unknown): Card {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(INVALID)
  }
  const c = value as { readonly [K in keyof Card]?: unknown }
  if (typeof c.serviceId !== 'string' || c.serviceId.length === 0) {
    throw new Error(INVALID)
  }
  if (c.title !== null && typeof c.title !== 'string') {
    throw new Error(INVALID)
  }
  if (c.capturedAt !== null) {
    checkDate(c.capturedAt)
  }
  return {
    id: checkSame(c.id, parseId),
    url: checkSame(c.url, parseHttpUrl),
    serviceId: c.serviceId,
    title: c.title as string | null,
    position: checkSame(c.position, parsePoint),
    size: checkSame(c.size, parseSize),
    capturedAt: c.capturedAt as string | null,
    createdAt: checkDate(c.createdAt),
    updatedAt: checkDate(c.updatedAt),
  }
}

function checkNote(value: unknown): Note {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(INVALID)
  }
  const n = value as { readonly [K in keyof Note]?: unknown }
  return {
    id: checkSame(n.id, parseId),
    text: checkSame(n.text, parseNoteText),
    position: checkSame(n.position, parsePoint),
    size: checkSame(n.size, parseSize),
    createdAt: checkDate(n.createdAt),
    updatedAt: checkDate(n.updatedAt),
  }
}

function checkEdge(value: unknown): Edge {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(INVALID)
  }
  const e = value as { readonly [K in keyof Edge]?: unknown }
  return {
    id: checkSame(e.id, parseId),
    source: checkSame(e.source, parseId),
    target: checkSame(e.target, parseId),
    createdAt: checkDate(e.createdAt),
  }
}

function checkResult(value: unknown): Result {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(INVALID)
  }
  const r = value as { readonly [K in keyof Result]?: unknown }
  return {
    id: checkSame(r.id, parseId),
    file: checkSame(r.file, parseResultFile),
    kind: checkSame(r.kind, parseResultKind),
    position: checkSame(r.position, parsePoint),
    size: checkSame(r.size, parseSize),
    createdAt: checkDate(r.createdAt),
    updatedAt: checkDate(r.updatedAt),
  }
}

/** Clave de un nombre de archivo de resultado, sin distinguir mayúsculas como el disco de macOS. */
function resultFileKey(file: string): string {
  return file.normalize('NFC').toLowerCase()
}

/** Versiones anteriores admitidas: se leen migradas a la actual. */
const V1_CARDS_ONLY = 1
const V2_WITHOUT_RESULTS = 2

/**
 * Validación completa de un archivo de mesa: versión, IDs (únicos en toda la
 * mesa), nombre, fechas, viewport, cada tarjeta, nota y resultado (un archivo
 * por resultado), y conexiones entre elementos que existen, sin
 * autoconexiones ni duplicados (en cualquier sentido). La versión 1 se migra
 * en memoria sin notas, conexiones ni resultados; la 2, sin resultados.
 * Cualquier fallo lanza; el archivo no se toca.
 */
function checkMesa(value: unknown, id: MesaId): Mesa {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(INVALID)
  }
  const fields = value as { readonly [K in keyof Mesa]?: unknown }
  const version = fields.schemaVersion
  if (version !== SCHEMA_VERSION && version !== V2_WITHOUT_RESULTS && version !== V1_CARDS_ONLY) {
    throw new Error(`La mesa usa una versión de esquema no admitida (${String(version)}; se espera ${SCHEMA_VERSION})`)
  }
  if (fields.id !== id || !Array.isArray(fields.cards)) {
    throw new Error(INVALID)
  }
  let rawNotes: readonly unknown[] = []
  let rawEdges: readonly unknown[] = []
  let rawResults: readonly unknown[] = []
  let rawDismissed: readonly unknown[] = []
  // `agentNotion` (T-010) solo puede venir en la versión actual.
  if (version !== SCHEMA_VERSION && fields.agentNotion !== undefined) {
    throw new Error(INVALID)
  }
  if (version === V1_CARDS_ONLY) {
    if (fields.notes !== undefined || fields.edges !== undefined || fields.results !== undefined || fields.dismissedResults !== undefined) {
      throw new Error(INVALID)
    }
  } else {
    if (!Array.isArray(fields.notes) || !Array.isArray(fields.edges)) {
      throw new Error(INVALID)
    }
    rawNotes = fields.notes
    rawEdges = fields.edges
    if (version === SCHEMA_VERSION) {
      if (!Array.isArray(fields.results) || !Array.isArray(fields.dismissedResults)) {
        throw new Error(INVALID)
      }
      rawResults = fields.results
      rawDismissed = fields.dismissedResults
    } else if (fields.results !== undefined || fields.dismissedResults !== undefined) {
      throw new Error(INVALID)
    }
  }
  const mesaId = checkSame(fields.id, parseId)
  const cards = fields.cards.map(checkCard)
  const notes = rawNotes.map(checkNote)
  const results = rawResults.map(checkResult)
  const dismissedResults = rawDismissed.map(file => checkSame(file, parseResultFile))
  const edges = rawEdges.map(checkEdge)
  const ids = new Set<string>([mesaId])
  const addUnique = (itemId: string): void => {
    if (ids.has(itemId)) {
      throw new Error(INVALID)
    }
    ids.add(itemId)
  }
  const elements = new Set<string>()
  for (const item of [...cards, ...notes, ...results]) {
    addUnique(item.id)
    elements.add(item.id)
  }
  // Un archivo, una tarjeta; un archivo descartado no tiene tarjeta.
  const files = new Set<string>()
  for (const file of [...results.map(result => result.file), ...dismissedResults]) {
    const key = resultFileKey(file)
    if (files.has(key)) {
      throw new Error(INVALID)
    }
    files.add(key)
  }
  const pairs = new Set<string>()
  for (const edge of edges) {
    addUnique(edge.id)
    const key = edgeKey(edge.source, edge.target)
    if (edge.source === edge.target || !elements.has(edge.source) || !elements.has(edge.target) || pairs.has(key)) {
      throw new Error(INVALID)
    }
    pairs.add(key)
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    id: mesaId,
    name: checkSame(fields.name, parseMesaName),
    createdAt: checkDate(fields.createdAt),
    updatedAt: checkDate(fields.updatedAt),
    viewport: checkSame(fields.viewport, parseViewport),
    cards,
    notes,
    edges,
    results,
    dismissedResults,
    agentNotion: fields.agentNotion === undefined ? DEFAULT_AGENT_NOTION : checkSame(fields.agentNotion, parseAgentNotionMode),
  }
}

/**
 * Un cierre forzado durante una escritura deja su temporal (`.<uuid>.tmp`) sin
 * renombrar; el archivo de la mesa sigue intacto. Se borran al arrancar, antes
 * de cualquier escritura, para que no se acumulen.
 */
function removeLeftoverTemps(dir: string): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (/^\..+\.tmp$/.test(entry)) {
      try {
        unlinkSync(join(dir, entry))
      } catch {
        // Si no se puede borrar ahora, se intentará en el próximo arranque.
      }
    }
  }
}

export function createMesaStore(baseDir: string): MesaStore {
  const mesasDir = join(baseDir, 'mesas')
  const capturesDir = join(baseDir, 'captures')
  removeLeftoverTemps(mesasDir)
  /** Cola de escrituras por mesa: cada operación espera a la anterior. */
  const queues = new Map<MesaId, Promise<unknown>>()

  const mesaPath = (id: MesaId): string => join(mesasDir, `${id}${MESA_EXTENSION}`)
  const mesaCapturesDir = (id: MesaId): string => join(capturesDir, id)
  const cardCapturePath = (mesaId: MesaId, cardId: CardId): string => join(capturesDir, mesaId, `${cardId}.jpg`)

  function withQueue<T>(id: MesaId, task: () => Promise<T>): Promise<T> {
    const previous = queues.get(id) ?? Promise.resolve()
    const result = previous.then(task, task)
    const settled = result.catch(() => undefined)
    queues.set(id, settled)
    void settled.then(() => {
      if (queues.get(id) === settled) {
        queues.delete(id)
      }
    })
    return result
  }

  async function readMesa(id: MesaId): Promise<Mesa> {
    let raw: string
    try {
      raw = await readFile(mesaPath(id), 'utf8')
    } catch (error) {
      if (isErrnoCode(error, 'ENOENT')) {
        throw new Error('La mesa no existe')
      }
      throw error
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('El archivo de la mesa no es JSON válido')
    }
    return checkMesa(parsed, id)
  }

  async function writeMesa(mesa: Mesa): Promise<void> {
    await writeFileAtomic(mesaPath(mesa.id), `${JSON.stringify(mesa, null, 2)}\n`)
  }

  /** Lee, aplica el cambio y guarda dentro de la cola de la mesa. */
  function mutate<T>(id: MesaId, change: (mesa: Mesa, at: string) => { mesa: Mesa; result: T }): Promise<T> {
    return withQueue(id, async () => {
      const current = await readMesa(id)
      const { mesa, result } = change(current, now())
      // Sin cambios (la operación devolvió la misma mesa), no se escribe.
      if (mesa !== current) {
        await writeMesa(mesa)
      }
      return result
    })
  }

  function findCard(mesa: Mesa, cardId: CardId): Card {
    const card = mesa.cards.find(c => c.id === cardId)
    if (!card) {
      throw new Error('La tarjeta no existe')
    }
    return card
  }

  function mutateCard(
    mesaId: MesaId,
    cardId: CardId,
    change: (card: Card, at: string) => Card,
  ): Promise<Card> {
    return mutate(mesaId, (mesa, at) => {
      const updated = change(findCard(mesa, cardId), at)
      return {
        mesa: { ...mesa, updatedAt: at, cards: mesa.cards.map(c => (c.id === cardId ? updated : c)) },
        result: updated,
      }
    })
  }

  function findNote(mesa: Mesa, noteId: NoteId): Note {
    const note = mesa.notes.find(n => n.id === noteId)
    if (!note) {
      throw new Error('La nota no existe')
    }
    return note
  }

  /** Quita las conexiones que tocan `elementId`. */
  function edgesWithout(mesa: Mesa, elementId: ItemId): readonly Edge[] {
    return mesa.edges.filter(edge => edge.source !== elementId && edge.target !== elementId)
  }

  function findResult(mesa: Mesa, resultId: ResultId): Result {
    const result = mesa.results.find(r => r.id === resultId)
    if (!result) {
      throw new Error('El resultado no existe')
    }
    return result
  }

  return {
    async list(): Promise<MesaListing> {
      let entries: string[]
      try {
        entries = await readdir(mesasDir)
      } catch (error) {
        if (isErrnoCode(error, 'ENOENT')) {
          return { mesas: [], unreadable: [] }
        }
        throw error
      }
      const summaries: MesaSummary[] = []
      const unreadable: string[] = []
      for (const entry of entries) {
        if (!entry.endsWith(MESA_EXTENSION)) {
          continue
        }
        const id = entry.slice(0, -MESA_EXTENSION.length)
        try {
          parseId(id)
          const mesa = await readMesa(id)
          summaries.push({
            id: mesa.id,
            name: mesa.name,
            createdAt: mesa.createdAt,
            updatedAt: mesa.updatedAt,
            cardCount: mesa.cards.length,
          })
        } catch (error) {
          unreadable.push(id)
          log('store.mesa-skipped', { file: entry, reason: error instanceof Error ? error.message : String(error) })
        }
      }
      summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
      return { mesas: summaries, unreadable }
    },

    async create(name: string): Promise<Mesa> {
      const id = randomUUID()
      const at = now()
      const mesa: Mesa = {
        schemaVersion: SCHEMA_VERSION,
        id,
        name,
        createdAt: at,
        updatedAt: at,
        viewport: DEFAULT_VIEWPORT,
        cards: [],
        notes: [],
        edges: [],
        results: [],
        dismissedResults: [],
        agentNotion: DEFAULT_AGENT_NOTION,
      }
      await withQueue(id, () => writeMesa(mesa))
      return mesa
    },

    async get(id: MesaId): Promise<Mesa> {
      return readMesa(parseId(id))
    },

    async rename(id: MesaId, name: string): Promise<Mesa> {
      return mutate(parseId(id), (mesa, at) => {
        const renamed: Mesa = { ...mesa, name, updatedAt: at }
        return { mesa: renamed, result: renamed }
      })
    },

    async setAgentNotion(id: MesaId, mode: AgentNotionMode): Promise<Mesa> {
      return mutate(parseId(id), (mesa, at) => {
        if (mesa.agentNotion === mode) {
          return { mesa, result: mesa }
        }
        const changed: Mesa = { ...mesa, agentNotion: mode, updatedAt: at }
        return { mesa: changed, result: changed }
      })
    },

    async remove(id: MesaId): Promise<void> {
      const mesaId = parseId(id)
      return withQueue(mesaId, async () => {
        await readMesa(mesaId)
        await unlink(mesaPath(mesaId))
        await rm(mesaCapturesDir(mesaId), { recursive: true, force: true })
      })
    },

    async setViewport(id: MesaId, viewport: Viewport): Promise<void> {
      await mutate(parseId(id), (mesa, at) => ({ mesa: { ...mesa, viewport, updatedAt: at }, result: undefined }))
    },

    async addCard(mesaId: MesaId, input: { url: string; serviceId: string; position: Point }): Promise<Card> {
      return mutate(parseId(mesaId), (mesa, at) => {
        const card: Card = {
          id: randomUUID(),
          url: input.url,
          serviceId: input.serviceId,
          title: null,
          position: input.position,
          size: DEFAULT_CARD_SIZE,
          capturedAt: null,
          createdAt: at,
          updatedAt: at,
        }
        return { mesa: { ...mesa, updatedAt: at, cards: [...mesa.cards, card] }, result: card }
      })
    },

    async updateCard(mesaId: MesaId, cardId: CardId, patch: CardPatch): Promise<Card> {
      return mutateCard(parseId(mesaId), parseId(cardId), (card, at) => ({
        ...card,
        ...(patch.position === undefined ? {} : { position: patch.position }),
        ...(patch.size === undefined ? {} : { size: patch.size }),
        updatedAt: at,
      }))
    },

    async setCardTitle(mesaId: MesaId, cardId: CardId, title: string | null): Promise<Card> {
      return mutateCard(parseId(mesaId), parseId(cardId), (card, at) => ({ ...card, title, updatedAt: at }))
    },

    async removeCard(mesaId: MesaId, cardId: CardId): Promise<void> {
      const mId = parseId(mesaId)
      const cId = parseId(cardId)
      await withQueue(mId, async () => {
        const mesa = await readMesa(mId)
        findCard(mesa, cId)
        const at = now()
        // Sus conexiones se borran en la misma escritura.
        await writeMesa({
          ...mesa,
          updatedAt: at,
          cards: mesa.cards.filter(c => c.id !== cId),
          edges: edgesWithout(mesa, cId),
        })
        await rm(cardCapturePath(mId, cId), { force: true })
      })
    },

    async addNote(mesaId: MesaId, position: Point): Promise<Note> {
      return mutate(parseId(mesaId), (mesa, at) => {
        const note: Note = {
          id: randomUUID(),
          text: '',
          position,
          size: DEFAULT_NOTE_SIZE,
          createdAt: at,
          updatedAt: at,
        }
        return { mesa: { ...mesa, updatedAt: at, notes: [...mesa.notes, note] }, result: note }
      })
    },

    async updateNote(mesaId: MesaId, noteId: NoteId, patch: NotePatch): Promise<Note> {
      const nId = parseId(noteId)
      return mutate(parseId(mesaId), (mesa, at) => {
        const updated: Note = {
          ...findNote(mesa, nId),
          ...(patch.text === undefined ? {} : { text: patch.text }),
          ...(patch.position === undefined ? {} : { position: patch.position }),
          ...(patch.size === undefined ? {} : { size: patch.size }),
          updatedAt: at,
        }
        return {
          mesa: { ...mesa, updatedAt: at, notes: mesa.notes.map(n => (n.id === nId ? updated : n)) },
          result: updated,
        }
      })
    },

    async removeNote(mesaId: MesaId, noteId: NoteId): Promise<void> {
      const nId = parseId(noteId)
      await mutate(parseId(mesaId), (mesa, at) => {
        findNote(mesa, nId)
        return {
          mesa: { ...mesa, updatedAt: at, notes: mesa.notes.filter(n => n.id !== nId), edges: edgesWithout(mesa, nId) },
          result: undefined,
        }
      })
    },

    async addEdge(mesaId: MesaId, source: ItemId, target: ItemId): Promise<Edge> {
      const sourceId = parseId(source)
      const targetId = parseId(target)
      return mutate(parseId(mesaId), (mesa, at) => {
        if (sourceId === targetId) {
          throw new Error('Un elemento no se puede conectar consigo mismo')
        }
        const exists = (elementId: string): boolean =>
          mesa.cards.some(c => c.id === elementId) ||
          mesa.notes.some(n => n.id === elementId) ||
          mesa.results.some(r => r.id === elementId)
        if (!exists(sourceId) || !exists(targetId)) {
          throw new Error('El elemento no existe')
        }
        const key = edgeKey(sourceId, targetId)
        if (mesa.edges.some(edge => edgeKey(edge.source, edge.target) === key)) {
          throw new Error('Ya están conectados')
        }
        const edge: Edge = { id: randomUUID(), source: sourceId, target: targetId, createdAt: at }
        return { mesa: { ...mesa, updatedAt: at, edges: [...mesa.edges, edge] }, result: edge }
      })
    },

    async removeEdge(mesaId: MesaId, edgeId: EdgeId): Promise<void> {
      const eId = parseId(edgeId)
      await mutate(parseId(mesaId), (mesa, at) => {
        if (!mesa.edges.some(edge => edge.id === eId)) {
          throw new Error('La conexión no existe')
        }
        return { mesa: { ...mesa, updatedAt: at, edges: mesa.edges.filter(edge => edge.id !== eId) }, result: undefined }
      })
    },

    async reconcileResults(mesaId, changes): Promise<{ added: Result[]; touched: Result[] }> {
      const add = changes.add.map(input => ({
        file: parseResultFile(input.file),
        kind: parseResultKind(input.kind),
        position: parsePoint(input.position),
      }))
      const touch = new Set(changes.touch.map(parseId))
      const undismiss = new Set(changes.undismiss.map(file => resultFileKey(parseResultFile(file))))
      return mutate(parseId(mesaId), (mesa, at) => {
        const dismissedResults = mesa.dismissedResults.filter(file => !undismiss.has(resultFileKey(file)))
        const taken = new Set([...mesa.results.map(result => result.file), ...dismissedResults].map(resultFileKey))
        const added: Result[] = []
        for (const input of add) {
          const key = resultFileKey(input.file)
          if (taken.has(key)) {
            continue
          }
          taken.add(key)
          added.push({ id: randomUUID(), ...input, size: DEFAULT_RESULT_SIZE, createdAt: at, updatedAt: at })
        }
        const touched: Result[] = []
        const results = mesa.results.map(result => {
          if (!touch.has(result.id)) {
            return result
          }
          const updated = { ...result, updatedAt: at }
          touched.push(updated)
          return updated
        })
        if (added.length === 0 && touched.length === 0 && dismissedResults.length === mesa.dismissedResults.length) {
          return { mesa, result: { added, touched } }
        }
        return {
          mesa: { ...mesa, updatedAt: at, results: [...results, ...added], dismissedResults },
          result: { added, touched },
        }
      })
    },

    async updateResult(mesaId: MesaId, resultId: ResultId, patch: ResultPatch): Promise<Result> {
      const rId = parseId(resultId)
      return mutate(parseId(mesaId), (mesa, at) => {
        const updated: Result = {
          ...findResult(mesa, rId),
          ...(patch.position === undefined ? {} : { position: patch.position }),
          ...(patch.size === undefined ? {} : { size: patch.size }),
          updatedAt: at,
        }
        return {
          mesa: { ...mesa, updatedAt: at, results: mesa.results.map(r => (r.id === rId ? updated : r)) },
          result: updated,
        }
      })
    },

    async removeResult(mesaId: MesaId, resultId: ResultId): Promise<void> {
      const rId = parseId(resultId)
      await mutate(parseId(mesaId), (mesa, at) => {
        const { file } = findResult(mesa, rId)
        return {
          mesa: {
            ...mesa,
            updatedAt: at,
            results: mesa.results.filter(r => r.id !== rId),
            edges: edgesWithout(mesa, rId),
            // Mientras el archivo siga en `resultados/`, no vuelve a la mesa.
            dismissedResults: [...mesa.dismissedResults, file],
          },
          result: undefined,
        }
      })
    },

    async saveCapture(mesaId: MesaId, cardId: CardId, jpeg: Buffer): Promise<Card> {
      const mId = parseId(mesaId)
      const cId = parseId(cardId)
      return withQueue(mId, async () => {
        const mesa = await readMesa(mId)
        findCard(mesa, cId)
        await writeFileAtomic(cardCapturePath(mId, cId), jpeg)
        const at = now()
        let updated: Card | undefined
        const cards = mesa.cards.map(c => {
          if (c.id !== cId) {
            return c
          }
          updated = { ...c, capturedAt: at, updatedAt: at }
          return updated
        })
        await writeMesa({ ...mesa, updatedAt: at, cards })
        return updated as Card
      })
    },

    capturePath(mesaId: MesaId, cardId: CardId): string | null {
      const path = cardCapturePath(parseId(mesaId), parseId(cardId))
      return existsSync(path) ? path : null
    },

    async flush(): Promise<void> {
      // Las colas guardadas ya absorben los errores: esto nunca rechaza.
      await Promise.all([...queues.values()])
    },
  }
}
