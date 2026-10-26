import { nativeImage } from 'electron'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { figmaFileKey, figmaNodeId, type FigmaFileFrames, type FrameThumbnail } from '../../shared/figma'
import { writeFileAtomic } from '../files'
import { log } from '../log'
import type { SettingsStore } from '../settings/settingsStore'
import { createFigmaClient, FigmaError, type FigmaClient } from './client'

/**
 * Protocolo de solo lectura para las miniaturas: `table-figma://thumb/<archivo>/<nodo>?v=<fecha>`.
 * La clave del archivo va en la ruta: el host se pasa a minúsculas y la clave distingue mayúsculas.
 */
export const FIGMA_THUMB_PROTOCOL = 'table-figma'

/** Lado mayor de una miniatura guardada, en px: de sobra para una tarjeta. */
const THUMB_MAX_SIDE = 640
/** Escala con la que Figma renderiza antes de reducir; menos tráfico que 1:1. */
const RENDER_SCALE = 0.5
/** Nodos por petición de imágenes: la URL lleva todos los IDs. */
const IDS_PER_REQUEST = 50

const FILE_KEY = /^[A-Za-z0-9]{10,64}$/
const NODE_FILE = /^[0-9]+-[0-9]+$/

interface ThumbMeta {
  readonly name: string
  readonly pageName: string | null
  readonly fetchedAt: string
}

export interface FrameService {
  /** Páginas y frames de primer nivel del archivo de la URL. */
  listFrames(fileUrl: string): Promise<FigmaFileFrames>
  /** Pide a Figma las miniaturas de esas URLs de frame (en lote por archivo) y las guarda. */
  fetchThumbnails(frameUrls: readonly string[]): Promise<void>
  /** Miniatura guardada del frame de la URL, o null. */
  thumbnail(frameUrl: string): Promise<FrameThumbnail | null>
  /** Bytes JPEG de una miniatura para el protocolo; null si la ruta no es válida o no existe. */
  readThumbnail(fileKey: string, nodeFile: string): Promise<Buffer | null>
  /** Borra las miniaturas guardadas (al quitar el token). */
  clearCache(): Promise<void>
}

