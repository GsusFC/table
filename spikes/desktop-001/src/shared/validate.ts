import type { SurfaceBounds } from './ipc'

const MAX_URL_LENGTH = 2048
const MAX_DIMENSION = 16384
export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 3

export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export function parseHttpUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) {
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

export function parseBounds(value: unknown): SurfaceBounds {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Límites no válidos')
  }
  const record = value as Record<string, unknown>
  const read = (key: keyof SurfaceBounds): number => {
    const n = record[key]
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > MAX_DIMENSION) {
      throw new Error(`Límite no válido: ${key}`)
    }
    return Math.round(n)
  }
  return { x: read('x'), y: read('y'), width: read('width'), height: read('height') }
}

export function parseZoomFactor(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < ZOOM_MIN || value > ZOOM_MAX) {
    throw new Error('Zoom no válido')
  }
  return Math.round(value * 100) / 100
}
