import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentActivity } from '../../shared/ipc'
import { ANNOUNCED_MAX_MS, createActivityTracker, WEB_IDLE_MS, type ActivityTracker } from './activity'

const A = { sessionId: 'sesion-a', mesaId: 'mesa', agentName: 'Claude Code' }
const B = { sessionId: 'sesion-b', mesaId: 'mesa', agentName: 'Codex' }

let tracker: ActivityTracker
let changes: (readonly AgentActivity[])[]
let pinned: Set<string>
let pinLog: string[]

beforeEach(() => {
  vi.useFakeTimers()
  changes = []
  pinned = new Set()
  pinLog = []
  tracker = createActivityTracker({
    onChange: list => changes.push(list),
    pin: cardId => {
      pinned.add(cardId)
      pinLog.push(`+${cardId}`)
    },
    unpin: cardId => {
      pinned.delete(cardId)
      pinLog.push(`-${cardId}`)
    },
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('luz de actividad', () => {
  it('una herramienta web la enciende y se apaga sola tras WEB_IDLE_MS sin otra (no mientras trabaja)', () => {
    const done = tracker.beginWeb(A, 'tarjeta-1')
    expect(tracker.list()).toEqual([expect.objectContaining({ cardId: 'tarjeta-1', source: 'web', agentName: 'Claude Code' })])
    expect(pinned).toEqual(new Set(['tarjeta-1']))
    // Una herramienta larga (esperar a un texto) no deja que se apague.
    vi.advanceTimersByTime(WEB_IDLE_MS * 2)
    expect(tracker.list()).toHaveLength(1)
    done()
    vi.advanceTimersByTime(WEB_IDLE_MS - 1)
    expect(tracker.list()).toHaveLength(1)
    // Otra herramienta reinicia el plazo.
    tracker.beginWeb(A, 'tarjeta-1')()
    vi.advanceTimersByTime(WEB_IDLE_MS - 1)
    expect(tracker.list()).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(tracker.list()).toEqual([])
    expect(pinned).toEqual(new Set())
    expect(changes.at(-1)).toEqual([])
  })

  it('cambiar de tarjeta es una actividad nueva: suelta la anterior y fija la nueva', () => {
    tracker.beginWeb(A, 'tarjeta-1')()
    const first = tracker.list()[0]!
    vi.advanceTimersByTime(10)
    tracker.beginWeb(A, 'tarjeta-2')()
    const second = tracker.list()[0]!
    expect(second.cardId).toBe('tarjeta-2')
    expect(second.startedAt).not.toBe(first.startedAt)
    expect(pinLog).toEqual(['+tarjeta-1', '+tarjeta-2', '-tarjeta-1'])
  })

  it('dos herramientas a la vez en A y B: A sigue fijada hasta que termina su operación', () => {
    const doneA = tracker.beginWeb(A, 'tarjeta-a')
    const doneB = tracker.beginWeb(A, 'tarjeta-b')
    // La luz ya está en B, pero la operación en A sigue en curso.
    expect(tracker.list().map(item => item.cardId)).toEqual(['tarjeta-b'])
    expect(pinned).toEqual(new Set(['tarjeta-a', 'tarjeta-b']))
    doneA()
    expect(pinned).toEqual(new Set(['tarjeta-b']))
    doneB()
    // Al cerrar la sesión con una operación en curso, la tarjeta se suelta cuando termina.
    const pending = tracker.beginWeb(A, 'tarjeta-c')
    tracker.endSession(A.sessionId)
    expect(pinned.has('tarjeta-c')).toBe(true)
    pending()
    expect(pinned.has('tarjeta-c')).toBe(false)
  })

  it('table_set_activity dura hasta table_clear_activity o ANNOUNCED_MAX_MS; las herramientas web no la acortan', () => {
    tracker.announce(A, 'figma', '1:2', 'Revisando')
    tracker.beginWeb(A, 'figma')()
    vi.advanceTimersByTime(WEB_IDLE_MS * 3)
    expect(tracker.list()).toEqual([expect.objectContaining({ source: 'announced', nodeId: '1:2', text: 'Revisando' })])
    expect(tracker.clear(A.sessionId)).toBe(true)
    expect(tracker.clear(A.sessionId)).toBe(false)
    expect(pinned).toEqual(new Set())

    tracker.announce(A, 'figma', null, null)
    vi.advanceTimersByTime(ANNOUNCED_MAX_MS)
    expect(tracker.list()).toEqual([])
  })

  it('el mismo nodo no es una actividad nueva; otro nodo sí', () => {
    const first = tracker.announce(A, 'figma', '1:2', null)
    vi.advanceTimersByTime(10)
    expect(tracker.announce(A, 'figma', '1:2', 'otra cosa').startedAt).toBe(first.startedAt)
    expect(tracker.announce(A, 'figma', '3:4', null).startedAt).not.toBe(first.startedAt)
  })

  it('al terminar la sesión se apaga; una tarjeta con dos sesiones sigue fijada hasta que acaban las dos', () => {
    tracker.beginWeb(A, 'compartida')()
    tracker.beginWeb(B, 'compartida')()
    expect(pinLog).toEqual(['+compartida'])
    tracker.endSession(A.sessionId)
    expect(pinned).toEqual(new Set(['compartida']))
    expect(tracker.list().map(item => item.sessionId)).toEqual([B.sessionId])
    tracker.endSession(B.sessionId)
    expect(pinned).toEqual(new Set())
    expect(tracker.list()).toEqual([])
  })
})
