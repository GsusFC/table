/**
 * Catálogo de servicios reconocidos por URL (D-012, P-013). Un servicio solo
 * aporta reconocimiento y presentación; todas las tarjetas son web y tienen el
 * mismo ciclo de vida.
 *
 * Cómo añadir un servicio: añade un objeto `ServiceDefinition` a SERVICES con
 * un `id` estable (se guarda en las mesas; no lo cambies después), su `name`,
 * su `badge` y un `matches` que reconozca el hostname con `hostIs`, sin
 * comparaciones de subcadena. No hay que tocar nada más: el resto de la app
 * obtiene el servicio con `recognizeService` y `serviceById`. Si se retira un
 * servicio, las tarjetas guardadas con su id se muestran como WEB_SERVICE.
 */

export interface ServiceBadge {
  /** Una o dos letras para el distintivo de la tarjeta. */
  readonly monogram: string
  /** Color del distintivo en hexadecimal `#rrggbb`. */
  readonly color: string
}

export interface ServiceDefinition {
  readonly id: string
  /** Nombre visible, p. ej. «Figma». */
  readonly name: string
  readonly badge: ServiceBadge
  /** Recibe una URL http(s) ya validada. */
  matches(url: URL): boolean
}

/**
 * Verdadero si el host es `domain` o un subdominio suyo. El sufijo exige el
 * punto: `evilfigma.com` y `figma.com.evil.net` no son `figma.com`.
 */
function hostIs(url: URL, domain: string): boolean {
  // `URL` ya da el hostname en minúsculas; se ignora el punto final de FQDN.
  const host = url.hostname.replace(/\.$/, '')
  return host === domain || host.endsWith(`.${domain}`)
}

/** Dominios locales de Pinterest (`pinterest.<tld>`). */
const PINTEREST_TLDS = [
  'com',
  'es',
  'de',
  'fr',
  'it',
  'pt',
  'ca',
  'ch',
  'at',
  'ie',
  'dk',
  'se',
  'nz',
  'jp',
  'ru',
  'cl',
  'ph',
  'co.uk',
  'co.kr',
  'com.au',
  'com.mx',
  'com.ar',
  'com.br',
  'com.co',
  'com.pe',
] as const

export const WEB_SERVICE: ServiceDefinition = {
  id: 'web',
  name: 'Web',
  badge: { monogram: 'W', color: '#6b7280' },
  matches: () => true,
}

/** En orden de prioridad; WEB_SERVICE no forma parte de la lista. */
export const SERVICES: readonly ServiceDefinition[] = [
  {
    id: 'figma',
    name: 'Figma',
    badge: { monogram: 'F', color: '#a259ff' },
    // Archivos (/design/, /file/, /board/, /proto/, /slides/, /make/, /site/)
    // y cualquier otra ruta de figma.com.
    matches: (url) => hostIs(url, 'figma.com'),
  },
  {
    id: 'notion',
    name: 'Notion',
    badge: { monogram: 'N', color: '#37352f' },
    // notion.so, notion.com (incl. app.notion.com) y páginas publicadas en
    // notion.site o <espacio>.notion.site.
    matches: (url) =>
      hostIs(url, 'notion.so') || hostIs(url, 'notion.com') || hostIs(url, 'notion.site'),
  },
  {
    id: 'pinterest',
    name: 'Pinterest',
    badge: { monogram: 'P', color: '#c8232c' },
    // pinterest.<tld local> con o sin www. o subdominio de idioma, y el
    // acortador pin.it.
    matches: (url) =>
      hostIs(url, 'pin.it') || PINTEREST_TLDS.some((tld) => hostIs(url, `pinterest.${tld}`)),
  },
]

/** Primer servicio que reconoce la URL, o WEB_SERVICE. La URL ya es http(s) válida. */
export function recognizeService(url: string): ServiceDefinition {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return WEB_SERVICE
  }
  return SERVICES.find((service) => service.matches(parsed)) ?? WEB_SERVICE
}

/** Por id; WEB_SERVICE si el id no existe (p. ej. un servicio retirado). */
export function serviceById(id: string): ServiceDefinition {
  if (id === WEB_SERVICE.id) return WEB_SERVICE
  return SERVICES.find((service) => service.id === id) ?? WEB_SERVICE
}

/**
 * Convierte lo que escribe o pega el usuario en una URL candidata: recorta
 * espacios y añade `https://` si no hay esquema. No valida: eso es `parseHttpUrl`.
 */
export function normalizeUrlInput(input: string): string {
  const trimmed = input.trim()
  if (trimmed === '') return trimmed
  if (trimmed.startsWith('//')) return `https:${trimmed}`
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}
