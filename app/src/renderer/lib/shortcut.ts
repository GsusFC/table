/**
 * Atajo para volver al lienzo desde una web (T-001). La web lo intercepta en
 * el proceso principal; aquí se repite para cuando el foco está en la barra.
 * `Esc` solo no se reserva: debe llegar a la web.
 */
const isMac = window.table.platform === 'darwin'

export const EXIT_SHORTCUT_LABEL = isMac ? '⌘⇧Esc' : 'Ctrl+Shift+Esc'

export function isExitShortcut(event: KeyboardEvent): boolean {
  const primary = isMac ? event.metaKey : event.ctrlKey
  return event.key === 'Escape' && event.shiftKey && primary && !event.altKey
}
