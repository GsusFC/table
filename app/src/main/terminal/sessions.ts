import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { spawn, type IPty } from 'node-pty'
import type { MesaId } from '../../shared/model'
import {
  SESSION_REPLAY_BYTES,
  type HarnessProfile,
  type SessionId,
  type SessionInfo,
  type SessionMcp,
  type TerminalSize,
} from '../../shared/terminal'
import { log } from '../log'

/** Salida agrupada antes de enviarla a la interfaz (un fotograma). */
const OUTPUT_COALESCE_MS = 16
/** Margen tras SIGHUP antes de forzar con SIGKILL. */
const KILL_GRACE_MS = 2_000
/** Espera máxima a que el proceso confirme su salida tras SIGKILL. */
const EXIT_WAIT_MS = 1_000
const POLL_MS = 50
/** Control de flujo: caracteres enviados sin confirmar a partir de los cuales se pausa la sesión… */
export const FLOW_HIGH_WATER = 1024 * 1024
/** …y por debajo de los cuales se reanuda. */
export const FLOW_LOW_WATER = 256 * 1024
/** Una sesión pausada sin confirmaciones durante este tiempo se reanuda (interfaz recargada o atascada). */
const FLOW_PAUSE_TIMEOUT_MS = 10_000

export interface SessionManagerOptions {
  /** Shell de inicio de sesión del usuario (ruta absoluta). */
  readonly shell: string
  /** Entorno base de las sesiones (ver `sessionEnvironment`). */
  readonly env: NodeJS.ProcessEnv
  /** Carpeta de trabajo de la mesa (ruta absoluta, ya creada); lanza si la mesa no existe. */
  workFolder(mesaId: MesaId): Promise<string>
  profile(id: string): HarnessProfile | undefined
  /**
   * Antes de arrancar, con la carpeta ya lista: argumentos y entorno extra del
   * arnés y sus MCP (T-010, T-011). Recibe el ID que tendrá la sesión. Si
   * lanza `SessionBlockedError`, la sesión no se abre y la interfaz recibe su
   * mensaje; con cualquier otro error, arranca sin ellos.
   */
  prepare?(mesaId: MesaId, profile: HarnessProfile, cwd: string, sessionId: SessionId): Promise<SessionLaunch>
  onData(sessionId: SessionId, data: string): void
  /** Arranque y salida; no se emite para sesiones que se están cerrando. */
  onSession(session: SessionInfo): void
}

/** Lo que se añade al arranque de un perfil (T-010). Nunca credenciales. */
export interface SessionLaunch {
  /** Se añaden, entrecomillados, al final del comando del perfil; la terminal normal no los usa. */
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly mcp: readonly SessionMcp[]
  /**
   * Si la preparación sigue valiendo (p. ej. no cambió el ajuste de Notion de
   * la mesa mientras tanto). Se comprueba justo antes de arrancar; si no, se
   * vuelve a preparar.
   */
  readonly isCurrent?: () => boolean
  /** Se llama una vez cuando la sesión termina, se cierra o no llega a arrancar (p. ej. invalida su testigo del MCP de Table). */
  readonly dispose?: () => void
}

/** La preparación no puede garantizar una configuración segura: la sesión no se abre. */
export class SessionBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SessionBlockedError'
  }
}

const NO_LAUNCH: SessionLaunch = { args: [], env: {}, mcp: [] }
/** Preparaciones como mucho por arranque si se quedan antiguas una y otra vez. */
const MAX_PREPARE_ATTEMPTS = 3

/** Texto entre comillas simples para `sh -c`: nada se expande dentro. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export interface SessionManager {
  sessions(mesaId: MesaId): SessionInfo[]
  /** `size` ya validado. Se rechaza si la mesa se está cerrando o Table está saliendo. */
  start(mesaId: MesaId, profileId: string, size: TerminalSize): Promise<SessionInfo>
  /** Salida guardada; antes envía la que estaba pendiente de agrupar. */
  replay(sessionId: SessionId): string
  /** Sin efecto si la sesión no existe o ya terminó. */
  write(sessionId: SessionId, data: string): void
  resize(sessionId: SessionId, size: TerminalSize): void
  /** La interfaz ya procesó `chars` caracteres de la salida enviada. */
  ack(sessionId: SessionId, chars: number): void
  /** La interfaz se recargó: la salida sin confirmar ya no se confirmará. Reanuda todas las sesiones. */
  resetFlowControl(): void
  /** Termina el proceso y sus descendientes (SIGHUP y, si siguen, SIGKILL) y olvida la sesión. */
  close(sessionId: SessionId): Promise<void>
  /** Cancela los arranques en curso de la mesa y cierra sus sesiones. */
  closeMesa(mesaId: MesaId): Promise<void>
  /** Al salir de Table: a partir de aquí no se arranca ninguna sesión más. */
  closeAll(): Promise<void>
  runningCount(): number
  /** Último recurso síncrono al salir: SIGKILL a cada grupo de procesos aún en marcha. */
  killAllNow(): void
  /** Solo para el smoke: PID del proceso de la sesión. */
  pidOf(sessionId: SessionId): number | null
}

