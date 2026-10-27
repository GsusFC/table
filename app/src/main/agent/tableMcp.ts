import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server as NetServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { AGENT_TOOLS, type AgentToolName } from '../../shared/agentTools'
import type { MesaId } from '../../shared/model'
import { log } from '../log'
import type { TableToolHandler } from './tableTools'

/**
 * Servidor del MCP de Table (T-011). Escucha en un socket Unix dentro de una
 * carpeta 0700 creada con `mkdtemp` en la carpeta temporal del usuario (en
 * macOS, `/var/folders/…/T/`, propia de cada usuario). Sin puerto TCP: ni una
 * web ni otro usuario del equipo pueden llamarlo. Si la ruta no cabe en
 * `sun_path` (104 bytes en macOS), se usa `/tmp/table-mcp-…`, también creada
 * con `mkdtemp` (0700, nombre aleatorio).
 *
 * Cada sesión de agente recibe en su entorno el socket, su ID y un testigo
 * aleatorio. El puente stdio (`mcpBridge.ts`) se presenta con una línea JSON
 * `{"session","ticket"}` y Table responde `ok` (después ya es MCP) o `no`:
 * rechaza testigos desconocidos o de sesiones cerradas y, al cerrar la
 * sesión, corta sus conexiones (el puente termina).
 * El testigo no es una credencial de ningún servicio y nunca se registra.
 */

/** Variables de entorno que recibe la sesión (y reenvía el arnés al puente). `TICKET` y no `TOKEN`: Gemini CLI quita del entorno de sus MCP los nombres con `TOKEN`. */
export const TABLE_MCP_ENV = {
  socket: 'TABLE_MCP_SOCKET',
  session: 'TABLE_MCP_SESSION',
  ticket: 'TABLE_MCP_TICKET',
} as const
export const TABLE_MCP_ENV_NAMES: readonly string[] = Object.values(TABLE_MCP_ENV)

/** `sun_path` de macOS: 104 bytes con el nulo final. */
const MAX_SOCKET_PATH = 103
const HANDSHAKE_TIMEOUT_MS = 5_000
const MAX_HANDSHAKE_BYTES = 4_096
const TICKET_BYTES = 32

const INSTRUCTIONS =
  'Herramientas de la mesa de Table de esta sesión: leer la mesa, la selección y la ficha del proyecto; añadir tarjetas, notas y resultados con sus fuentes; mover, conectar y borrar (borrar pide confirmación a la persona). Coordenadas del lienzo en px.'

export interface TableMcpSession {
  readonly sessionId: string
  readonly mesaId: MesaId
  /** Nombre del arnés (perfil) que verá la persona al confirmar. */
  readonly agentName: string
}

export interface TableMcpRegistration {
  /** Variables para el entorno de la sesión. */
  readonly env: Readonly<Record<string, string>>
  /** La sesión terminó: su testigo deja de valer y se cortan sus conexiones. */
  dispose(): void
}

export interface TableMcpServer {
  readonly socketPath: string
  register(session: TableMcpSession): TableMcpRegistration
  /** Conexiones abiertas de una sesión (para tests). */
  connections(sessionId: string): number
  close(): Promise<void>
}

interface Registered extends TableMcpSession {
  readonly ticket: Buffer
  readonly sockets: Set<Socket>
  /** Se cancela al cerrar la sesión: retira sus confirmaciones pendientes. */
  readonly ended: AbortController
}

async function socketDir(): Promise<string> {
  const preferred = await mkdtemp(join(tmpdir(), 'table-mcp-'))
  if (Buffer.byteLength(join(preferred, 's')) <= MAX_SOCKET_PATH) {
    return preferred
  }
  await rm(preferred, { recursive: true, force: true })
  return mkdtemp('/tmp/table-mcp-')
}

function textResult(value: unknown, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], isError }
}

