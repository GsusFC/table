import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_TOOLS } from '../../shared/agentTools'
import type { Mesa } from '../../shared/model'
import { createMesaStore } from '../store/mesaStore'
import type { MesaStore } from '../store/types'
import { startTableMcpServer, TABLE_MCP_ENV, type TableMcpRegistration, type TableMcpServer } from './tableMcp'
import { createTableToolHandlers } from './tableTools'

/** El puente se ejecuta desde su fuente con el Node de los tests (que admite TypeScript sin tipos). */
const BRIDGE = join(__dirname, 'mcpBridge.ts')
const SESSION = '22222222-2222-4222-8222-222222222222'

let base: string
let store: MesaStore
let server: TableMcpServer
let mesa: Mesa
let answer: boolean
let clients: Client[]
/** Confirmación a medida: recibe la señal de la petición. */
let confirmWith: ((signal: AbortSignal) => Promise<boolean>) | null

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'table-mcp-server-'))
  store = createMesaStore(join(base, 'datos'))
  mesa = await store.create('Mesa del MCP')
  answer = false
  clients = []
  confirmWith = null
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  server = await startTableMcpServer(
    createTableToolHandlers({
      store,
      workFolder: async () => base,
      cachedProject: async () => null,
      unloadCard: async () => 'unloaded',
      ui: { isOpen: () => false, selection: () => [], editingNote: () => null, show: () => undefined },
      confirm: async (_request, signal) => (confirmWith ? confirmWith(signal) : answer),
      changed: () => undefined,
    }),
  )
})

afterEach(async () => {
  await Promise.all(clients.map(client => client.close().catch(() => undefined)))
  await server.close()
  vi.restoreAllMocks()
  await rm(base, { recursive: true, force: true })
})

/** Cliente del SDK que arranca el puente como lo haría un arnés, con el entorno de la sesión. */
async function connect(env: Readonly<Record<string, string>>): Promise<Client> {
  const client = new Client({ name: 'prueba', version: '1.0.0' })
  const transport = new StdioClientTransport({ command: process.execPath, args: [BRIDGE], env: { ...env }, stderr: 'pipe' })
  await client.connect(transport)
  clients.push(client)
  return client
}

