/**
 * Atajo para volver a Table desde la web. No se reserva `Esc`: editores como
 * Figma lo usan, así que debe llegar a la página.
 */
export interface ShortcutInput {
  readonly type: string
  readonly key: string
  readonly shift: boolean
  readonly meta: boolean
  readonly control: boolean
  readonly alt: boolean
}

export function isExitShortcut(input: ShortcutInput, platform: string): boolean {
  const primary = platform === 'darwin' ? input.meta : input.control
  return input.type === 'keyDown' && input.key === 'Escape' && input.shift && primary && !input.alt
}
