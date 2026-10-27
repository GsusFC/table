/**
 * Puente stdio del MCP de Table (T-011). El arnés lo arranca con el propio
 * ejecutable de Table en modo Node (`ELECTRON_RUN_AS_NODE=1`): se presenta
 * en el socket con la sesión y su testigo (del entorno de la sesión, nunca de
 * argumentos ni archivos), espera el `ok` de Table y después solo pasa bytes
 * entre stdio y el socket. Si Table lo rechaza o corta la conexión (sesión
 * cerrada), termina. Sin dependencias: se compila como una entrada aparte.
 */
import { createConnection } from 'node:net'

const socketPath = process.env['TABLE_MCP_SOCKET']
const session = process.env['TABLE_MCP_SESSION']
const ticket = process.env['TABLE_MCP_TICKET']

if (!socketPath || !session || !ticket) {
  process.stderr.write('MCP de Table: esta sesión no la abrió Table (faltan TABLE_MCP_SOCKET, TABLE_MCP_SESSION o TABLE_MCP_TICKET).\n')
  process.exit(1)
}

let accepted = false
let reply = ''
const socket = createConnection(socketPath, () => {
  socket.write(`${JSON.stringify({ session, ticket })}\n`)
})

/** Primera línea de Table: `ok` o el rechazo. Lo que venga detrás ya es MCP. */
function onReply(chunk: Buffer): void {
  reply += chunk.toString('latin1')
  const end = reply.indexOf('\n')
  if (end === -1) {
    return
  }
  socket.off('data', onReply)
  if (reply.slice(0, end) !== 'ok') {
    process.stderr.write('MCP de Table: Table rechazó la conexión (sesión cerrada o de otra mesa).\n')
    process.exit(1)
  }
  accepted = true
  const rest = Buffer.from(reply.slice(end + 1), 'latin1')
  if (rest.length > 0) {
    process.stdout.write(rest)
  }
  socket.pipe(process.stdout)
  process.stdin.pipe(socket)
}

socket.on('data', onReply)
socket.on('close', () => {
  if (!accepted) {
    process.stderr.write('MCP de Table: Table no está abierto o la sesión ya terminó.\n')
  }
  process.exit(accepted ? 0 : 1)
})
socket.on('error', () => undefined)
process.stdin.on('end', () => socket.end())
