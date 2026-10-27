import {
  AGENT_NOTION_MODES,
  MAX_MESA_NAME_LENGTH,
  MAX_NOTE_TEXT_LENGTH,
  type AgentNotionMode,
  type CardPatch,
  type NotePatch,
  type Point,
  type ResultKind,
  type ResultPatch,
  type Size,
  type Viewport,
} from './model'
import type { AgentUiState, SurfaceEnterOptions } from './ipc'
import type { PanelBounds } from './surface'
import {
  MAX_PROFILE_COMMAND_LENGTH,
  MAX_PROFILE_NAME_LENGTH,
  MAX_TERMINAL_COLS,
  MAX_TERMINAL_INPUT,
  MAX_TERMINAL_ROWS,
  type TerminalSize,
} from './terminal'

/**
 * Validación de todo lo que cruza el IPC. El proceso principal no confía en
 * el renderer: cada función lanza un Error con mensaje para el usuario.
 */

const MAX_URL_LENGTH = 2048
/** Límite de las coordenadas del lienzo: una mesa con coordenadas fuera no es legible. */
export const MAX_COORDINATE = 1_000_000
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

/** Longitud máxima del nombre de archivo de un resultado (límite de macOS). */
export const MAX_RESULT_FILE_LENGTH = 255

/**
 * Nombre de archivo de un resultado: un solo segmento dentro de `resultados/`.
 * Sin separadores (`/`, `\`, `:`), caracteres de control, espacios al principio
 * o al final ni punto inicial (`.`, `..` y los archivos ocultos no se importan).
 */
export function parseResultFile(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_RESULT_FILE_LENGTH ||
    /[\u0000-\u001f\u007f/\\:]/.test(value) ||
    value.startsWith('.') ||
    value.trim() !== value
  ) {
    throw new Error('Nombre de archivo de resultado no válido')
  }
  return value
}

const RESULT_KINDS: readonly ResultKind[] = ['image', 'text', 'file']

export function parseResultKind(value: unknown): ResultKind {
  if (typeof value !== 'string' || !(RESULT_KINDS as readonly string[]).includes(value)) {
    throw new Error('Tipo de resultado no válido')
  }
  return value as ResultKind
}

export function parseAgentNotionMode(value: unknown): AgentNotionMode {
  if (typeof value !== 'string' || !(AGENT_NOTION_MODES as readonly string[]).includes(value)) {
    throw new Error('Modo de Notion para el agente no válido')
  }
  return value as AgentNotionMode
}

/** Elementos seleccionados que la interfaz puede informar a la vez. */
const MAX_UI_SELECTION = 10_000

/** Estado de la interfaz para el MCP de Table (T-011). */
export function parseAgentUiState(value: unknown): AgentUiState {
  const record = asRecord(value, 'Estado de la interfaz')
  const selection = record['selection']
  if (!Array.isArray(selection) || selection.length > MAX_UI_SELECTION) {
    throw new Error('Selección no válida')
  }
  return {
    mesaId: record['mesaId'] === null ? null : parseId(record['mesaId']),
    selection: selection.map(parseId),
    editingNoteId: record['editingNoteId'] === null ? null : parseId(record['editingNoteId']),
  }
}

/** Opciones de entrar en una tarjeta al seguir al agente (T-012). */
export function parseSurfaceEnterOptions(value: unknown): SurfaceEnterOptions {
  if (value === undefined || value === null) {
    return {}
  }
  const record = asRecord(value, 'Opciones de entrada')
  const follow = record['follow']
  if (follow !== undefined && typeof follow !== 'boolean') {
    throw new Error('Opciones de entrada no válidas')
  }
  const nodeId = record['nodeId']
  if (nodeId !== undefined && nodeId !== null && (typeof nodeId !== 'string' || !/^[0-9]{1,12}:[0-9]{1,12}$/.test(nodeId))) {
    throw new Error('node-id no válido')
  }
  return { follow: follow === true, nodeId: typeof nodeId === 'string' ? nodeId : null }
}

/** Igual que el de una tarjeta: posición y tamaño. */
export function parseResultPatch(value: unknown): ResultPatch {
  return parseCardPatch(value)
}

export function parsePanelBounds(value: unknown): PanelBounds {
  const record = asRecord(value, 'Panel')
  const read = (key: keyof PanelBounds): number => Math.round(readNumber(record, key, 0, MAX_PANEL_DIMENSION))
  return { x: read('x'), y: read('y'), width: read('width'), height: read('height') }
}

/** Columnas y filas; valores fuera de los límites se ajustan al más cercano. */
export function parseTerminalSize(value: unknown): TerminalSize {
  const record = asRecord(value, 'Tamaño de terminal')
  const read = (key: keyof TerminalSize, max: number): number => {
    const n = record[key]
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      throw new Error(`Valor no válido: ${key}`)
    }
    return Math.min(max, Math.max(1, Math.floor(n)))
  }
  return { cols: read('cols', MAX_TERMINAL_COLS), rows: read('rows', MAX_TERMINAL_ROWS) }
}

/** Teclas o texto pegado hacia una sesión. */
export function parseTerminalInput(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TERMINAL_INPUT) {
    throw new Error('Entrada de terminal no válida')
  }
  return value
}

const BUILTIN_PROFILE_ID = /^[a-z][a-z0-9-]{0,31}$/
const CUSTOM_PROFILE_ID = /^custom:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/

/** ID de un perfil del catálogo (`claude`) o propio (`custom:<uuid>`); no comprueba que exista. */
export function parseProfileId(value: unknown): string {
  if (typeof value !== 'string' || !(BUILTIN_PROFILE_ID.test(value) || CUSTOM_PROFILE_ID.test(value))) {
    throw new Error('Perfil no válido')
  }
  return value
}

export function isCustomProfileId(value: string): boolean {
  return CUSTOM_PROFILE_ID.test(value)
}

/** Nombre (1–60) y comando de una línea (1–500) de un perfil propio. */
export function parseCustomProfileInput(value: unknown): { name: string; command: string } {
  const record = asRecord(value, 'Perfil')
  const { name, command } = record
  if (typeof name !== 'string' || typeof command !== 'string') {
    throw new Error('Perfil no válido')
  }
  const cleanName = name.trim().replace(/\s+/g, ' ')
  if (cleanName.length === 0 || cleanName.length > MAX_PROFILE_NAME_LENGTH || CONTROL_CHARACTER.test(cleanName)) {
    throw new Error(`El nombre del perfil admite de 1 a ${MAX_PROFILE_NAME_LENGTH} caracteres`)
  }
  const cleanCommand = command.trim()
  if (cleanCommand.length === 0 || cleanCommand.length > MAX_PROFILE_COMMAND_LENGTH) {
    throw new Error(`El comando admite de 1 a ${MAX_PROFILE_COMMAND_LENGTH} caracteres`)
  }
  // Una sola línea y sin caracteres de control: se ejecuta tal cual con `$SHELL -l -c`.
  if (CONTROL_CHARACTER.test(cleanCommand)) {
    throw new Error('El comando debe ocupar una sola línea, sin caracteres de control')
  }
  return { name: cleanName, command: cleanCommand }
}
