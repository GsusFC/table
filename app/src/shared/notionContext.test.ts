import { describe, expect, it } from 'vitest'
import { DEFAULT_NOTION_SELECTION, isPageSelected, parseNotionSelections, toggleBase, togglePage, type NotionBaseSelection, type NotionPageSelection } from './notionContext'

const BASE = 'collection://77777777-2222-4333-8444-555555555555'
const A = '10000000bbbb4ccc8dddeeeeeeeeeeee'
const B = '20000000bbbb4ccc8dddeeeeeeeeeeee'
const C = '30000000bbbb4ccc8dddeeeeeeeeeeee'
/** Una página que no aparece en el árbol mostrado (p. ej. más allá de las filas que Table lista). */
const HIDDEN = '40000000bbbb4ccc8dddeeeeeeeeeeee'
const NEW = '50000000bbbb4ccc8dddeeeeeeeeeeee'

const withBase = (base: NotionBaseSelection): NotionPageSelection => ({ body: true, bases: { [BASE]: base } })

describe('selección de páginas', () => {
  it('por defecto entra todo, también lo nuevo', () => {
    expect(isPageSelected(DEFAULT_NOTION_SELECTION, BASE, NEW)).toBe(true)
  })

  it('desmarcar una página la deja fuera y una página nueva de la base entra', () => {
    const selection = withBase(togglePage(undefined, B, false))
    expect(selection.bases[BASE]).toEqual({ mode: 'all-except', pages: [B] })
    expect(isPageSelected(selection, BASE, B)).toBe(false)
    expect(isPageSelected(selection, BASE, A)).toBe(true)
    expect(isPageSelected(selection, BASE, NEW)).toBe(true)
  })

  it('desmarcar la base deja fuera también las páginas nuevas', () => {
    const selection = withBase(toggleBase(undefined, [A, B], false))
    expect(isPageSelected(selection, BASE, A)).toBe(false)
    expect(isPageSelected(selection, BASE, NEW)).toBe(false)
  })

  it('en una base desmarcada, marcar páginas sueltas no cambia el modo: las nuevas siguen fuera', () => {
    const off = toggleBase(undefined, [A, B], false)
    const some = togglePage(off, A, true)
    expect(some).toEqual({ mode: 'only', pages: [A] })
    expect(isPageSelected(withBase(some), BASE, NEW)).toBe(false)
    // Marcar todas las páginas una a una tampoco cambia el modo: solo la casilla de la base lo hace.
    expect(togglePage(some, B, true)).toEqual({ mode: 'only', pages: [A, B] })
    expect(toggleBase(some, [A, B], true)).toEqual({ mode: 'all-except', pages: [] })
  })

  it('las páginas que no están en el árbol mostrado conservan su estado', () => {
    // Excluida antes y ahora fuera del árbol: marcar o desmarcar otras no la vuelve a incluir.
    const excluded: NotionBaseSelection = { mode: 'all-except', pages: [HIDDEN] }
    expect(togglePage(excluded, A, false)).toEqual({ mode: 'all-except', pages: [HIDDEN, A] })
    expect(toggleBase(excluded, [A, B, C], true)).toEqual({ mode: 'all-except', pages: [HIDDEN] })
    // Incluida en una base «solo» y fuera del árbol: desmarcar la base visible la conserva.
    const only: NotionBaseSelection = { mode: 'only', pages: [A, HIDDEN] }
    expect(toggleBase(only, [A, B], false)).toEqual({ mode: 'only', pages: [HIDDEN] })
    expect(isPageSelected(withBase(togglePage(only, B, true)), BASE, HIDDEN)).toBe(true)
  })

  it('valida lo recibido: IDs y bases bien formados, nada más', () => {
    const parsed = parseNotionSelections({
      'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE': { body: false, bases: { [BASE]: { mode: 'only', pages: [A, A] } } },
    })
    expect(parsed).toEqual({ aaaaaaaabbbb4ccc8dddeeeeeeeeeeee: { body: false, bases: { [BASE]: { mode: 'only', pages: [A] } } } })
    expect(() => parseNotionSelections({ 'no-es-un-id': DEFAULT_NOTION_SELECTION })).toThrow()
    expect(() => parseNotionSelections({ [A]: { body: true, bases: { 'https://example.com': { mode: 'only', pages: [] } } } })).toThrow()
    expect(() => parseNotionSelections({ [A]: { body: true, bases: { [BASE]: { mode: 'todo', pages: [] } } } })).toThrow()
    expect(() => parseNotionSelections({ [A]: { body: 'sí', bases: {} } })).toThrow()
  })
})
