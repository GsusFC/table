import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DEFAULT_CARD_SIZE,
  DEFAULT_VIEWPORT,
  SCHEMA_VERSION,
  type Card,
  type CardId,
  type CardPatch,
  type Mesa,
  type MesaId,
  type MesaSummary,
  type Point,
  type Viewport,
} from '../../shared/model'
import { parseId } from '../../shared/validate'
import { log } from '../log'
import type { MesaStore } from './types'

const MESA_EXTENSION = '.json'

function now(): string {
  return new Date().toISOString()
}

function isErrnoCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === code
}

/**
 * Comprobación mínima de forma: lo justo para no operar sobre un archivo
 * ajeno o de otra versión. El contenido lo escribió esta misma app.
 */
function checkMesa(value: unknown, id: MesaId): Mesa {
  if (typeof value !== 'object' || value === null) {
    throw new Error('El archivo de la mesa no es válido')
  }
  const fields = value as { readonly [K in keyof Mesa]?: unknown }
  if (fields.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `La mesa usa una versión de esquema no admitida (${String(fields.schemaVersion)}; se espera ${SCHEMA_VERSION})`,
    )
  }
  if (
    fields.id !== id ||
    typeof fields.name !== 'string' ||
    typeof fields.createdAt !== 'string' ||
    typeof fields.updatedAt !== 'string' ||
    typeof fields.viewport !== 'object' ||
    fields.viewport === null ||
    !Array.isArray(fields.cards) ||
    !fields.cards.every(card => typeof card === 'object' && card !== null && typeof card.id === 'string')
  ) {
    throw new Error('El archivo de la mesa no es válido')
  }
  return value as Mesa
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

  async function writeAtomic(path: string, dir: string, data: string | Buffer): Promise<void> {
    await mkdir(dir, { recursive: true })
    const tmp = join(dir, `.${randomUUID()}.tmp`)
    try {
      await writeFile(tmp, data)
      await rename(tmp, path)
    } catch (error) {
      await unlink(tmp).catch(() => undefined)
      throw error
    }
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
    await writeAtomic(mesaPath(mesa.id), mesasDir, `${JSON.stringify(mesa, null, 2)}\n`)
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

  return {
    async list(): Promise<MesaSummary[]> {
      let entries: string[]
      try {
        entries = await readdir(mesasDir)
      } catch (error) {
        if (isErrnoCode(error, 'ENOENT')) {
          return []
        }
        throw error
      }
      const summaries: MesaSummary[] = []
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
          log('store.mesa-skipped', { reason: error instanceof Error ? error.message : String(error) })
        }
      }
      return summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
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
      await mutate(mId, (mesa, at) => {
        findCard(mesa, cId)
        return { mesa: { ...mesa, updatedAt: at, cards: mesa.cards.filter(c => c.id !== cId) }, result: undefined }
      })
      await rm(cardCapturePath(mId, cId), { force: true })
    },

    async saveCapture(mesaId: MesaId, cardId: CardId, jpeg: Buffer): Promise<Card> {
      const mId = parseId(mesaId)
      const cId = parseId(cardId)
      return withQueue(mId, async () => {
        const mesa = await readMesa(mId)
        findCard(mesa, cId)
        await writeAtomic(cardCapturePath(mId, cId), mesaCapturesDir(mId), jpeg)
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
  }
}
