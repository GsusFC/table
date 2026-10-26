/**
 * Archivos y frames de Figma (T-005). Una tarjeta de frame es una tarjeta web de
 * Figma cuya URL lleva `node-id`; todas las tarjetas de un mismo archivo
 * comparten un único editor cargado.
 */
import type { IsoDate } from './model'

/** Rutas de archivo de diseño con nodos navegables por `node-id`. */
const FILE_PATH = /^\/(?:design|file)\/([A-Za-z0-9]{10,64})(?:\/|$)/

/**
 * Clave del archivo de una URL de Figma (`/design/<clave>/…` o `/file/<clave>/…`),
 * o null. `hosts` solo cambia en el smoke, que sirve archivos falsos en local.
 */
export function figmaFileKey(url: string, hosts: readonly string[] = ['figma.com']): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase()
  if (!hosts.some(allowed => host === allowed || host.endsWith(`.${allowed}`))) {
    return null
  }
  return FILE_PATH.exec(parsed.pathname)?.[1] ?? null
}

/** ID de nodo de la API (`12:34`) a partir de `node-id` de la URL (`12-34` o `12:34`), o null. */
export function figmaNodeId(url: string): string | null {
  let raw: string | null
  try {
    raw = new URL(url).searchParams.get('node-id')
  } catch {
    return null
  }
  if (!raw) {
    return null
  }
  const id = raw.replace(/-/g, ':')
  return /^[0-9]+:[0-9]+$/.test(id) ? id : null
}

/** URL del frame dentro del archivo: la del archivo con `node-id` y sin otros parámetros. */
export function figmaFrameUrl(fileUrl: string, nodeId: string): string {
  const parsed = new URL(fileUrl)
  return `${parsed.origin}${parsed.pathname}?node-id=${nodeId.replace(/:/g, '-')}`
}

/** Frame de primer nivel de una página, para elegir en «Añadir frames». */
export interface FigmaFrame {
  readonly nodeId: string
  readonly name: string
  /** `FRAME`, `SECTION`, `COMPONENT` o `COMPONENT_SET`. */
  readonly type: string
}

export interface FigmaPage {
  readonly id: string
  readonly name: string
  readonly frames: readonly FigmaFrame[]
}

export interface FigmaFileFrames {
  readonly fileName: string
  readonly pages: readonly FigmaPage[]
}

/** Miniatura guardada de una tarjeta de frame. */
export interface FrameThumbnail {
  readonly name: string
  readonly pageName: string | null
  readonly fetchedAt: IsoDate
  /** `table-figma://…`, para la etiqueta `<img>`. */
  readonly src: string
}

/** Conexión con Figma visible en la interfaz: nunca el token. */
export interface FigmaSettingsView {
  readonly connected: boolean
  readonly handle: string | null
}