/** Arranca el servidor; `handlers` ya validados contra el catálogo. */
export async function startTableMcpServer(handlers: Readonly<Record<AgentToolName, TableToolHandler>>): Promise<TableMcpServer> {
  const dir = await socketDir()
  const socketPath = join(dir, 's')
  const sessions = new Map<string, Registered>()
  /** Todas las conexiones desde que se aceptan (también sin autenticar): se cierran al salir. */
  const allSockets = new Set<Socket>()

  const tools = AGENT_TOOLS.map(tool => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    // Copia mutable para el SDK.
    inputSchema: JSON.parse(JSON.stringify(tool.inputSchema)) as { type: 'object'; [key: string]: unknown },
    annotations: { title: tool.title, readOnlyHint: tool.annotations.readOnlyHint, destructiveHint: tool.annotations.destructiveHint, openWorldHint: false },
  }))
  const toolNames = new Set<string>(AGENT_TOOLS.map(tool => tool.name))

  function serve(socket: Socket, session: Registered): void {
    const server = new Server({ name: 'table', version: '1.0.0' }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS })
    /** Se cancela si el puente se desconecta. */
    const connection = new AbortController()
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }))
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const name = request.params.name
      if (!sessions.has(session.sessionId)) {
        return textResult('La sesión de Table terminó.', true)
      }
      if (!toolNames.has(name)) {
        return textResult(`Herramienta desconocida: ${name}`, true)
      }
      const input = request.params.arguments ?? {}
      // Sesión cerrada, puente desconectado o petición cancelada por el agente.
      const signal = AbortSignal.any([session.ended.signal, connection.signal, extra.signal])
      try {
        const result = await handlers[name as AgentToolName]({ mesaId: session.mesaId, agentName: session.agentName, signal }, input)
        log('table-mcp-call', { tool: name, ok: true })
        return textResult(result)
      } catch (error) {
        log('table-mcp-call', { tool: name, ok: false })
        return textResult(error instanceof Error ? error.message : String(error), true)
      }
    })
    const transport = new StdioServerTransport(socket, socket)
    session.sockets.add(socket)
    socket.on('close', () => {
      session.sockets.delete(socket)
      connection.abort()
      void server.close().catch(() => undefined)
    })
    void server.connect(transport).then(
      () => socket.resume(),
      () => socket.destroy(),
    )
  }

  /** Primera línea: `{"session","ticket"}`. Lo que venga detrás ya es MCP. */
  function handshake(socket: Socket): void {
    allSockets.add(socket)
    socket.on('close', () => allSockets.delete(socket))
    let buffered = Buffer.alloc(0)
    const reject = (reason: string): void => {
      log('table-mcp-rejected', { reason })
      // El puente lo dice al arnés y termina con error; la conexión se destruye aunque el otro extremo no cierre.
      socket.end('no\n', () => socket.destroy())
    }
    const timer = setTimeout(() => {
      socket.off('data', onData)
      log('table-mcp-rejected', { reason: 'timeout' })
      socket.destroy()
    }, HANDSHAKE_TIMEOUT_MS)
    const onData = (chunk: Buffer): void => {
      buffered = Buffer.concat([buffered, chunk])
      const end = buffered.indexOf(0x0a)
      if (end === -1) {
        if (buffered.length > MAX_HANDSHAKE_BYTES) {
          clearTimeout(timer)
          socket.off('data', onData)
          reject('too-long')
        }
        return
      }
      clearTimeout(timer)
      socket.off('data', onData)
      socket.pause()
      const rest = buffered.subarray(end + 1)
      if (rest.length > 0) {
        socket.unshift(rest)
      }
      let hello: unknown
      try {
        hello = JSON.parse(buffered.subarray(0, end).toString('utf8'))
      } catch {
        reject('malformed')
        return
      }
      if (typeof hello !== 'object' || hello === null || !('session' in hello) || !('ticket' in hello)) {
        reject('malformed')
        return
      }
      const { session: sessionId, ticket } = hello
      const session = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined
      const presented = typeof ticket === 'string' && /^[0-9a-f]+$/.test(ticket) ? Buffer.from(ticket, 'hex') : null
      if (!session || !presented || presented.length !== session.ticket.length || !timingSafeEqual(presented, session.ticket)) {
        reject('unknown-session')
        return
      }
      socket.write('ok\n')
      serve(socket, session)
    }
    socket.on('data', onData)
    socket.on('error', () => undefined)
  }

  const net: NetServer = createServer(handshake)
  const listening = Promise.withResolvers<void>()
  net.once('error', listening.reject)
  net.listen(socketPath, () => {
    net.off('error', listening.reject)
    listening.resolve()
  })
  await listening.promise
  log('table-mcp-listening')

  return {
    socketPath,

    register(session) {
      const ticket = randomBytes(TICKET_BYTES)
      const entry: Registered = { ...session, ticket, sockets: new Set(), ended: new AbortController() }
      sessions.set(session.sessionId, entry)
      return {
        env: {
          [TABLE_MCP_ENV.socket]: socketPath,
          [TABLE_MCP_ENV.session]: session.sessionId,
          [TABLE_MCP_ENV.ticket]: ticket.toString('hex'),
        },
        dispose() {
          if (sessions.get(session.sessionId) === entry) {
            sessions.delete(session.sessionId)
          }
          entry.ended.abort()
          for (const socket of entry.sockets) {
            socket.destroy()
          }
        },
      }
    },

    connections(sessionId) {
      return sessions.get(sessionId)?.sockets.size ?? 0
    },

    async close() {
      for (const session of sessions.values()) {
        session.ended.abort()
      }
      sessions.clear()
      for (const socket of allSockets) {
        socket.destroy()
      }
      const closed = Promise.withResolvers<void>()
      net.close(() => closed.resolve())
      await closed.promise
      await rm(dir, { recursive: true, force: true })
    },
  }
}
