import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_REPLAY_BYTES, type HarnessProfile, type SessionInfo } from '../../shared/terminal'
import { createSessionManager, FLOW_HIGH_WATER, sessionEnvironment, type SessionManager } from './sessions'
import { createWorkFolders } from './workFolder'

const MESA = '11111111-1111-4111-8111-111111111111'
const SIZE = { cols: 80, rows: 24 }

let workRoot: string
let manager: SessionManager
let output: Map<string, string>
let events: SessionInfo[]
/** Si la «interfaz» confirma la salida en cuanto llega. */
let autoAck: boolean
/** Retiene la preparación de la carpeta de trabajo para simular un arranque lento. */
let folderGate: Promise<void>

function profile(id: string, command: string): HarnessProfile {
  return { id, name: 'Prueba', command, source: 'custom', available: true }
}

const PROFILES: Record<string, HarnessProfile> = {
  hello: profile('hello', 'printf hola; sleep 30'),
  exit3: profile('exit3', 'printf adios; exit 3'),
  flood: profile('flood', `head -c ${SESSION_REPLAY_BYTES + 100_000} /dev/zero | tr '\\0' a; printf FIN; sleep 30`),
  bigFlood: profile('bigFlood', `head -c ${FLOW_HIGH_WATER * 4} /dev/zero | tr '\\0' a; printf FIN; sleep 30`),
  child: profile('child', 'sleep 300 & printf "hijo-%s-fin" $!; wait'),
}

