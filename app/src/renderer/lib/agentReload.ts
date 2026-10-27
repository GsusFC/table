import type { Card, Edge, Mesa, Note, Result } from '../../shared/model'

/**
 * Lecturas de la mesa tras un cambio del agente (T-011) frente a lo que la
 * persona está cambiando a la vez. Una lectura del disco puede ser anterior a
 * un guardado local en curso o recién terminado: entonces, en lo que la
 * persona cambió, manda lo local (texto de una nota, posición y tamaño, que
 * un elemento exista o ya no). El resto viene del disco.
 */

/** Qué cambió la persona en un elemento o conexión. */
export type LocalField = 'exists' | 'text' | 'geometry'

interface LocalEntry {
  /** Momento del último cambio local (contador, no reloj). */
  seq: number
  /** Guardados en curso. */
  pending: number
}

/** Cambios locales por elemento y campo, para saber qué lecturas son más antiguas que ellos. */
export class LocalWrites {
  #seq = 0
  readonly #entries = new Map<string, LocalEntry>()

  /** Momento de una lectura: se toma al pedirla. */
  mark(): number {
    return this.#seq
  }

  /** Empieza un guardado; devuelve cómo terminarlo (una sola vez). */
  begin(id: string, fields: readonly LocalField[]): () => void {
    const entries = this.#touch(id, fields)
    for (const entry of entries) {
      entry.pending += 1
    }
    let ended = false
    return () => {
      if (!ended) {
        ended = true
        for (const entry of entries) {
          entry.pending -= 1
        }
      }
    }
  }

  /** Cambio local ya guardado (p. ej. un elemento creado): una lectura pedida antes no lo deshace. */
  touch(id: string, fields: readonly LocalField[]): void {
    this.#touch(id, fields)
  }

  /** Si lo local manda en ese campo frente a una lectura pedida en `readMark`. */
  protects(id: string, field: LocalField, readMark: number): boolean {
    const entry = this.#entries.get(`${id}|${field}`)
    return entry !== undefined && (entry.pending > 0 || entry.seq > readMark)
  }

  #touch(id: string, fields: readonly LocalField[]): LocalEntry[] {
    this.#seq += 1
    return fields.map(field => {
      const key = `${id}|${field}`
      const entry = this.#entries.get(key) ?? { seq: 0, pending: 0 }
      entry.seq = this.#seq
      this.#entries.set(key, entry)
      return entry
    })
  }
}

type Protects = (id: string, field: LocalField) => boolean

function mergeList<T extends { readonly id: string }>(
  current: readonly T[],
  loaded: readonly T[],
  protects: Protects,
  keepLocal: (fromDisk: T, local: T) => T,
): T[] {
  const currentById = new Map(current.map(item => [item.id, item]))
  const loadedIds = new Set(loaded.map(item => item.id))
  const merged: T[] = []
  for (const item of loaded) {
    const local = currentById.get(item.id)
    if (!local) {
      // Nuevo en disco, salvo que la persona lo acabe de borrar.
      if (!protects(item.id, 'exists')) {
        merged.push(item)
      }
      continue
    }
    merged.push(keepLocal(item, local))
  }
  // Creado por la persona después de la lectura: se queda.
  for (const item of current) {
    if (!loadedIds.has(item.id) && protects(item.id, 'exists')) {
      merged.push(item)
    }
  }
  return merged
}

function keepGeometry<T extends Card | Note | Result>(fromDisk: T, local: T, protects: Protects): T {
  return protects(fromDisk.id, 'geometry') ? { ...fromDisk, position: local.position, size: local.size } : fromDisk
}

/**
 * Mesa leída del disco, conservando lo que la persona cambió y aún no está
 * (o no estaba al leer) en disco. El nombre y la vista son siempre locales.
 * Las conexiones de un elemento que ya no está (p. ej. borrado por la persona
 * después de la lectura) se quitan, como hace el almacén.
 */
export function mergeReloadedMesa(current: Mesa, loaded: Mesa, protects: Protects): Mesa {
  const cards = mergeList<Card>(current.cards, loaded.cards, protects, (disk, local) => keepGeometry(disk, local, protects))
  const notes = mergeList<Note>(current.notes, loaded.notes, protects, (disk, local) => {
    const withGeometry = keepGeometry(disk, local, protects)
    return protects(disk.id, 'text') ? { ...withGeometry, text: local.text } : withGeometry
  })
  const results = mergeList<Result>(current.results, loaded.results, protects, (disk, local) => keepGeometry(disk, local, protects))
  const present = new Set([...cards, ...notes, ...results].map(item => item.id))
  return {
    ...loaded,
    name: current.name,
    viewport: current.viewport,
    cards,
    notes,
    results,
    edges: mergeList<Edge>(current.edges, loaded.edges, protects, disk => disk).filter(edge => present.has(edge.source) && present.has(edge.target)),
  }
}
