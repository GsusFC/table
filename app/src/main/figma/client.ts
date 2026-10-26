import { net } from 'electron'
import type { FigmaFileFrames, FigmaFrame, FigmaPage } from '../../shared/figma'

const TIMEOUT_MS = 20_000
/** Tipos de nodo de primer nivel que se ofrecen como frames. */
const FRAME_TYPES: Record<string, true> = { FRAME: true, SECTION: true, COMPONENT: true, COMPONENT_SET: true }

/**
 * Error de Figma con un mensaje apto para la interfaz y los logs: nunca incluye
 * el token ni el contenido del archivo.
 */
export class FigmaError extends Error {
  constructor(
    message: string,
    readonly code: 'unauthorized' | 'not-found' | 'rate-limited' | 'offline' | 'unexpected',
  ) {
    super(message)
    this.name = 'FigmaError'
  }
}

export interface FigmaClient {
  /** Usuario del token. */
  me(): Promise<{ handle: string | null }>
  /** Páginas del archivo con sus frames de primer nivel (`depth=2`). */
  frames(fileKey: string): Promise<FigmaFileFrames>
  /** URLs temporales de imagen de cada nodo (las que Figma no pudo renderizar faltan). */
  imageUrls(fileKey: string, nodeIds: readonly string[], scale: number): Promise<Map<string, string>>
  /** Descarga una imagen renderizada (URL de Figma, sin token). */
  download(url: string): Promise<Buffer>
}

/** `apiBase` solo cambia en el smoke, que usa un servidor local con archivos falsos. */
export function createFigmaClient(token: string, apiBase = 'https://api.figma.com'): FigmaClient {
  async function send(url: string, headers: Record<string, string>): Promise<Response> {
    let response: Response
    try {
      response = await net.fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch {
      throw new FigmaError('Sin conexión con Figma', 'offline')
    }
    if (response.status === 401 || response.status === 403) {
      throw new FigmaError('Figma no acepta el token o tu cuenta no tiene acceso a ese archivo', 'unauthorized')
    }
    if (response.status === 404) {
      throw new FigmaError('El archivo de Figma no existe o tu cuenta no tiene acceso', 'not-found')
    }
    if (response.status === 429) {
      const wait = Number(response.headers.get('retry-after'))
      throw new FigmaError(
        Number.isFinite(wait) && wait > 0 ? `Figma pide esperar ${Math.ceil(wait)} s antes de volver a consultar` : 'Figma pide esperar antes de volver a consultar',
        'rate-limited',
      )
    }
    if (!response.ok) {
      throw new FigmaError(`Figma respondió con un error (${response.status})`, 'unexpected')
    }
    return response
  }

  async function api(path: string): Promise<Record<string, unknown>> {
    const response = await send(`${apiBase}${path}`, { 'X-Figma-Token': token })
    try {
      return (await response.json()) as Record<string, unknown>
    } catch {
      throw new FigmaError('Respuesta de Figma no válida', 'unexpected')
    }
  }

  return {
    async me() {
      const body = await api('/v1/me')
      return { handle: typeof body['handle'] === 'string' ? body['handle'] : null }
    },

    async frames(fileKey) {
      const body = await api(`/v1/files/${encodeURIComponent(fileKey)}?depth=2`)
      const document = body['document'] as { children?: unknown } | undefined
      const pages: FigmaPage[] = []
      for (const page of Array.isArray(document?.children) ? document.children : []) {
        const node = page as { id?: unknown; name?: unknown; type?: unknown; children?: unknown }
        if (node.type !== 'CANVAS' || typeof node.id !== 'string') {
          continue
        }
        const frames: FigmaFrame[] = []
        for (const child of Array.isArray(node.children) ? node.children : []) {
          const frame = child as { id?: unknown; name?: unknown; type?: unknown }
          if (typeof frame.id === 'string' && typeof frame.type === 'string' && Object.hasOwn(FRAME_TYPES, frame.type)) {
            frames.push({ nodeId: frame.id, name: typeof frame.name === 'string' ? frame.name : 'Sin nombre', type: frame.type })
          }
        }
        pages.push({ id: node.id, name: typeof node.name === 'string' ? node.name : 'Página', frames })
      }
      return { fileName: typeof body['name'] === 'string' ? body['name'] : 'Archivo de Figma', pages }
    },

    async imageUrls(fileKey, nodeIds, scale) {
      const query = new URLSearchParams({ ids: nodeIds.join(','), format: 'png', scale: String(scale) })
      const body = await api(`/v1/images/${encodeURIComponent(fileKey)}?${query}`)
      // Las imágenes de Figma se sirven por https; solo el servidor local del smoke usa http.
      const local = apiBase.startsWith('http://127.0.0.1')
      const urls = new Map<string, string>()
      for (const [id, url] of Object.entries((body['images'] as Record<string, unknown> | undefined) ?? {})) {
        if (typeof url === 'string' && (url.startsWith('https://') || local)) {
          urls.set(id, url)
        }
      }
      return urls
    },

    async download(url) {
      const response = await send(url, {})
      return Buffer.from(await response.arrayBuffer())
    },
  }
}
