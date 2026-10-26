/**
 * Catálogo de servicios reconocidos por URL (D-012, P-013). Un servicio solo
 * aporta reconocimiento y presentación; todas las tarjetas son web y tienen el
 * mismo ciclo de vida. Añadir un servicio es añadir una entrada a SERVICES.
 *
 * Implementación: tarea paralela «servicios» de T-002.
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

export declare const WEB_SERVICE: ServiceDefinition

/** En orden de prioridad; WEB_SERVICE no forma parte de la lista. */
export declare const SERVICES: readonly ServiceDefinition[]

/** Primer servicio que reconoce la URL, o WEB_SERVICE. La URL ya es http(s) válida. */
export declare function recognizeService(url: string): ServiceDefinition

/** Por id; WEB_SERVICE si el id no existe (p. ej. un servicio retirado). */
export declare function serviceById(id: string): ServiceDefinition

/**
 * Convierte lo que escribe o pega el usuario en una URL candidata: recorta
 * espacios y añade `https://` si no hay esquema. No valida: eso es `parseHttpUrl`.
 */
export declare function normalizeUrlInput(input: string): string
