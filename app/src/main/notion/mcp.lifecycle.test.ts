import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { StreamableHTTPClientTransportOptions } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSettingsStore } from '../settings/settingsStore'
import { authorizeNotion, createNotionMcp } from './mcp'

interface TransportDouble {
  readonly options: StreamableHTTPClientTransportOptions
  closed: boolean
  close(): Promise<void>
}

interface ClientDouble {
  transport?: TransportDouble
  closed: boolean
}

const sdk = vi.hoisted(() => ({
  clients: [] as ClientDouble[],
  transports: [] as TransportDouble[],
  connect: vi.fn<(client: ClientDouble, transport: TransportDouble) => Promise<void>>(),
  finishAuth: vi.fn<(transport: TransportDouble, code: string) => Promise<void>>(),
  callTool: vi.fn<(client: ClientDouble) => Promise<unknown>>(),
  close: vi.fn<() => Promise<void>>(),
}))

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    transport?: TransportDouble
    closed = false
    constructor() {
      sdk.clients.push(this)
    }
    async connect(transport: TransportDouble): Promise<void> {
      this.transport = transport
      await sdk.connect(this, transport)
    }
    async callTool(): Promise<unknown> {
      return sdk.callTool(this)
    }
    async close(): Promise<void> {
      this.closed = true
      await this.transport?.close()
      await sdk.close()
    }
  },
}))

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {
    closed = false
    constructor(_url: URL, readonly options: StreamableHTTPClientTransportOptions) {
      sdk.transports.push(this)
    }
    async finishAuth(code: string): Promise<void> {
      await sdk.finishAuth(this, code)
    }
    async close(): Promise<void> {
      this.closed = true
    }
  },
}))

let userData: string

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'table-notion-auth-'))
  sdk.clients.length = 0
  sdk.transports.length = 0
  sdk.connect.mockReset().mockResolvedValue(undefined)
  sdk.finishAuth.mockReset().mockResolvedValue(undefined)
  sdk.callTool.mockReset().mockResolvedValue({ content: [{ type: 'text', text: 'respuesta sintética' }] })
  sdk.close.mockReset().mockResolvedValue(undefined)
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(userData, { recursive: true, force: true })
})

describe('proveedor ligado a la identidad de Notion', () => {
  it('una renovación tardía de A no cambia B ni revive una conexión quitada', async () => {
    const settings = createSettingsStore(userData, {
      isAvailable: () => true,
      encrypt: plain => Buffer.from(plain),
      decrypt: encrypted => encrypted.toString(),
    })
    const accountA = { client: { client_id: 'cliente-a' }, tokens: { access_token: 'token-a', token_type: 'Bearer' } }
    const accountB = { client: { client_id: 'cliente-b' }, tokens: { access_token: 'token-b', token_type: 'Bearer' } }
    const identityB = { workspaceName: 'Espacio B', userName: 'Persona B' }
    await settings.connectNotion(accountA, { workspaceName: 'Espacio A', userName: 'Persona A' })
    const mcp = createNotionMcp(settings, () => 'https://example.test/mcp')
    await mcp.read('notion-fetch', { id: 'sintetica' })
    const providerA = sdk.transports[0]!.options.authProvider!
    const revisionA = settings.revision()
    const rotated = { access_token: 'token-a-rotado', refresh_token: 'renovacion-a-rotada', token_type: 'Bearer' }
    await providerA.saveTokens(rotated)
    expect(settings.notionConnection()?.tokens).toEqual(rotated)
    expect(settings.revision()).toBe(revisionA)

    await settings.disconnectNotion()
    await expect(providerA.saveTokens({ access_token: 'token-a-tardio', token_type: 'Bearer' })).rejects.toBeInstanceOf(UnauthorizedError)
    expect(settings.notionConnection()).toBeNull()
    await settings.connectNotion(accountB, identityB)
    const revisionB = settings.revision()
    await expect(providerA.saveClientInformation!({ client_id: 'cliente-a-tardio' })).rejects.toBeInstanceOf(UnauthorizedError)
    expect(settings.notionConnection()).toEqual(accountB)
    expect(settings.notionView()).toEqual({ connected: true, ...identityB })
    expect(settings.revision()).toBe(revisionB)

    await mcp.read('notion-fetch', { id: 'sintetica' })
    expect(sdk.clients[0]!.closed).toBe(true)
    expect(sdk.transports[0]!.closed).toBe(true)
    expect(await sdk.transports[1]!.options.authProvider!.clientInformation()).toEqual(accountB.client)
  })

  it('una lectura de A que termina tarde no tiene éxito ni descarta la sesión de B', async () => {
    const settings = createSettingsStore(userData, {
      isAvailable: () => true,
      encrypt: plain => Buffer.from(plain),
      decrypt: encrypted => encrypted.toString(),
    })
    await settings.connectNotion({ client: { client_id: 'a' }, tokens: {} }, { workspaceName: 'A', userName: null })
    const mcp = createNotionMcp(settings, () => 'https://example.test/mcp')
    const started = Promise.withResolvers<void>()
    const released = Promise.withResolvers<unknown>()
    sdk.callTool.mockImplementationOnce(async () => {
      started.resolve()
      return released.promise
    })
    const old = mcp.read('notion-fetch', { id: 'sintetica-a' })
    const rejected = expect(old).rejects.toMatchObject({ code: 'unauthorized' })
    await started.promise
    await settings.connectNotion({ client: { client_id: 'b' }, tokens: {} }, { workspaceName: 'B', userName: null })
    expect(await mcp.read('notion-fetch', { id: 'sintetica-b' })).toBe('respuesta sintética')
    released.resolve({ content: [{ type: 'text', text: 'respuesta antigua' }] })
    await rejected
    expect(await mcp.read('notion-fetch', { id: 'sintetica-b' })).toBe('respuesta sintética')
    expect(sdk.clients).toHaveLength(2)
    expect(sdk.clients[1]!.closed).toBe(false)
  })
})

