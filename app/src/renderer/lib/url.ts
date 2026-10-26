import { normalizeUrlInput } from '../../shared/services'
import { parseHttpUrl } from '../../shared/validate'

export type UrlInputResult = { readonly ok: true; readonly url: string } | { readonly ok: false; readonly error: string }

/**
 * Lo que escribe el usuario → URL http(s) normalizada, o el motivo del rechazo.
 * El proceso principal vuelve a validar; esto solo da el error en el sitio.
 */
export function readUrlInput(input: string): UrlInputResult {
  if (input.trim().length === 0) {
    return { ok: false, error: 'Escribe una URL' }
  }
  try {
    return { ok: true, url: parseHttpUrl(normalizeUrlInput(input)) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'URL no válida' }
  }
}

/**
 * Al pegar sobre el lienzo no hay campo que corregir: solo se acepta lo que
 * claramente es una dirección (esquema explícito o un host con punto), para
 * que pegar una palabra suelta no cree una tarjeta.
 */
export function readPastedUrls(text: string): string[] {
  const urls: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const candidate = line.trim()
    if (candidate.length === 0 || /\s/.test(candidate)) {
      continue
    }
    const result = readUrlInput(candidate)
    if (!result.ok) {
      continue
    }
    const explicit = /^https?:\/\//i.test(candidate)
    if (explicit || new URL(result.url).hostname.includes('.')) {
      urls.push(result.url)
    }
  }
  return urls
}
