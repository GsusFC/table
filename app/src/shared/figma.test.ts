import { describe, expect, it } from 'vitest'
import { figmaFileKey, figmaFrameUrl, figmaNodeId } from './figma'

describe('figmaFileKey', () => {
  it('lee la clave de archivos de diseño', () => {
    expect(figmaFileKey('https://www.figma.com/design/AbC123xyzQ/Mesa?node-id=1-2')).toBe('AbC123xyzQ')
    expect(figmaFileKey('https://figma.com/file/ZZZ000fake/Boceto')).toBe('ZZZ000fake')
  })

  it('descarta otras rutas, otros dominios y hosts locales salvo que se permitan', () => {
    expect(figmaFileKey('https://www.figma.com/board/Fake42Board/Pizarra')).toBeNull()
    expect(figmaFileKey('https://www.figma.com/files/recents-and-sharing')).toBeNull()
    expect(figmaFileKey('https://evilfigma.com/design/AbC123xyzQ/x')).toBeNull()
    expect(figmaFileKey('http://127.0.0.1:4000/design/AbC123xyzQ/x')).toBeNull()
    expect(figmaFileKey('http://127.0.0.1:4000/design/AbC123xyzQ/x', ['figma.com', '127.0.0.1'])).toBe('AbC123xyzQ')
  })
})

describe('figmaNodeId y figmaFrameUrl', () => {
  it('convierten entre node-id de la URL e ID de la API', () => {
    expect(figmaNodeId('https://www.figma.com/design/AbC123xyzQ/Mesa?node-id=12-34')).toBe('12:34')
    expect(figmaNodeId('https://www.figma.com/design/AbC123xyzQ/Mesa?node-id=12%3A34')).toBe('12:34')
    expect(figmaNodeId('https://www.figma.com/design/AbC123xyzQ/Mesa')).toBeNull()
    expect(figmaNodeId('https://www.figma.com/design/AbC123xyzQ/Mesa?node-id=abc')).toBeNull()
    expect(figmaFrameUrl('https://www.figma.com/design/AbC123xyzQ/Mesa?t=x&node-id=0-1', '12:34')).toBe(
      'https://www.figma.com/design/AbC123xyzQ/Mesa?node-id=12-34',
    )
  })
})