/** Procesos reales en un pseudoterminal: no hay reloj falso que los adelante; se sondea hasta la condición. */
async function until(check: () => boolean, label: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error(`Tiempo agotado: ${label}`)
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

beforeEach(async () => {
  workRoot = await mkdtemp(join(tmpdir(), 'table-terminal-'))
  output = new Map()
  events = []
  autoAck = true
  folderGate = Promise.resolve()
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  const folders = createWorkFolders(join(workRoot, 'work-folders.json'), join(workRoot, 'Table'))
  manager = createSessionManager({
    shell: '/bin/sh',
    env: sessionEnvironment({ PATH: '/usr/bin:/bin', HOME: workRoot }),
    workFolder: async mesaId => {
      if (mesaId !== MESA) {
        throw new Error('La mesa no existe')
      }
      await folderGate
      return folders.folderFor(mesaId, 'Mesa: prueba')
    },
    profile: id => PROFILES[id],
    onData: (id, data) => {
      output.set(id, (output.get(id) ?? '') + data)
      if (autoAck) {
        manager.ack(id, data.length)
      }
    },
    onSession: session => events.push(session),
  })
})

afterEach(async () => {
  await manager.closeAll()
  vi.restoreAllMocks()
  await rm(workRoot, { recursive: true, force: true })
})

describe('sesiones', () => {
  it('arranca en la carpeta de la mesa, envía la salida y numera los títulos', async () => {
    const first = await manager.start(MESA, 'hello', SIZE)
    const second = await manager.start(MESA, 'hello', SIZE)
    expect(first.cwd).toBe(join(workRoot, 'Table', 'Mesa- prueba'))
    expect(existsSync(first.cwd)).toBe(true)
    expect([first.title, second.title]).toEqual(['Prueba', 'Prueba 2'])
    expect(events.map(event => event.status)).toEqual(['running', 'running'])
    await until(() => output.get(first.id)?.includes('hola') === true, 'salida')
    expect(manager.replay(first.id)).toContain('hola')
    expect(manager.sessions(MESA).map(session => session.id)).toEqual([first.id, second.id])
    expect(manager.runningCount()).toBe(2)
  })

  it('informa del código de salida', async () => {
    const session = await manager.start(MESA, 'exit3', SIZE)
    await until(() => events.some(event => event.id === session.id && event.status === 'exited'), 'salida')
    expect(events.find(event => event.status === 'exited')?.exitCode).toBe(3)
    expect(manager.replay(session.id)).toContain('adios')
    expect(manager.runningCount()).toBe(0)
  })

  it('acota la salida guardada', async () => {
    const session = await manager.start(MESA, 'flood', SIZE)
    await until(() => output.get(session.id)?.includes('FIN') === true, 'salida larga')
    const replay = manager.replay(session.id)
    expect(Buffer.byteLength(replay)).toBeLessThanOrEqual(SESSION_REPLAY_BYTES)
    expect(replay.endsWith('FIN')).toBe(true)
  })

  it('cerrar termina el proceso y sus hijos, olvida la sesión y no emite más eventos', async () => {
    const session = await manager.start(MESA, 'child', SIZE)
    await until(() => /hijo-\d+-fin/.test(output.get(session.id) ?? ''), 'PID del hijo')
    const childPid = Number(/hijo-(\d+)-fin/.exec(output.get(session.id)!)![1])
    const pid = manager.pidOf(session.id)!
    expect(alive(pid) && alive(childPid)).toBe(true)
    const eventsBefore = events.length
    await manager.close(session.id)
    expect(alive(pid)).toBe(false)
    expect(alive(childPid)).toBe(false)
    expect(manager.sessions(MESA)).toEqual([])
    expect(() => manager.replay(session.id)).toThrow()
    expect(events.length).toBe(eventsBefore)
  })

  it('cierra las sesiones de una mesa', async () => {
    const session = await manager.start(MESA, 'hello', SIZE)
    const pid = manager.pidOf(session.id)!
    await manager.closeMesa(MESA)
    expect(alive(pid)).toBe(false)
    expect(manager.sessions(MESA)).toEqual([])
  })

  it('rechaza un perfil o una mesa que no existen', async () => {
    await expect(manager.start(MESA, 'nope', SIZE)).rejects.toThrow('El perfil no existe')
    await expect(manager.start('22222222-2222-4222-8222-222222222222', 'hello', SIZE)).rejects.toThrow('La mesa no existe')
  })

  it('no envía señales a una sesión cuyo proceso ya terminó', async () => {
    const session = await manager.start(MESA, 'exit3', SIZE)
    await until(() => events.some(event => event.id === session.id && event.status === 'exited'), 'salida')
    const kill = vi.spyOn(process, 'kill')
    await manager.close(session.id)
    expect(kill.mock.calls.filter(([, name]) => name === 'SIGHUP' || name === 'SIGKILL')).toEqual([])
  })

  it('cerrar la mesa cancela un arranque en curso y no deja proceso', async () => {
    const gate = Promise.withResolvers<void>()
    folderGate = gate.promise
    const starting = manager.start(MESA, 'hello', SIZE)
    const closing = manager.closeMesa(MESA)
    gate.resolve()
    await expect(starting).rejects.toThrow('La mesa se está cerrando')
    await closing
    expect(manager.sessions(MESA)).toEqual([])
    expect(events).toEqual([])
    // Terminado el cierre, la mesa vuelve a admitir sesiones.
    await manager.start(MESA, 'hello', SIZE)
  })

  it('al salir de Table no arranca ninguna sesión más', async () => {
    const gate = Promise.withResolvers<void>()
    folderGate = gate.promise
    const starting = manager.start(MESA, 'hello', SIZE)
    const closing = manager.closeAll()
    gate.resolve()
    await expect(starting).rejects.toThrow('Table se está cerrando')
    await closing
    await expect(manager.start(MESA, 'hello', SIZE)).rejects.toThrow('Table se está cerrando')
    expect(manager.runningCount()).toBe(0)
  })

  it('pausa la sesión si la interfaz no confirma la salida y la reanuda al confirmar', async () => {
    autoAck = false
    const session = await manager.start(MESA, 'bigFlood', SIZE)
    const received = (): number => output.get(session.id)?.length ?? 0
    await until(() => received() > FLOW_HIGH_WATER, 'salida hasta el límite')
    // Pausada, deja de llegar salida (como mucho lo que ya estaba en el pseudoterminal).
    let previous = -1
    await until(
      () => {
        const stable = received() === previous
        previous = received()
        return stable
      },
      'salida detenida',
    )
    expect(received()).toBeLessThan(FLOW_HIGH_WATER * 2)
    expect(output.get(session.id)).not.toContain('FIN')
    autoAck = true
    manager.ack(session.id, received())
    await until(() => output.get(session.id)?.includes('FIN') === true, 'salida completa')
    expect(received()).toBe(FLOW_HIGH_WATER * 4 + 3)
  })

  it('recargar la interfaz reanuda las sesiones pausadas', async () => {
    autoAck = false
    const session = await manager.start(MESA, 'bigFlood', SIZE)
    await until(() => (output.get(session.id)?.length ?? 0) > FLOW_HIGH_WATER, 'salida hasta el límite')
    autoAck = true
    manager.resetFlowControl()
    await until(() => output.get(session.id)?.includes('FIN') === true, 'salida completa')
  })
})

describe('sessionEnvironment', () => {
  it('quita variables de Electron, de Table y de npm run, y fija el terminal', () => {
    const env = sessionEnvironment({
      PATH: '/bin',
      ELECTRON_RUN_AS_NODE: '1',
      TABLE_SMOKE: '1',
      npm_config_prefix: '/opt/otro-node',
      INIT_CWD: '/tmp',
      LANG: 'es_ES.UTF-8',
    })
    expect(env).toEqual({ PATH: '/bin', LANG: 'es_ES.UTF-8', TERM: 'xterm-256color', COLORTERM: 'truecolor' })
    expect(sessionEnvironment({}).LC_CTYPE).toBe('UTF-8')
  })
})
