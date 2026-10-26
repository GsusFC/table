import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, readFile, rm, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DEFAULT_CARD_SIZE,
  DEFAULT_NOTE_SIZE,
  DEFAULT_VIEWPORT,
  edgeKey,
  SCHEMA_VERSION,
  type Card,
  type CardId,
  type CardPatch,
  type Edge,
  type EdgeId,
  type Mesa,
  type MesaId,
  type MesaListing,
  type MesaSummary,
  type Note,
  type NoteId,
  type NotePatch,
  type Point,
  type Viewport,
} from '../../shared/model'
import {
  parseHttpUrl,
  parseId,
  parseMesaName,
  parseNoteText,
  parsePoint,
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

/** Versión anterior admitida: se lee migrada a la actual. */
const MIGRATABLE_SCHEMA_VERSION = 1

/**
 * Validación completa de un archivo de mesa: versión, IDs (únicos en toda la
 * mesa), nombre, fechas, viewport, cada tarjeta y nota, y conexiones entre
 * elementos que existen, sin autoconexiones ni duplicados (en cualquier
 * sentido). La versión 1 se migra en memoria: sin notas ni conexiones.
 * Cualquier fallo lanza; el archivo no se toca.
 */
function checkMesa(value: unknown, id: MesaId): Mesa {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(INVALID)
  }
  const fields = value as { readonly [K in keyof Mesa]?: unknown }
  const version = fields.schemaVersion
  if (version !== SCHEMA_VERSION && version !== MIGRATABLE_SCHEMA_VERSION) {
    throw new Error(`La mesa usa una versión de esquema no admitida (${String(version)}; se espera ${SCHEMA_VERSION})`)
  }
  if (fields.id !== id || !Array.isArray(fields.cards)) {
    throw new Error(INVALID)
  }
  let rawNotes: readonly unknown[] = []
  let rawEdges: readonly unknown[] = []
  if (version === SCHEMA_VERSION) {
    if (!Array.isArray(fields.notes) || !Array.isArray(fields.edges)) {
      throw new Error(INVALID)
    }
    rawNotes = fields.notes
    rawEdges = fields.edges
  } else if (fields.notes !== undefined || fields.edges !== undefined) {
    throw new Error(INVALID)
  }
  const mesaId = checkSame(fields.id, parseId)
  const cards = fields.cards.map(checkCard)
  const notes = rawNotes.map(checkNote)
  const edges = rawEdges.map(checkEdge)
  const ids = new Set<string>([mesaId])
  const addUnique = (itemId: string): void => {
    if (ids.has(itemId)) {
      throw new Error(INVALID)
    }
    ids.add(itemId)
  }
  const elements = new Set<string>()
  for (const item of [...cards, ...notes]) {
    addUnique(item.id)
    elements.add(item.id)
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
  }
}

export function createMesaStore(baseDir: string): MesaStore {
  const mesasDir = join(baseDir, 'mesas')
  const capturesDir = join(baseDir, 'captures')
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
      await writeMesa(mesa)
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
  function edgesWithout(mesa: Mesa, elementId: CardId | NoteId): readonly Edge[] {
    return mesa.edges.filter(edge => edge.source !== elementId && edge.target !== elementId)
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

    async addEdge(mesaId: MesaId, source: CardId | NoteId, target: CardId | NoteId): Promise<Edge> {
      const sourceId = parseId(source)
      const targetId = parseId(target)
      return mutate(parseId(mesaId), (mesa, at) => {
        if (sourceId === targetId) {
          throw new Error('Un elemento no se puede conectar consigo mismo')
        }
        const exists = (elementId: string): boolean =>
          mesa.cards.some(c => c.id === elementId) || mesa.notes.some(n => n.id === elementId)
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