/**
 * Entorno de una sesión: el del usuario, sin variables de Electron ni de
 * Table ni las que añade `npm run` al arrancar Table en desarrollo (`npm_*`,
 * `INIT_CWD`; confunden a nvm y otras herramientas). Terminal de 256 colores.
 * Nunca se añaden credenciales.
 */
export function sessionEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(base)) {
    const fromTable = key.startsWith('ELECTRON_') || key.startsWith('TABLE_')
    const fromNpmRun = key.startsWith('npm_') || key === 'INIT_CWD'
    if (value !== undefined && !fromTable && !fromNpmRun) {
      env[key] = value
    }
  }
  env['TERM'] = 'xterm-256color'
  env['COLORTERM'] = 'truecolor'
  // Una app abierta desde Finder no recibe la configuración regional; sin ella, la salida UTF-8 se rompe.
  if (!env['LANG'] && !env['LC_ALL'] && !env['LC_CTYPE']) {
    env['LC_CTYPE'] = 'UTF-8'
  }
  return env
}

/** Salida reciente acotada a `limit` bytes UTF-8 (se descarta la más antigua). */
class ReplayBuffer {
  private chunks: string[] = []
  private bytes = 0

  constructor(private readonly limit: number) {}

  append(chunk: string): void {
    this.chunks.push(chunk)
    this.bytes += Buffer.byteLength(chunk)
    while (this.bytes > this.limit && this.chunks.length > 0) {
      const first = this.chunks[0]!
      const firstBytes = Buffer.byteLength(first)
      const excess = this.bytes - this.limit
      if (firstBytes <= excess) {
        this.chunks.shift()
        this.bytes -= firstBytes
        continue
      }
      // Cada unidad UTF-16 ocupa al menos un byte: quitar `excess` unidades basta.
      let cut = excess
      const code = first.charCodeAt(cut)
      if (code >= 0xdc00 && code <= 0xdfff) {
        cut += 1
      }
      const rest = first.slice(cut)
      this.chunks[0] = rest
      this.bytes -= firstBytes - Buffer.byteLength(rest)
    }
  }

  text(): string {
    if (this.chunks.length > 1) {
      this.chunks = [this.chunks.join('')]
    }
    return this.chunks[0] ?? ''
  }
}

/** Un proceso identificado por PID y hora de inicio: un PID reutilizado tiene otra hora. */
interface ProcessEntry {
  readonly pid: number
  readonly ppid: number
  readonly started: string
}

interface Session {
  info: SessionInfo
  /** Libera lo que preparó `prepare` (p. ej. el testigo del MCP de Table); null cuando ya se liberó. */
  dispose: (() => void) | null
  readonly pty: IPty
  readonly replay: ReplayBuffer
  /** Hora de inicio del proceso principal según `ps`, leída al arrancar. */
  leaderStarted: string | null
  pending: string
  timer: NodeJS.Timeout | null
  /** Caracteres enviados a la interfaz que aún no ha confirmado. */
  unacked: number
  /** Pausada por control de flujo; el temporizador la reanuda si no llegan confirmaciones. */
  pauseTimer: NodeJS.Timeout | null
  closing: Promise<void> | null
  readonly exited: Promise<void>
}

/** Tabla de procesos actual (PID, PID del padre y hora de inicio), o vacía si `ps` falla. */
function listProcesses(): Promise<Map<number, ProcessEntry>> {
  const { promise, resolve } = Promise.withResolvers<Map<number, ProcessEntry>>()
  // Configuración regional fija: la hora de inicio se compara como texto entre dos lecturas.
  const env = { ...process.env, LC_ALL: 'C' }
  execFile('/bin/ps', ['-A', '-o', 'pid=,ppid=,lstart='], { env, timeout: 2_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
    const table = new Map<number, ProcessEntry>()
    if (!error) {
      for (const line of stdout.split('\n')) {
        const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line)
        if (match) {
          table.set(Number(match[1]), { pid: Number(match[1]), ppid: Number(match[2]), started: match[3]! })
        }
      }
    }
    resolve(table)
  })
  return promise
}