type AuthStage = 'finishAuth' | 'connect' | 'get-self'

/** Transporte controlado: entrega el código por HTTP real y permite retener cada fase posterior. */
async function beginAuthorization(blocked?: AuthStage, failSelf = false) {
  const browser = Promise.withResolvers<URL>()
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const resumed = Promise.withResolvers<void>()
  async function pause(stage: AuthStage): Promise<void> {
    if (stage === blocked) {
      started.resolve()
      await release.promise
      resumed.resolve()
    }
  }
  sdk.connect.mockImplementation(async (client, transport) => {
    const provider = transport.options.authProvider!
    if (client === sdk.clients[0]) {
      await provider.saveClientInformation!({ client_id: 'cliente-sintetico' })
      await provider.saveCodeVerifier('verificador-sintetico')
      const url = new URL('https://example.test/authorize')
      url.searchParams.set('redirect_uri', String(provider.redirectUrl))
      url.searchParams.set('state', await provider.state!())
      await provider.redirectToAuthorization(url)
      throw new UnauthorizedError('Autorización sintética pendiente')
    }
    await pause('connect')
  })
  sdk.finishAuth.mockImplementation(async (transport, code) => {
    expect(code).toBe('codigo-sintetico')
    await pause('finishAuth')
    await transport.options.authProvider!.saveTokens({ access_token: 'token-sintetico', token_type: 'Bearer' })
  })
  sdk.callTool.mockImplementation(async () => {
    await pause('get-self')
    if (failSelf) throw new Error('Fallo sintético')
    return { content: [{ type: 'text', text: JSON.stringify({ workspace: { name: 'Espacio sintético' }, user: { name: 'Persona sintética' } }) }] }
  })
  const controller = new AbortController()
  const pending = authorizeNotion(async url => { browser.resolve(new URL(url)) }, controller.signal, 'https://example.test/mcp')
  void pending.catch(() => undefined)
  const authorizationUrl = await browser.promise
  const callbackUrl = new URL(authorizationUrl.searchParams.get('redirect_uri')!)
  callbackUrl.searchParams.set('state', authorizationUrl.searchParams.get('state')!)
  callbackUrl.searchParams.set('code', 'codigo-sintetico')
  const response = await fetch(callbackUrl)
  await response.text()
  return { controller, pending, started, release, resumed, callbackUrl }
}

