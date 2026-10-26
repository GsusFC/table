import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProfileCatalog, loginShellDetector } from './profiles'

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const CUSTOM = { id: 'custom:11111111-1111-4111-8111-111111111111', name: 'Mío', command: 'mi-agente --rápido' }

describe('catálogo de perfiles', () => {
  it('marca los arneses instalados, ofrece siempre la terminal y añade los propios', async () => {
    const catalog = createProfileCatalog(async () => new Set(['claude', 'pi']), () => [CUSTOM])
    const profiles = await catalog.list()
    expect(profiles.map(profile => [profile.id, profile.available])).toEqual([
      ['claude', true],
      ['codex', false],
      ['gemini', false],
      ['opencode', false],
      ['omp', false],
      ['pi', true],
      ['shell', true],
      [CUSTOM.id, true],
    ])
    expect(catalog.get('shell')?.command).toBeNull()
    expect(catalog.get(CUSTOM.id)).toMatchObject({ source: 'custom', command: CUSTOM.command })
    expect(catalog.get('nope')).toBeUndefined()
  })

  it('no vuelve a buscar antes de un minuto y conserva el resultado si la búsqueda falla', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const detect = vi.fn<() => Promise<ReadonlySet<string>>>().mockResolvedValueOnce(new Set(['codex'])).mockRejectedValueOnce(new Error('timeout'))
    const catalog = createProfileCatalog(detect, () => [])
    await catalog.list()
    await catalog.list()
    expect(detect).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + 61_000)
    const profiles = await catalog.list()
    expect(detect).toHaveBeenCalledTimes(2)
    expect(profiles.find(profile => profile.id === 'codex')?.available).toBe(true)
  })
})

describe('loginShellDetector', () => {
  it('encuentra los ejecutables con el PATH del shell de inicio de sesión', async () => {
    const found = await loginShellDetector('/bin/sh', { PATH: '/usr/bin:/bin', HOME: '/nonexistent' })(['sh', 'no-existe-este-binario'])
    expect([...found]).toEqual(['sh'])
  })
})
