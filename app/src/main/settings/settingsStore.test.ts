import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import type * as FileSystem from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSettingsStore, MAX_CUSTOM_PROFILES, type SecretBox } from './settingsStore'

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof FileSystem>()
  return { ...actual, writeFile: vi.fn(actual.writeFile) }
})

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

describe('identidad de la conexión de Notion', () => {
  const accountA = { client: { client_id: 'cliente-a' }, tokens: { access_token: 'token-a' } }
  const accountB = { client: { client_id: 'cliente-b' }, tokens: { access_token: 'token-b' } }
  const identityA = { workspaceName: 'Espacio A', userName: 'Persona A' }
  const identityB = { workspaceName: 'Espacio B', userName: 'Persona B' }

  it('descarta dentro de la cola una renovación de A tras desconectar y conectar B', async () => {
    const store = createSettingsStore(userData, box)
    await store.connectNotion(accountA, identityA)
    const revisionA = store.revision()
    const disconnected = store.disconnectNotion()
    const connectedB = store.connectNotion(accountB, identityB)
    const lateRefresh = store.updateNotionConnection({ ...accountA, tokens: { access_token: 'token-a-renovado' } }, revisionA)
    await Promise.all([disconnected, connectedB, lateRefresh])

    expect(store.revision()).toBe(revisionA + 2)
    expect(store.notionConnection()).toEqual(accountB)
    expect(store.notionView()).toEqual({ connected: true, ...identityB })
    expect(createSettingsStore(userData, box).notionConnection()).toEqual(accountB)
  })

  it('una rotación válida conserva la identidad y revisión; una tardía no revive la conexión', async () => {
    const store = createSettingsStore(userData, box)
    await store.connectNotion(accountA, identityA)
    const revision = store.revision()
    const rotated = { ...accountA, tokens: { access_token: 'nuevo-acceso', refresh_token: 'nueva-renovacion' } }
    await store.updateNotionConnection(rotated, revision)
    expect(store.notionConnection()).toEqual(rotated)
    expect(createSettingsStore(userData, box).notionConnection()).toEqual(rotated)
    expect(store.notionView()).toEqual({ connected: true, ...identityA })
    expect(store.revision()).toBe(revision)

    await store.disconnectNotion()
    const disconnectedFile = await readFile(join(userData, 'settings.json'), 'utf8')
    await store.updateNotionConnection(accountA, revision)
    expect(store.notionConnection()).toBeNull()
    expect(store.revision()).toBe(revision + 1)
    expect(await readFile(join(userData, 'settings.json'), 'utf8')).toBe(disconnectedFile)
  })

  it('no persiste una autorización cancelada mientras espera en la cola', async () => {
    const store = createSettingsStore(userData, box)
    await store.connectNotion(accountA, identityA)
    const revision = store.revision()
    const controller = new AbortController()
    const previous = store.connectFigma('token-sintetico', 'Persona sintética')
    const pending = store.connectNotion(accountB, identityB, controller.signal)
    const rejected = expect(pending).rejects.toThrow('cancelada')
    controller.abort(new Error('Autorización cancelada'))
    await previous
    await rejected

    expect(store.notionConnection()).toEqual(accountA)
    expect(store.notionView()).toEqual({ connected: true, ...identityA })
    expect(store.revision()).toBe(revision)
    expect(createSettingsStore(userData, box).notionConnection()).toEqual(accountA)
  })

  it('cancelar después de escribir el temporal no sustituye ajustes ni sube la revisión', async () => {
    const actual = await vi.importActual<typeof FileSystem>('node:fs/promises')
    const store = createSettingsStore(userData, box)
    await store.connectNotion(accountA, identityA)
    const revision = store.revision()
    const before = await readFile(join(userData, 'settings.json'), 'utf8')
    const written = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    vi.mocked(writeFile).mockImplementationOnce(async (...args) => {
      await actual.writeFile(...args)
      written.resolve()
      await release.promise
    })
    const controller = new AbortController()
    const pending = store.connectNotion(accountB, identityB, controller.signal)
    const rejected = expect(pending).rejects.toThrow('cancelada')
    await written.promise
    controller.abort(new Error('Autorización cancelada'))
    release.resolve()
    await rejected
    expect(store.notionConnection()).toEqual(accountA)
    expect(store.notionView()).toEqual({ connected: true, ...identityA })
    expect(store.revision()).toBe(revision)
    expect(await readFile(join(userData, 'settings.json'), 'utf8')).toBe(before)
    expect(createSettingsStore(userData, box).notionConnection()).toEqual(accountA)
    expect(await readdir(userData)).toEqual(['settings.json'])

    await store.connectNotion(accountB, identityB)
    expect(store.notionConnection()).toEqual(accountB)
    expect(store.revision()).toBe(revision + 1)
  })
})
