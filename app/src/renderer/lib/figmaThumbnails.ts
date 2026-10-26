import { useEffect, useState, useSyncExternalStore } from 'react'
import type { FrameThumbnail } from '../../shared/figma'
import type { CardId, MesaId } from '../../shared/model'

/** Versión de las miniaturas de Figma: las tarjetas de frame las vuelven a leer cuando cambia. */
let version = 0
const listeners = new Set<() => void>()

export function notifyFigmaThumbnailsChanged(): void {
  version += 1
  for (const listener of listeners) {
    listener()
  }
}

function useThumbnailsVersion(): number {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => version,
  )
}

/** Miniatura guardada de una tarjeta de frame; null mientras no hay o si no es un frame. */
export function useFrameThumbnail(mesaId: MesaId, cardId: CardId, enabled: boolean): FrameThumbnail | null {
  const changes = useThumbnailsVersion()
  const [thumbnail, setThumbnail] = useState<FrameThumbnail | null>(null)
  useEffect(() => {
    if (!enabled) {
      setThumbnail(null)
      return
    }
    let cancelled = false
    window.table.figma.thumbnail(mesaId, cardId).then(
      next => !cancelled && setThumbnail(next),
      () => !cancelled && setThumbnail(null),
    )
    return () => {
      cancelled = true
    }
  }, [mesaId, cardId, enabled, changes])
  return thumbnail
}
