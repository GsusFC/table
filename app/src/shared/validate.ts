import {
  MAX_MESA_NAME_LENGTH,
  MAX_NOTE_TEXT_LENGTH,
  type CardPatch,
  type NotePatch,
  type Point,
  type Size,
  type Viewport,
} from './model'
import type { PanelBounds } from './surface'

/**
 * Validación de todo lo que cruza el IPC. El proceso principal no confía en
 * el renderer: cada función lanza un Error con mensaje para el usuario.
 */

const MAX_URL_LENGTH = 2048
const MAX_COORDINATE = 1_000_000
const MIN_CARD_DIMENSION = 80
const MAX_CARD_DIMENSION = 4000
const MAX_PANEL_DIMENSION = 16384
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** URL http(s) sin credenciales, devuelta normalizada (`URL.href`). */
export function parseHttpUrl(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_URL_LENGTH) {
    throw new Error('URL no válida')
  }
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('URL no válida')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Solo se admiten URL http(s)')
  }
  if (url.username || url.password) {
    throw new Error('La URL no puede incluir credenciales')
  }
  return url.href
}

export function parseId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) {
    throw new Error('Identificador no válido')
  }
  return value
}

export function parseMesaName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Nombre no válido')
  }
  const name = value.trim().replace(/\s+/g, ' ')
  if (name.length === 0) {
    throw new Error('La mesa necesita un nombre')
  }
  if (name.length > MAX_MESA_NAME_LENGTH) {
    throw new Error(`El nombre admite hasta ${MAX_MESA_NAME_LENGTH} caracteres`)
  }
  return name
}

function readNumber(record: Record<string, unknown>, key: string, min: number, max: number): number {
  const n = record[key]
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) {
    throw new Error(`Valor no válido: ${key}`)
  }
  return n
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${label} no válido`)
  }
  return value as Record<string, unknown>
}

export function parsePoint(value: unknown): Point {
  const record = asRecord(value, 'Punto')
  return {
    x: readNumber(record, 'x', -MAX_COORDINATE, MAX_COORDINATE),
    y: readNumber(record, 'y', -MAX_COORDINATE, MAX_COORDINATE),
  }
}

export function parseSize(value: unknown): Size {
  const record = asRecord(value, 'Tamaño')
  return {
    width: readNumber(record, 'width', MIN_CARD_DIMENSION, MAX_CARD_DIMENSION),
    height: readNumber(record, 'height', MIN_CARD_DIMENSION, MAX_CARD_DIMENSION),
  }
}

export function parseViewport(value: unknown): Viewport {
  const record = asRecord(value, 'Vista')
  return {
    x: readNumber(record, 'x', -MAX_COORDINATE, MAX_COORDINATE),
    y: readNumber(record, 'y', -MAX_COORDINATE, MAX_COORDINATE),
    zoom: readNumber(record, 'zoom', 0.05, 8),
  }
}

export function parseCardPatch(value: unknown): CardPatch {
  const record = asRecord(value, 'Cambio')
  const unknownKeys = Object.keys(record).filter(key => key !== 'position' && key !== 'size')
  if (unknownKeys.length > 0) {
    throw new Error(`Campo no admitido: ${unknownKeys.join(', ')}`)
  }
  return {
    ...(record['position'] === undefined ? {} : { position: parsePoint(record['position']) }),
    ...(record['size'] === undefined ? {} : { size: parseSize(record['size']) }),
  }
}

/** Texto de una nota tal cual (sin recortar), con un máximo de caracteres. */
export function parseNoteText(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Texto no válido')
  }
  if (value.length > MAX_NOTE_TEXT_LENGTH) {
    throw new Error(`La nota admite hasta ${MAX_NOTE_TEXT_LENGTH.toLocaleString('es')} caracteres`)
  }
  return value
}

export function parseNotePatch(value: unknown): NotePatch {
  const record = asRecord(value, 'Cambio')
  const unknownKeys = Object.keys(record).filter(key => key !== 'text' && key !== 'position' && key !== 'size')
  if (unknownKeys.length > 0) {
    throw new Error(`Campo no admitido: ${unknownKeys.join(', ')}`)
  }
  return {
    ...(record['text'] === undefined ? {} : { text: parseNoteText(record['text']) }),
    ...(record['position'] === undefined ? {} : { position: parsePoint(record['position']) }),
    ...(record['size'] === undefined ? {} : { size: parseSize(record['size']) }),
  }
}

export function parsePanelBounds(value: unknown): PanelBounds {
  const record = asRecord(value, 'Panel')
  const read = (key: keyof PanelBounds): number => Math.round(readNumber(record, key, 0, MAX_PANEL_DIMENSION))
  return { x: read('x'), y: read('y'), width: read('width'), height: read('height') }
}