/** Descendientes de `root` (hijos, nietos…) en una tabla de procesos. */
function descendantsOf(root: number, table: ReadonlyMap<number, ProcessEntry>): ProcessEntry[] {
  const children = new Map<number, ProcessEntry[]>()
  for (const entry of table.values()) {
    children.set(entry.ppid, [...(children.get(entry.ppid) ?? []), entry])
  }
  const found: ProcessEntry[] = []
  const queue = [root]
  while (queue.length > 0) {
    for (const child of children.get(queue.shift()!) ?? []) {
      if (!found.includes(child)) {
        found.push(child)
        queue.push(child.pid)
      }
    }
  }
  return found
}

/** Si el PID existe y es nuestro; solo para dejar de esperar, nunca para decidir a quién enviar una señal. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function signal(pid: number, name: NodeJS.Signals): void {
  try {
    process.kill(pid, name)
  } catch {
    // Ya terminó.
  }
}

export function createSessionManager(options: SessionManagerOptions): SessionManager {
  const sessions = new Map<SessionId, Session>()
  /** Arranques en curso (carpeta de trabajo aún sin crear): cerrar su mesa los espera y los cancela. */
  const pendingStarts = new Set<{ readonly mesaId: MesaId; readonly settled: Promise<unknown> }>()
  /** Mesas que se están cerrando (contador por si se piden dos cierres a la vez). */
  const closingMesas = new Map<MesaId, number>()
  let shuttingDown = false

  function refuseStart(mesaId: MesaId): void {
    if (shuttingDown) {
      throw new Error('Table se está cerrando')
    }
    if (closingMesas.has(mesaId)) {
      throw new Error('La mesa se está cerrando')
    }
  }

  function resumeFlow(session: Session): void {
    if (session.pauseTimer) {
      clearTimeout(session.pauseTimer)
      session.pauseTimer = null
      session.pty.resume()
    }
  }

  /** Reanuda una sesión pausada si no llegan confirmaciones (p. ej. la interfaz dejó de escuchar). */
  function armPauseTimeout(session: Session): void {
    clearTimeout(session.pauseTimer ?? undefined)
    session.pauseTimer = setTimeout(() => {
      log('terminal-flow-timeout', { unacked: session.unacked })
      session.unacked = 0
      resumeFlow(session)
    }, FLOW_PAUSE_TIMEOUT_MS)
  }

  function flushOutput(id: SessionId, session: Session): void {
    if (session.timer) {
      clearTimeout(session.timer)
      session.timer = null
    }
    if (!session.pending) {
      return
    }
    const data = session.pending
    session.pending = ''
    session.unacked += data.length
    if (!session.pauseTimer && session.unacked > FLOW_HIGH_WATER && session.info.status === 'running') {
      session.pty.pause()
      armPauseTimeout(session)
    }
    options.onData(id, data)
  }

  function titleFor(mesaId: MesaId, name: string): string {
    const taken = new Set([...sessions.values()].filter(session => session.info.mesaId === mesaId).map(session => session.info.title))
    if (!taken.has(name)) {
      return name
    }
    let n = 2
    while (taken.has(`${name} ${n}`)) {
      n += 1
    }
    return `${name} ${n}`
  }

  /**
   * SIGHUP al grupo del proceso y a cada descendiente (los trabajos de un
   * shell interactivo tienen su propio grupo); los que sigan vivos tras el
   * margen reciben SIGKILL. Nunca se envía una señal al proceso principal ni a
   * su grupo después de ver su salida, y cada destino se comprueba justo
   * antes con `ps` por PID y hora de inicio: un PID reutilizado por otro
   * proceso no se toca. Los procesos que se separaron del árbol antes de
   * cerrar (demonios) tampoco.
   */
  async function terminate(session: Session): Promise<void> {
    const pid = session.pty.pid
    const running = (): boolean => session.info.status === 'running'
    const isSame = (entry: ProcessEntry, table: ReadonlyMap<number, ProcessEntry>): boolean => table.get(entry.pid)?.started === entry.started

    const before = await listProcesses()
    const leader = before.get(pid)
    const leaderVerified = !!leader && (session.leaderStarted === null || leader.started === session.leaderStarted)
    if (!running() || !leaderVerified) {
      // Ya terminó (o `ps` no lo ve): no hay a quién enviar señales con seguridad.
      return
    }
    const tree = descendantsOf(pid, before)
    signal(-pid, 'SIGHUP')
    signal(pid, 'SIGHUP')
    for (const entry of tree) {
      signal(entry.pid, 'SIGHUP')
    }

    const deadline = Date.now() + KILL_GRACE_MS
    while (Date.now() < deadline && (running() || tree.some(entry => isAlive(entry.pid)))) {
      await delay(POLL_MS)
    }
    if (!running() && !tree.some(entry => isAlive(entry.pid))) {
      return
    }

    const after = await listProcesses()
    const survivors = tree.filter(entry => isSame(entry, after))
    const leaderSurvives = running() && isSame(leader, after)
    if (leaderSurvives || survivors.length > 0) {
      log('terminal-sigkill', { survivors: survivors.length + (leaderSurvives ? 1 : 0) })
    }
    if (leaderSurvives) {
      signal(-pid, 'SIGKILL')
      signal(pid, 'SIGKILL')
    }
    for (const entry of survivors) {
      signal(entry.pid, 'SIGKILL')
    }
    if (running() && !(await Promise.race([session.exited.then(() => true), delay(EXIT_WAIT_MS, false)]))) {
      log('terminal-exit-timeout')
    }
  }

  function close(id: SessionId): Promise<void> {
    const session = sessions.get(id)
    if (!session) {
      return Promise.resolve()
    }
    session.closing ??= (async () => {
      if (session.timer) {
        clearTimeout(session.timer)
        session.timer = null
      }
      session.pending = ''
      // Pausada, la salida no se lee y la confirmación de salida del proceso tardaría más.
      resumeFlow(session)
      try {
        await terminate(session)
      } finally {
        sessions.delete(id)
        session.dispose?.()
        session.dispose = null
        log('terminal-closed', { profileId: session.info.profileId })
      }
    })()
    return session.closing
  }

  async function launch(mesaId: MesaId, profile: HarnessProfile, size: TerminalSize): Promise<SessionInfo> {
    const cwd = await options.workFolder(mesaId)
    // Mientras se preparaba la carpeta pudo empezar el cierre de la mesa o de Table.
    refuseStart(mesaId)
    const id = randomUUID()
    let extra = NO_LAUNCH
    for (let attempt = 1; options.prepare; attempt += 1) {
      extra = await options.prepare(mesaId, profile, cwd, id).catch((error: unknown) => {
        if (error instanceof SessionBlockedError) {
          throw error
        }
        log('terminal-prepare-failed', { profileId: profile.id, message: error instanceof Error ? error.message : String(error) })
        return NO_LAUNCH
      })
      try {
        refuseStart(mesaId)
      } catch (error) {
        extra.dispose?.()
        throw error
      }
      // Comprobación y arranque sin `await` entre medias: nada puede cambiar el ajuste en ese hueco.
      if (!extra.isCurrent || extra.isCurrent()) {
        break
      }
      extra.dispose?.()
      if (attempt >= MAX_PREPARE_ATTEMPTS) {
        throw new Error('La configuración de la sesión cambió mientras se abría; vuelve a abrirla')
      }
    }
    const command = profile.command === null ? null : [profile.command, ...extra.args.map(shellQuote)].join(' ')
    const args = command === null ? ['-l'] : ['-l', '-c', command]
    let pty: IPty
    try {
      pty = spawn(options.shell, args, { name: 'xterm-256color', cols: size.cols, rows: size.rows, cwd, env: { ...options.env, ...extra.env } })
    } catch (error) {
      extra.dispose?.()
      log('terminal-spawn-failed', { profileId: profile.id, message: error instanceof Error ? error.message : String(error) })
      throw new Error('No se pudo abrir la terminal')
    }
    const { promise: exited, resolve: markExited } = Promise.withResolvers<void>()
    const session: Session = {
      info: {
        id,
        mesaId,
        profileId: profile.id,
        title: titleFor(mesaId, profile.name),
        cwd,
        status: 'running',
        exitCode: null,
        startedAt: new Date().toISOString(),
        mcp: extra.mcp,
      },
      pty,
      replay: new ReplayBuffer(SESSION_REPLAY_BYTES),
      leaderStarted: null,
      pending: '',
      timer: null,
      unacked: 0,
      pauseTimer: null,
      closing: null,
      exited,
      dispose: extra.dispose ?? null,
    }
    sessions.set(id, session)
    // Identidad del proceso para no confundirlo con otro que reutilice su PID al cerrarlo.
    void listProcesses().then(table => {
      if (session.info.status === 'running') {
        session.leaderStarted ??= table.get(pty.pid)?.started ?? null
      }
    })
    pty.onData(chunk => {
      if (session.closing) {
        return
      }
      session.replay.append(chunk)
      session.pending += chunk
      session.timer ??= setTimeout(() => flushOutput(id, session), OUTPUT_COALESCE_MS)
    })
    pty.onExit(({ exitCode, signal: bySignal }) => {
      session.info = { ...session.info, status: 'exited', exitCode: bySignal ? null : exitCode }
      if (session.pauseTimer) {
        clearTimeout(session.pauseTimer)
        session.pauseTimer = null
      }
      markExited()
      session.dispose?.()
      session.dispose = null
      log('terminal-exited', { profileId: profile.id, exitCode, signal: bySignal ?? null })
      if (!session.closing) {
        flushOutput(id, session)
        options.onSession(session.info)
      }
    })
    log('terminal-started', { profileId: profile.id })
    options.onSession(session.info)
    return session.info
  }

  return {
    sessions(mesaId) {
      return [...sessions.values()].filter(session => session.info.mesaId === mesaId && !session.closing).map(session => session.info)
    },

    start(mesaId, profileId, size) {
      try {
        refuseStart(mesaId)
      } catch (error) {
        return Promise.reject(error)
      }
      const profile = options.profile(profileId)
      if (!profile) {
        return Promise.reject(new Error('El perfil no existe'))
      }
      const started = launch(mesaId, profile, size)
      const entry = { mesaId, settled: started.catch(() => undefined) }
      pendingStarts.add(entry)
      void entry.settled.then(() => pendingStarts.delete(entry))
      return started
    },

    replay(id) {
      const session = sessions.get(id)
      if (!session || session.closing) {
        throw new Error('La sesión no existe')
      }
      flushOutput(id, session)
      return session.replay.text()
    },

    write(id, data) {
      const session = sessions.get(id)
      if (session && !session.closing && session.info.status === 'running') {
        session.pty.write(data)
      }
    },

    resize(id, size) {
      const session = sessions.get(id)
      if (session && !session.closing && session.info.status === 'running') {
        session.pty.resize(size.cols, size.rows)
      }
    },

    ack(id, chars) {
      const session = sessions.get(id)
      if (!session) {
        return
      }
      session.unacked = Math.max(0, session.unacked - chars)
      if (session.pauseTimer) {
        if (session.unacked < FLOW_LOW_WATER) {
          resumeFlow(session)
        } else {
          armPauseTimeout(session)
        }
      }
    },

    resetFlowControl() {
      for (const session of sessions.values()) {
        session.unacked = 0
        resumeFlow(session)
      }
    },

    close,

    async closeMesa(mesaId) {
      closingMesas.set(mesaId, (closingMesas.get(mesaId) ?? 0) + 1)
      try {
        await Promise.all([...pendingStarts].filter(entry => entry.mesaId === mesaId).map(entry => entry.settled))
        const ids = [...sessions.values()].filter(session => session.info.mesaId === mesaId).map(session => session.info.id)
        await Promise.all(ids.map(close))
      } finally {
        const remaining = (closingMesas.get(mesaId) ?? 1) - 1
        if (remaining > 0) {
          closingMesas.set(mesaId, remaining)
        } else {
          closingMesas.delete(mesaId)
        }
      }
    },

    async closeAll() {
      shuttingDown = true
      await Promise.all([...pendingStarts].map(entry => entry.settled))
      await Promise.all([...sessions.keys()].map(close))
    },

    runningCount() {
      return [...sessions.values()].filter(session => session.info.status === 'running' && !session.closing).length
    },

    killAllNow() {
      for (const session of sessions.values()) {
        if (session.info.status === 'running') {
          signal(-session.pty.pid, 'SIGKILL')
          signal(session.pty.pid, 'SIGKILL')
        }
      }
    },

    pidOf(id) {
      return sessions.get(id)?.pty.pid ?? null
    },
  }
}
