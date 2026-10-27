import { describe, expect, it } from 'vitest'
import { sanitizePaste } from './paste'

describe('sanitizePaste', () => {
  it('quita el fin de pegado entre corchetes y deja el resto como texto', () => {
    const text = sanitizePaste('nota\x1b[201~\rprintf PWNED\r')
    expect(text).toBe('nota[201~\nprintf PWNED\n')
    expect(text).not.toContain('\x1b')
    expect(text).not.toContain('\r')
  })

  it('normaliza los finales de línea a \\n', () => {
    expect(sanitizePaste('a\r\nb\rc\nd')).toBe('a\nb\nc\nd')
  })

  it('conserva tabuladores, saltos de línea y texto no ASCII', () => {
    expect(sanitizePaste('— Nota\t«año» 🙂\n')).toBe('— Nota\t«año» 🙂\n')
  })

  it('quita los demás controles C0, DEL y C1', () => {
    expect(sanitizePaste('a\x00b\x03c\x04d\x07e\x08f\x0bg\x0ch\x7fi\x9bj\x85k')).toBe('abcdefghijk')
  })
})
