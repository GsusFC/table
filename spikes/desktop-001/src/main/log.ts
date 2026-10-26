/** Registro estructurado. Solo orígenes, nunca rutas ni parámetros de URL. */
export function log(event: string, details: Record<string, unknown> = {}): void {
  console.log(`[t001] ${JSON.stringify({ ts: new Date().toISOString(), event, ...details })}`)
}

export function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return 'invalid'
  }
}