/** Arranca el puente sin cliente MCP y devuelve su código de salida. */
function bridgeExitCode(env: Readonly<Record<string, string>>): Promise<number | null> {
  const child = spawn(process.execPath, [BRIDGE], { env: { ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
  const { promise, resolve } = Promise.withResolvers<number | null>()
  child.on('exit', code => resolve(code))
  return promise
}

function register(): TableMcpRegistration {
  return server.register({ sessionId: SESSION, mesaId: mesa.id, agentName: 'Codex' })
}

describe('servidor y puente', () => {
  it('el socket cabe en sun_path y vive en una carpeta propia', () => {
    expect(Buffer.byteLength(server.socketPath)).toBeLessThanOrEqual(103)
    expect(server.socketPath).toMatch(/table-mcp-[^/]+\/s$/)
  })

  it('lista las herramientas del catálogo con sus esquemas y anotaciones, y ejecuta contra la mesa', async () => {
    const client = await connect(register().env)
    const { tools } = await client.listTools()
    expect(tools.map(tool => tool.name)).toEqual(AGENT_TOOLS.map(tool => tool.name))
    const remove = tools.find(tool => tool.name === 'table_remove_items')
    expect(remove?.annotations).toMatchObject({ destructiveHint: true, readOnlyHint: false })
    expect(remove?.inputSchema).toMatchObject({ type: 'object', required: ['ids'] })

    const added = await client.callTool({ name: 'table_add_note', arguments: { text: 'Desde el agente', position: { x: 5, y: 6 } } })
    expect(added.isError).toBeFalsy()
    const [note] = (await store.get(mesa.id)).notes
    expect(note).toMatchObject({ text: 'Desde el agente', position: { x: 5, y: 6 } })

    const invalid = await client.callTool({ name: 'table_add_card', arguments: { url: 'javascript:alert(1)' } })
    expect(invalid.isError).toBe(true)

    // Borrar rechazado por la persona: no cambia nada.
    const rejected = await client.callTool({ name: 'table_remove_items', arguments: { ids: [note!.id] } })
    expect(JSON.stringify(rejected.content)).toContain('no aceptó')
    expect((await store.get(mesa.id)).notes).toHaveLength(1)
  })

  it('rechaza un testigo desconocido, otra sesión o una sesión cerrada', async () => {
    const { env, dispose } = register()
    const wrongTicket = { ...env, [TABLE_MCP_ENV.ticket]: 'ab'.repeat(32) }
    expect(await bridgeExitCode(wrongTicket)).toBe(1)
    await expect(connect(wrongTicket)).rejects.toThrow()
    const otherSession = { ...env, [TABLE_MCP_ENV.session]: '33333333-3333-4333-8333-333333333333' }
    await expect(connect(otherSession)).rejects.toThrow()
    dispose()
    await expect(connect(env)).rejects.toThrow()
  })

  it('al cerrar la sesión se cortan sus conexiones y el puente termina', async () => {
    const { env, dispose } = register()
    const child = spawn(process.execPath, [BRIDGE], { env: { ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
    const exited = Promise.withResolvers<number | null>()
    child.on('exit', code => exited.resolve(code))
    // El servidor responde al `ping` cuando ya sirve la conexión del puente.
    const answered = Promise.withResolvers<void>()
    child.stdout.once('data', () => answered.resolve())
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })}\n`)
    await answered.promise
    expect(server.connections(SESSION)).toBe(1)
    dispose()
    expect(await exited.promise).toBe(0)
    expect(server.connections(SESSION)).toBe(0)
  })

  it('sin el entorno de una sesión, el puente lo dice y termina', async () => {
    expect(await bridgeExitCode({ PATH: process.env['PATH'] ?? '' })).toBe(1)
  })

  it('cerrar la sesión con un borrado pendiente lo cancela: aceptarlo después no borra nada', async () => {
    const { env, dispose } = register()
    const note = await store.addNote(mesa.id, { x: 0, y: 0 }, 'No borrar')
    const asked = Promise.withResolvers<void>()
    let cancelled = false
    // La «persona» acepta en cuanto la petición se cancela: demasiado tarde.
    confirmWith = signal => {
      asked.resolve()
      const { promise, resolve } = Promise.withResolvers<boolean>()
      signal.addEventListener('abort', () => {
        cancelled = true
        resolve(true)
      })
      return promise
    }
    const client = await connect(env)
    const removal = client.callTool({ name: 'table_remove_items', arguments: { ids: [note.id] } }).catch(() => null)
    await asked.promise
    dispose()
    await removal
    expect(cancelled).toBe(true)
    expect((await store.get(mesa.id)).notes).toHaveLength(1)
  })

  it('cerrar Table no espera a conexiones rechazadas que no cierran ni a las que no se presentan', async () => {
    // Rechazada: el cliente recibe `no` y deja abierta su mitad.
    const rejected = createConnection({ path: server.socketPath, allowHalfOpen: true })
    const rejectedEnded = Promise.withResolvers<string>()
    let reply = ''
    rejected.on('data', chunk => (reply += chunk.toString()))
    rejected.on('end', () => rejectedEnded.resolve(reply))
    rejected.on('error', () => undefined)
    rejected.write(`${JSON.stringify({ session: SESSION, ticket: 'ab'.repeat(32) })}\n`)
    expect(await rejectedEnded.promise).toBe('no\n')
    // Sin autenticar y sin decir nada.
    const silent = createConnection(server.socketPath)
    const connected = Promise.withResolvers<void>()
    silent.on('connect', () => connected.resolve())
    const silentClosed = Promise.withResolvers<void>()
    silent.on('close', () => silentClosed.resolve())
    silent.on('error', () => undefined)
    await connected.promise
    // `close()` termina (antes esperaba a estas conexiones) y borra la carpeta del socket.
    await server.close()
    await silentClosed.promise
    expect(existsSync(server.socketPath)).toBe(false)
    rejected.destroy()
  })
})
