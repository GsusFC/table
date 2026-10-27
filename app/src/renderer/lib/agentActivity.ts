import { useCallback, useSyncExternalStore } from 'react'
import type { AgentActivity } from '../../shared/ipc'
import type { CardId } from '../../shared/model'

/**
 * Luz de actividad (T-012): tarjetas en las que trabaja algún agente, según
 * el proceso principal, y el ajuste «Seguir al agente» (en este equipo).
 */

const api = window.table
const FOLLOW_KEY = 'table.followAgent'

let activities: readonly AgentActivity[] = []
let follow = localStorage.getItem(FOLLOW_KEY) !== '0'
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

let loaded = false
api.agent.onActivity(next => {
  loaded = true
  activities = next
  emit()
})
void api.agent.activities().then(initial => {
  // Un cambio que llegó mientras tanto es más reciente.
  if (!loaded) {
    activities = initial
    emit()
  }
})

export function useAgentActivities(): readonly AgentActivity[] {
  return useSyncExternalStore(
    subscribe,
    useCallback(() => activities, []),
  )
}

/** Primera actividad en la tarjeta (varias sesiones pueden trabajar en ella), o null. */
export function useCardActivity(cardId: CardId): AgentActivity | null {
  return useSyncExternalStore(
    subscribe,
    useCallback(() => activities.find(activity => activity.cardId === cardId) ?? null, [cardId]),
  )
}

/** «<agente> está trabajando», con lo que dijo que hace si lo dijo. */
export function activityLabel(activity: AgentActivity): string {
  return activity.text ? `${activity.agentName} está trabajando: ${activity.text}` : `${activity.agentName} está trabajando`
}

/** «Seguir al agente»: activado por defecto; se recuerda en este equipo. */
export function useFollowAgent(): readonly [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(subscribe, () => follow)
  return [value, setFollowAgent] as const
}

function setFollowAgent(value: boolean): void {
  follow = value
  localStorage.setItem(FOLLOW_KEY, value ? '1' : '0')
  emit()
}
