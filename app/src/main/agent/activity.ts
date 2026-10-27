import type { AgentActivity } from '../../shared/ipc'
import type { CardId, MesaId } from '../../shared/model'

/**
 * Luz de actividad (T-012): en qué tarjeta trabaja cada sesión de agente.
 * Una sesión trabaja en una tarjeta a la vez. Se enciende sola con las
 * herramientas `table_web_*` y con `table_set_activity`, y se apaga con
 * `table_clear_activity`, al terminar la sesión o tras un rato sin actividad:
 * WEB_IDLE_MS después de la última herramienta web, ANNOUNCED_MAX_MS después
 * de `table_set_activity` (el agente puede olvidar apagarla).
 *
 * Mientras una tarjeta tiene actividad, su web se fija (`pin`): no se descarga
 * por el límite de webs cargadas. Al apagarse se suelta (`unpin`).
 */

export const WEB_IDLE_MS = 20_000
export const ANNOUNCED_MAX_MS = 10 * 60_000

/** Sesión que trabaja: lo que la persona ve en el aviso. */
export interface ActivitySession {
  readonly sessionId: string
  readonly mesaId: MesaId
  readonly agentName: string
}

export interface ActivityDeps {
  /** Lista completa tras cada cambio (para la interfaz). */
  onChange(activities: readonly AgentActivity[]): void
  /** La web de la tarjeta no se descarga por el límite mientras tenga actividad. */
  pin(cardId: CardId): void
  unpin(cardId: CardId): void
  now?: () => Date
  webIdleMs?: number
  announcedMaxMs?: number
}

export interface ActivityTracker {
  /**
   * Una herramienta web empieza a trabajar en la tarjeta. La luz no se apaga
   * por inactividad hasta que la herramienta termina (`done`) y pasa
   * WEB_IDLE_MS sin otra.
   */
  beginWeb(session: ActivitySession, cardId: CardId): () => void
  /** `table_set_activity`: hasta `clear`, el fin de la sesión o ANNOUNCED_MAX_MS. */
  announce(session: ActivitySession, cardId: CardId, nodeId: string | null, text: string | null): AgentActivity
  /** `table_clear_activity`; true si había algo encendido. */
  clear(sessionId: string): boolean
  /** La sesión terminó. */
  endSession(sessionId: string): void
  /** Actividades encendidas ahora (una por sesión). */
  list(): AgentActivity[]
}

interface Entry {
  activity: AgentActivity
  timer: NodeJS.Timeout | null
  /** Herramientas web en curso: mientras haya alguna, no se apaga por inactividad. */
  inFlight: number
}

export function createActivityTracker(deps: ActivityDeps): ActivityTracker {
  const now = deps.now ?? (() => new Date())
  const webIdleMs = deps.webIdleMs ?? WEB_IDLE_MS
  const announcedMaxMs = deps.announcedMaxMs ?? ANNOUNCED_MAX_MS
  const entries = new Map<string, Entry>()
  /** Tarjetas fijadas ahora. */
  const pinned = new Set<CardId>()
  /**
   * Operaciones web en curso por tarjeta: la tarjeta sigue fijada mientras
   * alguna dure, aunque la luz de su sesión ya haya pasado a otra tarjeta.
   */
  const operations = new Map<CardId, number>()

  function list(): AgentActivity[] {
    return [...entries.values()].map(entry => entry.activity)
  }

  /** Fija las tarjetas con actividad u operaciones en curso y suelta las demás. */
  function syncPins(): void {
    const wanted = new Set<CardId>(operations.keys())
    for (const entry of entries.values()) {
      wanted.add(entry.activity.cardId)
    }
    for (const cardId of wanted) {
      if (!pinned.has(cardId)) {
        pinned.add(cardId)
        deps.pin(cardId)
      }
    }
    for (const cardId of [...pinned]) {
      if (!wanted.has(cardId)) {
        pinned.delete(cardId)
        deps.unpin(cardId)
      }
    }
  }

  function changed(): void {
    syncPins()
    deps.onChange(list())
  }

  function stopTimer(entry: Entry): void {
    if (entry.timer) {
      clearTimeout(entry.timer)
      entry.timer = null
    }
  }

  function expireAfter(sessionId: string, entry: Entry, ms: number): void {
    stopTimer(entry)
    entry.timer = setTimeout(() => {
      if (entries.get(sessionId) === entry) {
        entries.delete(sessionId)
        changed()
      }
    }, ms)
    entry.timer.unref?.()
  }

  function remove(sessionId: string): boolean {
    const entry = entries.get(sessionId)
    if (!entry) {
      return false
    }
    stopTimer(entry)
    entries.delete(sessionId)
    changed()
    return true
  }

  return {
    beginWeb(session, cardId) {
      operations.set(cardId, (operations.get(cardId) ?? 0) + 1)
      let entry = entries.get(session.sessionId)
      if (!entry || entry.activity.cardId !== cardId) {
        if (entry) {
          stopTimer(entry)
        }
        entry = {
          activity: {
            sessionId: session.sessionId,
            mesaId: session.mesaId,
            cardId,
            agentName: session.agentName,
            nodeId: null,
            text: null,
            source: 'web',
            startedAt: now().toISOString(),
          },
          timer: null,
          inFlight: 0,
        }
        entries.set(session.sessionId, entry)
        changed()
      } else {
        syncPins()
      }
      const current = entry
      current.inFlight += 1
      // Un aviso de `table_set_activity` en la misma tarjeta conserva su plazo, más largo.
      if (current.activity.source === 'web') {
        stopTimer(current)
      }
      let finished = false
      return () => {
        if (finished) {
          return
        }
        finished = true
        const remaining = (operations.get(cardId) ?? 1) - 1
        if (remaining > 0) {
          operations.set(cardId, remaining)
        } else {
          operations.delete(cardId)
        }
        current.inFlight -= 1
        if (current.inFlight === 0 && current.activity.source === 'web' && entries.get(session.sessionId) === current) {
          expireAfter(session.sessionId, current, webIdleMs)
        }
        syncPins()
      }
    },

    announce(session, cardId, nodeId, text) {
      const previous = entries.get(session.sessionId)
      const same = previous && previous.activity.cardId === cardId && previous.activity.nodeId === nodeId
      if (previous) {
        stopTimer(previous)
      }
      const entry: Entry = {
        activity: {
          sessionId: session.sessionId,
          mesaId: session.mesaId,
          cardId,
          agentName: session.agentName,
          nodeId,
          text,
          source: 'announced',
          // La misma tarjeta y nodo no es una actividad nueva: la interfaz no vuelve a abrirla.
          startedAt: same ? previous.activity.startedAt : now().toISOString(),
        },
        timer: null,
        inFlight: previous && previous.activity.cardId === cardId ? previous.inFlight : 0,
      }
      entries.set(session.sessionId, entry)
      expireAfter(session.sessionId, entry, announcedMaxMs)
      changed()
      return entry.activity
    },

    clear: remove,

    endSession(sessionId) {
      remove(sessionId)
    },

    list,
  }
}
