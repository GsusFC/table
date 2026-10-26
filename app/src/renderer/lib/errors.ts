/** Quita el prefijo que Electron añade a los errores de `ipcRenderer.invoke`. */
export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']+': (?:[A-Za-z]*Error: )?/, '')
}
