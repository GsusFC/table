import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSettingsStore, MAX_CUSTOM_PROFILES, type SecretBox } from './settingsStore'

let userData: string

/** Cifrado falso y reversible: estas pruebas no dependen del llavero. */
const box: SecretBox = {
  isAvailable: () => true,
  encrypt: plain => Buffer.from(plain.split('').reverse().join('')),
  decrypt: encrypted => encrypted.toString().split('').reverse().join(''),
}

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'table-settings-'))
})

afterEach(async () => {
  await rm(userData, { recursive: true, force: true })
})

describe('perfiles propios de terminal', () => {
  it('se validan, se guardan en claro y se conservan al reabrir', async () => {
    const store = createSettingsStore(userData, box)
    const added = await store.addCustomProfile({ name: '  Mi   agente ', command: ' mi-agente --modo rápido ' })
    expect(added).toMatchObject({ name: 'Mi agente', command: 'mi-agente --modo rápido' })
    expect(added.id).toMatch(/^custom:[0-9a-f-]{36}$/)
    await expect(store.addCustomProfile({ name: 'Dos líneas', command: 'a\nb' })).rejects.toThrow()
    await expect(store.addCustomProfile({ name: '', command: 'a' })).rejects.toThrow()
    await expect(store.addCustomProfile({ name: 'x'.repeat(61), command: 'a' })).rejects.toThrow()
    await expect(store.addCustomProfile({ name: 'Largo', command: 'a'.repeat(501) })).rejects.toThrow()

    expect(await readFile(join(userData, 'settings.json'), 'utf8')).toContain('mi-agente --modo rápido')
    expect(createSettingsStore(userData, box).customProfiles()).toEqual([added])

    await store.removeCustomProfile(added.id)
    await store.removeCustomProfile(added.id)
    expect(createSettingsStore(userData, box).customProfiles()).toEqual([])
  })

  it(`admite hasta ${MAX_CUSTOM_PROFILES}`, async () => {
    const store = createSettingsStore(userData, box)
    await Promise.all(Array.from({ length: MAX_CUSTOM_PROFILES }, (_, i) => store.addCustomProfile({ name: `P${i}`, command: 'true' })))
    await expect(store.addCustomProfile({ name: 'Uno más', command: 'true' })).rejects.toThrow()
    expect(store.customProfiles()).toHaveLength(MAX_CUSTOM_PROFILES)
  })

  it('lee ajustes anteriores sin perfiles y descarta los dañados', async () => {
    const valid = { id: 'custom:11111111-1111-4111-8111-111111111111', name: 'Bueno', command: 'bueno' }
    await writeFile(
      join(userData, 'settings.json'),
      JSON.stringify({
        version: 2,
        notion: { connection: null, workspaceName: null, userName: null },
        terminal: { customProfiles: [valid, { id: 'claude', name: 'Falso', command: 'x' }, { id: valid.id, name: 'Repetido', command: 'x' }, { ...valid, id: 'custom:22222222-2222-4222-8222-222222222222', command: 'a\nb' }] },
      }),
    )
    const store = createSettingsStore(userData, box)
    expect(store.customProfiles()).toEqual([valid])
    expect(store.figmaView().connected).toBe(false)

    await writeFile(join(userData, 'settings.json'), JSON.stringify({ version: 2, notion: { connection: null, workspaceName: null, userName: null } }))
    expect(createSettingsStore(userData, box).customProfiles()).toEqual([])
  })
})