export function createFrameService(
  settings: SettingsStore,
  userData: string,
  fileHosts?: readonly string[],
  apiBase?: () => string | undefined,
): FrameService {
  const cacheDir = join(userData, 'figma-cache')
  /** Últimos frames leídos por archivo: dan nombre y página a las miniaturas sin otra consulta. */
  const known = new Map<string, FigmaFileFrames>()
  /** Lecturas de archivo en curso: dos peticiones seguidas comparten una consulta a Figma. */
  const pendingFrames = new Map<string, Promise<FigmaFileFrames>>()
  /** Sube al quitar el token: el trabajo empezado antes no vuelve a escribir en la caché. */
  let generation = 0

  function client(): FigmaClient {
    const token = settings.figmaToken()
    if (!token) {
      throw new FigmaError('Guarda tu token de Figma en Ajustes', 'unauthorized')
    }
    return createFigmaClient(token, apiBase?.())
  }

  const nodeFile = (nodeId: string): string => nodeId.replace(/:/g, '-')
  const paths = (fileKey: string, file: string): { image: string; meta: string } => ({
    image: join(cacheDir, fileKey, `${file}.jpg`),
    meta: join(cacheDir, fileKey, `${file}.json`),
  })

  function framesOf(fileKey: string): Promise<FigmaFileFrames> {
    const key = `${generation}:${fileKey}`
    let pending = pendingFrames.get(key)
    if (!pending) {
      const started = generation
      pending = client()
        .frames(fileKey)
        .then(frames => {
          if (started === generation) {
            known.set(fileKey, frames)
          }
          return frames
        })
        .finally(() => pendingFrames.delete(key))
      pendingFrames.set(key, pending)
    }
    return pending
  }

  function describe(fileKey: string, nodeId: string): { name: string; pageName: string | null } {
    for (const page of known.get(fileKey)?.pages ?? []) {
      const frame = page.frames.find(candidate => candidate.nodeId === nodeId)
      if (frame) {
        return { name: frame.name, pageName: page.name }
      }
    }
    return { name: 'Frame', pageName: null }
  }

  /** Reduce el PNG de Figma a JPEG con el lado mayor en THUMB_MAX_SIDE. */
  function shrink(png: Buffer): Buffer {
    const image = nativeImage.createFromBuffer(png)
    const { width, height } = image.getSize()
    if (width === 0 || height === 0) {
      throw new FigmaError('Figma devolvió una imagen vacía', 'unexpected')
    }
    const ratio = Math.min(1, THUMB_MAX_SIDE / Math.max(width, height))
    const resized = ratio < 1 ? image.resize({ width: Math.round(width * ratio), height: Math.round(height * ratio), quality: 'good' }) : image
    return resized.toJPEG(85)
  }

  return {
    async listFrames(fileUrl) {
      const fileKey = figmaFileKey(fileUrl, fileHosts)
      if (!fileKey) {
        throw new FigmaError('Esta tarjeta no es un archivo de diseño de Figma', 'not-found')
      }
      return framesOf(fileKey)
    },

    async fetchThumbnails(frameUrls) {
      const byFile = new Map<string, string[]>()
      for (const url of frameUrls) {
        const fileKey = figmaFileKey(url, fileHosts)
        const nodeId = figmaNodeId(url)
        if (fileKey && nodeId) {
          byFile.set(fileKey, [...(byFile.get(fileKey) ?? []), nodeId])
        }
      }
      const started = generation
      const figma = client()
      for (const [fileKey, nodeIds] of byFile) {
        if (!known.has(fileKey)) {
          await framesOf(fileKey)
        }
        for (let start = 0; start < nodeIds.length; start += IDS_PER_REQUEST) {
          const batch = nodeIds.slice(start, start + IDS_PER_REQUEST)
          const urls = await figma.imageUrls(fileKey, batch, RENDER_SCALE)
          for (const nodeId of batch) {
            const url = urls.get(nodeId)
            if (!url) {
              log('figma-thumbnail-missing', { reason: 'not-rendered' })
              continue
            }
            const target = paths(fileKey, nodeFile(nodeId))
            const meta: ThumbMeta = { ...describe(fileKey, nodeId), fetchedAt: new Date().toISOString() }
            const jpeg = shrink(await figma.download(url))
            // Si se quitó el token mientras tanto, no se guarda nada (y se borra lo recién escrito).
            if (started !== generation) {
              return
            }
            await writeFileAtomic(target.image, jpeg)
            await writeFileAtomic(target.meta, JSON.stringify(meta))
            if (started !== generation) {
              await Promise.all([rm(target.image, { force: true }), rm(target.meta, { force: true })])
              return
            }
          }
        }
      }
      log('figma-thumbnails', { files: byFile.size, frames: frameUrls.length })
    },

    async thumbnail(frameUrl) {
      const fileKey = figmaFileKey(frameUrl, fileHosts)
      const nodeId = figmaNodeId(frameUrl)
      if (!fileKey || !nodeId || !settings.figmaView().connected) {
        return null
      }
      const file = nodeFile(nodeId)
      try {
        const meta = JSON.parse(await readFile(paths(fileKey, file).meta, 'utf8')) as Partial<ThumbMeta>
        if (typeof meta.name !== 'string' || typeof meta.fetchedAt !== 'string') {
          return null
        }
        return {
          name: meta.name,
          pageName: typeof meta.pageName === 'string' ? meta.pageName : null,
          fetchedAt: meta.fetchedAt,
          src: `${FIGMA_THUMB_PROTOCOL}://thumb/${fileKey}/${file}?v=${encodeURIComponent(meta.fetchedAt)}`,
        }
      } catch {
        return null
      }
    },

    async readThumbnail(fileKey, file) {
      if (!FILE_KEY.test(fileKey) || !NODE_FILE.test(file)) {
        return null
      }
      return readFile(paths(fileKey, file).image).catch(() => null)
    },

    async clearCache() {
      generation += 1
      known.clear()
      pendingFrames.clear()
      await rm(cacheDir, { recursive: true, force: true })
    },
  }
}
