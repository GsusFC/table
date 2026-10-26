/** Copia texto; si la API asíncrona no está disponible, usa `execCommand`. */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    // Sigue con el método clásico.
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.append(area)
  area.select()
  const copied = document.execCommand('copy')
  area.remove()
  if (!copied) {
    throw new Error('No se pudo copiar al portapapeles')
  }
}
