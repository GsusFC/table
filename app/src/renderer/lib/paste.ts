/**
 * Texto que Table pega en un terminal («Enviar al agente»). Viene de notas,
 * títulos y nombres de archivo: cualquiera puede llevar secuencias de control.
 * Un `ESC [201~` cerraría antes el pegado entre corchetes y el salto de línea
 * siguiente haría de Intro, así que solo quedan texto, saltos de línea y
 * tabuladores. Los finales de línea `\r\n` y `\r` pasan a `\n`.
 */
export function sanitizePaste(text: string): string {
  return (
    text
      .replace(/\r\n?/g, '\n')
      // C0 (salvo \t y \n), DEL y C1; ESC incluido.
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
  )
}
