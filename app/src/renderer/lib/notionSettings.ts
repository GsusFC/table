import { useSyncExternalStore } from 'react'

/** Versión de los ajustes de Notion: las fichas se vuelven a leer cuando cambia. */
let version = 0
const listeners = new Set<() => void>()

export function notifyNotionSettingsChanged(): void {
  version += 1
  for (const listener of listeners) {
    listener()
  }
}

export function useNotionSettingsVersion(): number {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => version,
  )
}
