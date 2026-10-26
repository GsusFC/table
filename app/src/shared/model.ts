/**
 * Modelo de datos de una mesa (D-013, D-015). Se guarda en local, un archivo
 * por mesa. IDs estables (UUID v4) y versión de esquema para poder migrar o
 * sincronizar más adelante sin reescribir los datos.
 */

export const SCHEMA_VERSION = 2

/** UUID v4 en minúsculas. */
export type MesaId = string
export type CardId = string
export type NoteId = string
export type EdgeId = string

/** Fecha ISO 8601 en UTC, p. ej. `2026-10-26T15:00:00.000Z`. */
export type IsoDate = string

export interface Point {
  readonly x: number
  readonly y: number
}

export interface Size {
  readonly width: number
  readonly height: number
}

export interface Viewport {
  readonly x: number
  readonly y: number
  readonly zoom: number
}

/** Tarjeta web: cualquier URL añadida por el usuario (D-012). */
export interface Card {
  readonly id: CardId
  /** URL `http(s)` normalizada. */
  readonly url: string
  /** ID del servicio reconocido en `shared/services.ts`; `web` si ninguno. */
  readonly serviceId: string
  /** Título de la página la última vez que se cargó; null si nunca se cargó. */
  readonly title: string | null
  readonly position: Point
  readonly size: Size
  /** Momento de la última captura guardada; null si no hay captura. */
  readonly capturedAt: IsoDate | null
  readonly createdAt: IsoDate
  readonly updatedAt: IsoDate
}

/** Nota interna de Table: texto plano, sin web ni captura (T-004). */
export interface Note {
  readonly id: NoteId
  readonly text: string
  readonly position: Point
  readonly size: Size
  readonly createdAt: IsoDate
  readonly updatedAt: IsoDate
}

/**
 * Conexión entre dos elementos de la misma mesa (tarjetas o notas). Sin
 * dirección: A→B y B→A son la misma conexión. Nunca une un elemento consigo.
 */
export interface Edge {
  readonly id: EdgeId
  /** ID de una tarjeta o nota de la mesa. */
  readonly source: CardId | NoteId
  readonly target: CardId | NoteId
  readonly createdAt: IsoDate
}

/** Clave de una conexión sin dirección: igual para A→B y B→A. */
export function edgeKey(a: CardId | NoteId, b: CardId | NoteId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

export interface Mesa {
  readonly schemaVersion: typeof SCHEMA_VERSION
  readonly id: MesaId
  readonly name: string
  readonly createdAt: IsoDate
  readonly updatedAt: IsoDate
  readonly viewport: Viewport
  readonly cards: readonly Card[]
  readonly notes: readonly Note[]
  readonly edges: readonly Edge[]
}

/** Lo necesario para la lista del inicio, sin cargar tarjetas. */
export interface MesaSummary {
  readonly id: MesaId
  readonly name: string
  readonly createdAt: IsoDate
  readonly updatedAt: IsoDate
  readonly cardCount: number
}

/** Resultado de listar: mesas legibles e IDs de los archivos que no se pudieron abrir. */
export interface MesaListing {
  readonly mesas: readonly MesaSummary[]
  /** Nombres de archivo (sin `.json`) dañados o de otra versión; se conservan sin tocar. */
  readonly unreadable: readonly string[]
}

/** Cambios admitidos sobre una tarjeta desde la interfaz. */
export interface CardPatch {
  readonly position?: Point
  readonly size?: Size
}

/** Cambios admitidos sobre una nota desde la interfaz. */
export interface NotePatch {
  readonly text?: string
  readonly position?: Point
  readonly size?: Size
}

export const DEFAULT_CARD_SIZE: Size = { width: 320, height: 220 }
export const DEFAULT_NOTE_SIZE: Size = { width: 240, height: 144 }
export const MAX_NOTE_TEXT_LENGTH = 10_000
export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 }
export const MAX_MESA_NAME_LENGTH = 120