describe('cancelación de toda la autorización OAuth', () => {
  it.each<AuthStage>(['finishAuth', 'connect', 'get-self'])('cancela durante %s aunque el proveedor complete más tarde', async stage => {
    const auth = await beginAuthorization(stage)
    await auth.started.promise
    auth.controller.abort()
    await expect(auth.pending).rejects.toMatchObject({ code: 'cancelled' })
    expect(sdk.clients.every(client => client.closed)).toBe(true)
    expect(sdk.transports.every(transport => transport.closed)).toBe(true)
    auth.release.resolve()
    await auth.resumed.promise
    await expect(auth.pending).rejects.toMatchObject({ code: 'cancelled' })
    const provider: OAuthClientProvider = sdk.transports[0]!.options.authProvider!
    expect(() => provider.saveTokens({ access_token: 'tardio', token_type: 'Bearer' })).toThrow()
    await expect(fetch(auth.callbackUrl)).rejects.toThrow()
  })

  it('propaga la cancelación al fetch usado por finishAuth, combinada con la del transporte', async () => {
    const auth = await beginAuthorization('finishAuth')
    await auth.started.promise
    let requestSignal: AbortSignal | undefined
    const requested = Promise.withResolvers<void>()
    vi.stubGlobal('fetch', vi.fn((_url: string | URL, init?: RequestInit) => {
      const response = Promise.withResolvers<Response>()
      requestSignal = init?.signal ?? undefined
      requested.resolve()
      requestSignal?.addEventListener('abort', () => response.reject(requestSignal?.reason), { once: true })
      return response.promise
    }))
    const transportController = new AbortController()
    const request = sdk.transports[0]!.options.fetch!('https://example.test/token', { signal: transportController.signal })
    const rejected = expect(request).rejects.toBeDefined()
    await requested.promise
    auth.controller.abort()
    await expect(auth.pending).rejects.toMatchObject({ code: 'cancelled' })
    await rejected
    expect(requestSignal?.aborted).toBe(true)
    expect(transportController.signal.aborted).toBe(false)
    auth.release.resolve()
    await auth.resumed.promise
  })

  it('cierra ambos clientes y transportes tras completar la identidad', async () => {
    const auth = await beginAuthorization()
    expect(await auth.pending).toEqual({
      connection: { client: { client_id: 'cliente-sintetico' }, tokens: { access_token: 'token-sintetico', token_type: 'Bearer' } },
      identity: { workspaceName: 'Espacio sintético', userName: 'Persona sintética' },
    })
    expect(sdk.clients).toHaveLength(2)
    expect(sdk.clients.every(client => client.closed)).toBe(true)
    expect(sdk.transports.every(transport => transport.closed)).toBe(true)
    await expect(fetch(auth.callbackUrl)).rejects.toThrow()
  })

  it('cierra ambos clientes y transportes si falla la lectura de identidad', async () => {
    const auth = await beginAuthorization(undefined, true)
    await expect(auth.pending).rejects.toMatchObject({ code: 'offline' })
    expect(sdk.clients.every(client => client.closed)).toBe(true)
    expect(sdk.transports.every(transport => transport.closed)).toBe(true)
    await expect(fetch(auth.callbackUrl)).rejects.toThrow()
  })

  it('no devuelve credenciales si se cancela mientras se cierran los recursos', async () => {
    const closing = Promise.withResolvers<void>()
    const releaseClose = Promise.withResolvers<void>()
    sdk.close.mockImplementation(async () => {
      closing.resolve()
      await releaseClose.promise
    })
    const auth = await beginAuthorization()
    await closing.promise
    auth.controller.abort()
    releaseClose.resolve()
    await expect(auth.pending).rejects.toMatchObject({ code: 'cancelled' })
  })
})

describe('salida temprana de OAuth', () => {
  it('no abre clientes ni navegador si ya está cancelada', async () => {
    const controller = new AbortController()
    controller.abort()
    const openExternal = vi.fn<(url: string) => Promise<void>>()
    await expect(authorizeNotion(openExternal, controller.signal, 'https://example.test/mcp')).rejects.toMatchObject({ code: 'cancelled' })
    expect(openExternal).not.toHaveBeenCalled()
    expect(sdk.clients).toHaveLength(0)
    expect(sdk.transports).toHaveLength(0)
  })

  it('cierra el primer cliente y su transporte si falla antes de recibir un código', async () => {
    sdk.connect.mockRejectedValueOnce(new Error('Fallo sintético al iniciar'))
    await expect(authorizeNotion(async () => undefined, new AbortController().signal, 'https://example.test/mcp')).rejects.toMatchObject({ code: 'offline' })
    expect(sdk.clients).toHaveLength(1)
    expect(sdk.clients[0]!.closed).toBe(true)
    expect(sdk.transports[0]!.closed).toBe(true)
  })
})
