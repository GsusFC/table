import { describe, expect, it } from 'vitest'
import {
  SERVICES,
  WEB_SERVICE,
  normalizeUrlInput,
  recognizeService,
  serviceById,
} from './services'

// Todas las URLs son sintéticas: ids y espacios inventados.
const cases: ReadonlyArray<readonly [url: string, serviceId: string]> = [
  // Figma
  ['https://www.figma.com/design/AbC123xyz/Mesa-de-prueba?node-id=1-2', 'figma'],
  ['https://figma.com/file/ZZZ000fake/Boceto', 'figma'],
  ['https://www.figma.com/board/Fake42Board/Pizarra', 'figma'],
  ['https://www.figma.com/proto/Fake42Proto/Flujo?page-id=0%3A1', 'figma'],
  ['https://www.figma.com/slides/Fake42Slides/Presentacion', 'figma'],
  ['https://www.figma.com/make/Fake42Make/Prototipo', 'figma'],
  ['https://www.figma.com/site/Fake42Site/Web', 'figma'],
  ['https://www.figma.com/files/recents-and-sharing', 'figma'],
  ['https://www.figma.com/', 'figma'],
  ['https://WWW.FIGMA.COM/design/AbC123xyz/Mayusculas', 'figma'],
  // Notion
  ['https://www.notion.so/espacio-inventado/Pagina-0123456789abcdef0123456789abcdef', 'notion'],
  ['https://notion.so/0123456789abcdef0123456789abcdef', 'notion'],
  ['https://espacio-inventado.notion.site/Pagina-publica-0123456789abcdef', 'notion'],
  ['https://notion.site/Pagina-0123456789abcdef', 'notion'],
  ['https://app.notion.com/p/0123456789abcdef', 'notion'],
  ['https://www.notion.com/product', 'notion'],
  ['https://notion.com/', 'notion'],
  // Pinterest
  ['https://www.pinterest.com/pin/1234567890123456/', 'pinterest'],
  ['https://pinterest.com/usuario-inventado/tablero/', 'pinterest'],
  ['https://es.pinterest.com/pin/1234567890123456/', 'pinterest'],
  ['https://www.pinterest.es/usuario-inventado/', 'pinterest'],
  ['https://pinterest.es/pin/1234567890123456/', 'pinterest'],
  ['https://www.pinterest.co.uk/pin/1234567890123456/', 'pinterest'],
  ['https://www.pinterest.com.mx/pin/1234567890123456/', 'pinterest'],
  ['https://fr.pinterest.com/pin/1234567890123456/', 'pinterest'],
  ['https://www.pinterest.de/usuario-inventado/', 'pinterest'],
  ['https://pin.it/AbCdEf123', 'pinterest'],
  // Web genérica
  ['https://example.com/', 'web'],
  ['http://localhost:3000/', 'web'],
  ['https://192.168.1.10/panel', 'web'],
  // Dominios engañosos
  ['https://evilfigma.com/design/AbC123xyz', 'web'],
  ['https://figma.com.evil.net/design/AbC123xyz', 'web'],
  ['https://notfigma.com/', 'web'],
  ['https://example.com/www.figma.com/design/AbC123xyz', 'web'],
  ['https://example.com/?u=https://www.notion.so/x', 'web'],
  ['https://mynotion.so/', 'web'],
  ['https://notion.so.evil.net/', 'web'],
  ['https://fakenotion.site/', 'web'],
  ['https://notion.site.example.com/', 'web'],
  ['https://notpinterest.com/', 'web'],
  ['https://pinterest.com.evil.net/', 'web'],
  ['https://pinterest.evil.net/', 'web'],
  ['https://spin.it/', 'web'],
  ['https://pin.it.evil.net/', 'web'],
  ['https://figma.com@evil.net/', 'web'],
]

describe('recognizeService', () => {
  it.each(cases)('%s → %s', (url, serviceId) => {
    expect(recognizeService(url).id).toBe(serviceId)
  })

  it('devuelve WEB_SERVICE si la URL no se puede analizar', () => {
    expect(recognizeService('no es una url')).toBe(WEB_SERVICE)
    expect(recognizeService('')).toBe(WEB_SERVICE)
  })
})

describe('catálogo', () => {
  it('mantiene el orden y los ids estables', () => {
    expect(SERVICES.map((service) => service.id)).toEqual(['figma', 'notion', 'pinterest'])
  })

  it('tiene ids únicos, sin incluir web', () => {
    const ids = SERVICES.map((service) => service.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).not.toContain(WEB_SERVICE.id)
  })

  it.each([...SERVICES, WEB_SERVICE])('$id tiene distintivo válido', (service) => {
    expect(service.badge.monogram).toMatch(/^.{1,2}$/u)
    expect(service.badge.color).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('usa los monogramas acordados', () => {
    expect(serviceById('figma').badge.monogram).toBe('F')
    expect(serviceById('notion').badge.monogram).toBe('N')
    expect(serviceById('pinterest').badge.monogram).toBe('P')
    expect(WEB_SERVICE).toMatchObject({ id: 'web', name: 'Web' })
  })
})

describe('serviceById', () => {
  it.each([
    ['figma', 'Figma'],
    ['notion', 'Notion'],
    ['pinterest', 'Pinterest'],
    ['web', 'Web'],
  ])('%s → %s', (id, name) => {
    expect(serviceById(id).name).toBe(name)
  })

  it.each(['servicio-retirado', '', 'Figma'])('id desconocido %j → WEB_SERVICE', (id) => {
    expect(serviceById(id)).toBe(WEB_SERVICE)
  })
})

describe('normalizeUrlInput', () => {
  it.each([
    ['figma.com/design/AbC123xyz', 'https://figma.com/design/AbC123xyz'],
    ['  www.notion.so/pagina  ', 'https://www.notion.so/pagina'],
    ['\tpin.it/AbCdEf123\n', 'https://pin.it/AbCdEf123'],
    ['https://example.com/', 'https://example.com/'],
    ['  http://example.com  ', 'http://example.com'],
    ['HTTPS://EXAMPLE.COM', 'HTTPS://EXAMPLE.COM'],
    ['//example.com/ruta', 'https://example.com/ruta'],
    ['localhost:3000', 'localhost:3000'],
    ['mailto:alguien@example.com', 'mailto:alguien@example.com'],
    ['ftp://example.com', 'ftp://example.com'],
    ['', ''],
    ['   ', ''],
  ])('%j → %j', (input, expected) => {
    expect(normalizeUrlInput(input)).toBe(expected)
  })
})

describe('ampliar el catálogo', () => {
  // Criterio de T-002: un servicio nuevo es solo una entrada más del catálogo.
  const miro = {
    id: 'miro',
    name: 'Miro',
    badge: { monogram: 'M', color: '#ffd02f' },
    matches: (url: URL) => url.hostname === 'miro.com' || url.hostname.endsWith('.miro.com'),
  }
  const catalog = [...SERVICES, miro]

  it('reconoce el servicio añadido sin afectar a los existentes', () => {
    expect(recognizeService('https://miro.com/app/board/uXjVFake=/', catalog).id).toBe('miro')
    expect(recognizeService('https://www.figma.com/design/AbC123xyz/Prueba', catalog).id).toBe('figma')
    expect(recognizeService('https://example.com/', catalog).id).toBe(WEB_SERVICE.id)
  })

  it('lo resuelve por id para pintar su distintivo', () => {
    expect(serviceById('miro', catalog).badge.monogram).toBe('M')
    expect(serviceById('miro').id).toBe(WEB_SERVICE.id)
  })
})
