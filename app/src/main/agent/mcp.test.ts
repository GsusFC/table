import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentNotionMode } from '../../shared/model'
import { SessionBlockedError } from '../terminal/sessions'
import { agentMcpLaunch, BROWSER_MCP_PACKAGE, createAgentMcp, FIGMA_MCP_URL, type AgentMcp } from './mcp'

const NOTION_URL = 'https://mcp.notion.com/mcp'
const BROWSER_ARGS = ['-y', BROWSER_MCP_PACKAGE, '--autoConnect', '--no-usage-statistics', '--no-performance-crux']
const MESA = '11111111-1111-4111-8111-111111111111'
const GEMINI = '.gemini/settings.json'
const OMP = '.omp/mcp.json'

let root: string
let folder: string
let mode: AgentNotionMode
/** Retraso al leer el modo de la mesa (para provocar carreras). */
let modeDelay: number
let mcp: AgentMcp

function createMcp(): AgentMcp {
  return createAgentMcp({
    mode: async () => {
      const current = mode
      await delay(modeDelay)
      return current
    },
    saveMode: async (_mesaId, next) => {
      mode = next
      return next
    },
    folder: async () => folder,
    verifyFolder: async () => undefined,
    registryFile: join(root, 'datos', 'agent-mcp-files.json'),
  })
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'table-mcp-'))
  folder = join(root, 'mesa')
  await mkdir(folder)
  mode = 'files'
  modeDelay = 0
  mcp = createMcp()
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await chmod(join(folder, '.gemini'), 0o700).catch(() => undefined)
  await rm(root, { recursive: true, force: true })
})

async function readJson(path: string): Promise<{ mcpServers: Record<string, unknown>; [key: string]: unknown }> {
  return JSON.parse(await readFile(join(folder, path), 'utf8')) as { mcpServers: Record<string, unknown> }
}

/** Nada de lo generado lleva credenciales ni cabeceras: solo URLs públicas y el comando del navegador. */
function expectNoCredentials(text: string): void {
  expect(text).not.toMatch(/token|bearer|authorization|secret|password|api[_-]?key|headers|ntn_|figd_/i)
}

describe('servidores por modo de Notion', () => {
  it('Figma y navegador siempre; Notion solo con «MCP completo»', () => {
    expect(agentMcpLaunch('claude', 'files').mcp.map(item => item.name)).toEqual(['figma', 'browser'])
    expect(agentMcpLaunch('claude', 'mcp').mcp.map(item => item.name)).toEqual(['figma', 'browser', 'notion'])
  })

  it('la ayuda del navegador avisa de que con su permiso el agente puede abrir Notion', () => {
    expect(agentMcpLaunch('claude', 'files').mcp.find(item => item.name === 'browser')?.hint).toContain('Notion incluido')
  })
})

describe('Claude Code', () => {
  it('un solo argumento `--mcp-config=<json>` con nombres `table-…`, sin archivos ni entorno', () => {
    const launch = agentMcpLaunch('claude', 'mcp')
    expect(launch.files).toEqual([])
    expect(launch.env).toEqual({})
    expect(launch.args).toHaveLength(1)
    const [arg] = launch.args
    expect(arg!.startsWith('--mcp-config=')).toBe(true)
    expect(JSON.parse(arg!.slice('--mcp-config='.length))).toEqual({
      mcpServers: {
        'table-figma': { type: 'http', url: FIGMA_MCP_URL },
        'table-chrome-devtools': { type: 'stdio', command: 'npx', args: BROWSER_ARGS },
        'table-notion': { type: 'http', url: NOTION_URL },
      },
    })
    expect(launch.mcp.every(item => item.status === 'configured')).toBe(true)
    expect(launch.mcp.find(item => item.name === 'figma')?.hint).toContain('/mcp')
    expect(launch.mcp.find(item => item.name === 'browser')?.hint).toContain('chrome://inspect/#remote-debugging')
    expect(launch.mcp.find(item => item.name === 'notion')?.hint).toContain('presupuestos')
    expectNoCredentials(arg!)
  })

  it('con archivos filtrados, sin Notion', () => {
    const [arg] = agentMcpLaunch('claude', 'files').args
    expect(Object.keys((JSON.parse(arg!.slice('--mcp-config='.length)) as { mcpServers: object }).mcpServers)).toEqual([
      'table-figma',
      'table-chrome-devtools',
    ])
  })
})

describe('Codex', () => {
  it('pares `-c mcp_servers.table-….…` con valores TOML (no tocan las entradas `figma` de la persona)', () => {
    const launch = agentMcpLaunch('codex', 'files')
    expect(launch.files).toEqual([])
    expect(launch.env).toEqual({})
    expect(launch.args).toEqual([
      '-c',
      `mcp_servers.table-figma.url="${FIGMA_MCP_URL}"`,
      '-c',
      'mcp_servers.table-chrome-devtools.command="npx"',
      '-c',
      `mcp_servers.table-chrome-devtools.args=${JSON.stringify(BROWSER_ARGS)}`,
      '-c',
      'mcp_servers.table-chrome-devtools.startup_timeout_sec=60',
    ])
    expect(launch.mcp.find(item => item.name === 'figma')?.hint).toContain(
      `codex mcp login table-figma -c mcp_servers.table-figma.url="${FIGMA_MCP_URL}"`,
    )
    expectNoCredentials(launch.args.join(' '))
  })

  it('con «MCP completo», también Notion', () => {
    expect(agentMcpLaunch('codex', 'mcp').args).toContain(`mcp_servers.table-notion.url="${NOTION_URL}"`)
    expect(agentMcpLaunch('codex', 'files').args.join(' ')).not.toContain('notion')
  })
})

describe('OpenCode', () => {
  it('configuración en `OPENCODE_CONFIG_CONTENT`, sin argumentos ni archivos', () => {
    const launch = agentMcpLaunch('opencode', 'mcp')
    expect(launch.args).toEqual([])
    expect(launch.files).toEqual([])
    expect(JSON.parse(launch.env['OPENCODE_CONFIG_CONTENT']!)).toEqual({
      $schema: 'https://opencode.ai/config.json',
      mcp: {
        'table-figma': { type: 'remote', url: FIGMA_MCP_URL },
        'table-chrome-devtools': { type: 'local', command: ['npx', ...BROWSER_ARGS] },
        'table-notion': { type: 'remote', url: NOTION_URL },
      },
    })
    expectNoCredentials(launch.env['OPENCODE_CONFIG_CONTENT']!)
  })
})

describe('Gemini CLI', () => {
  it('escribe `.gemini/settings.json` (0600) en la carpeta de la mesa', async () => {
    mode = 'mcp'
    const launch = await mcp.prepare(MESA, folder, 'gemini')
    expect(launch.args).toEqual([])
    expect(launch.env).toEqual({})
    expect(await readJson(GEMINI)).toEqual({
      mcpServers: {
        'table-figma': { httpUrl: FIGMA_MCP_URL },
        'table-chrome-devtools': { command: 'npx', args: BROWSER_ARGS },
        'table-notion': { httpUrl: NOTION_URL },
      },
    })
    expect((await stat(join(folder, GEMINI))).mode & 0o777).toBe(0o600)
    expect((await stat(join(root, 'datos', 'agent-mcp-files.json'))).mode & 0o777).toBe(0o600)
    expect(launch.mcp.every(item => item.status === 'configured' && item.hint.includes('confiar en la carpeta'))).toBe(true)
    expectNoCredentials(await readFile(join(folder, GEMINI), 'utf8'))
  })

  it('conserva lo ajeno (también entradas `figma` y `notion` de la persona) y solo quita el Notion de Table', async () => {
    await mkdir(join(folder, '.gemini'))
    const own = { figma: { httpUrl: 'https://otra.example/mcp' }, notion: { command: 'mi-notion' } }
    await writeFile(join(folder, GEMINI), JSON.stringify({ theme: 'GitHub', mcpServers: own }))
    mode = 'mcp'
    await mcp.prepare(MESA, folder, 'gemini')
    expect(await readJson(GEMINI)).toEqual({
      theme: 'GitHub',
      mcpServers: {
        ...own,
        'table-figma': { httpUrl: FIGMA_MCP_URL },
        'table-chrome-devtools': { command: 'npx', args: BROWSER_ARGS },
        'table-notion': { httpUrl: NOTION_URL },
      },
    })
    expect(await mcp.setMode(MESA, 'files')).toBe('files')
    expect(await readJson(GEMINI)).toEqual({
      theme: 'GitHub',
      mcpServers: { ...own, 'table-figma': { httpUrl: FIGMA_MCP_URL }, 'table-chrome-devtools': { command: 'npx', args: BROWSER_ARGS } },
    })
  })

  it('una entrada `table-…` que no creó Table no se toca y la sesión lo dice', async () => {
    await mkdir(join(folder, '.gemini'))
    const theirs = { 'table-figma': { httpUrl: 'https://mia.example/mcp' }, 'table-notion': { httpUrl: 'https://mia.example/notion' } }
    await writeFile(join(folder, GEMINI), JSON.stringify({ mcpServers: theirs }))
    const launch = await mcp.prepare(MESA, folder, 'gemini')
    const servers = (await readJson(GEMINI)).mcpServers
    expect(servers['table-figma']).toEqual(theirs['table-figma'])
    // En «archivos filtrados» tampoco se quita su `table-notion`: no es de Table, y no bloquea.
    expect(servers['table-notion']).toEqual(theirs['table-notion'])
    expect(launch.mcp.find(item => item.name === 'figma')).toMatchObject({ status: 'unsupported', hint: expect.stringContaining('no es de Table') })
    expect(launch.mcp.find(item => item.name === 'browser')?.status).toBe('configured')
  })

  it('conserva permisos más restrictivos y no amplía los del archivo', async () => {
    await mkdir(join(folder, '.gemini'))
    await writeFile(join(folder, GEMINI), '{}', { mode: 0o644 })
    await chmod(join(folder, GEMINI), 0o644)
    await mcp.prepare(MESA, folder, 'gemini')
    expect((await stat(join(folder, GEMINI))).mode & 0o777).toBe(0o600)
    await chmod(join(folder, GEMINI), 0o400)
    mode = 'mcp'
    await mcp.prepare(MESA, folder, 'gemini')
    expect((await stat(join(folder, GEMINI))).mode & 0o777).toBe(0o400)
    expect(Object.keys((await readJson(GEMINI)).mcpServers)).toContain('table-notion')
  })

  it('un archivo que no es JSON no se sobrescribe y la sesión lo dice', async () => {
    await mkdir(join(folder, '.gemini'))
    await writeFile(join(folder, GEMINI), '{ // comentario\n}')
    const launch = await mcp.prepare(MESA, folder, 'gemini')
    expect(await readFile(join(folder, GEMINI), 'utf8')).toBe('{ // comentario\n}')
    expect(launch.mcp.every(item => item.status === 'unsupported' && item.hint.includes('no es JSON válido'))).toBe(true)
  })

  it('no sigue enlaces simbólicos de la configuración (podrían llevar a la global)', async () => {
    const outside = join(root, 'fuera')
    await mkdir(outside)
    await writeFile(join(outside, 'settings.json'), '{}')
    await symlink(outside, join(folder, '.gemini'))
    const launch = await mcp.prepare(MESA, folder, 'gemini')
    expect(await readFile(join(outside, 'settings.json'), 'utf8')).toBe('{}')
    expect(launch.mcp.every(item => item.status === 'unsupported')).toBe(true)
  })
})

describe('quitar Notion que no se puede quitar', () => {
  /** Mesa con Notion por MCP y `.gemini/settings.json` de Table; después la carpeta queda de solo lectura. */
  async function lockedWithNotion(): Promise<void> {
    mode = 'mcp'
    await mcp.prepare(MESA, folder, 'gemini')
    await chmod(join(folder, '.gemini'), 0o500)
  }

  it('el cambio de modo informa del error (no se da por aplicado)', async () => {
    await lockedWithNotion()
    await expect(mcp.setMode(MESA, 'files')).rejects.toThrow(/no pudo actualizar \.gemini\/settings\.json.*no se abrirán/)
    expect(Object.keys((await readJson(GEMINI)).mcpServers)).toContain('table-notion')
  })

  it('bloquea los arneses que leen ese archivo (Gemini CLI y omp); los demás arrancan', async () => {
    await lockedWithNotion()
    await mcp.setMode(MESA, 'files').catch(() => undefined)
    await expect(mcp.prepare(MESA, folder, 'gemini')).rejects.toBeInstanceOf(SessionBlockedError)
    await expect(mcp.prepare(MESA, folder, 'omp')).rejects.toThrow(/no pudo quitar su MCP de Notion de \.gemini\/settings\.json/)
    expect((await mcp.prepare(MESA, folder, 'claude')).mcp.map(item => item.name)).toEqual(['figma', 'browser'])
    // Arreglado el permiso, vuelve a arrancar y Notion desaparece.
    await chmod(join(folder, '.gemini'), 0o700)
    await mcp.prepare(MESA, folder, 'gemini')
    expect(Object.keys((await readJson(GEMINI)).mcpServers)).not.toContain('table-notion')
  })

  it('sobrevive a un reinicio: el registro de Table sigue sabiendo que la entrada es suya', async () => {
    await lockedWithNotion()
    mode = 'files'
    await expect(createMcp().prepare(MESA, folder, 'gemini')).rejects.toBeInstanceOf(SessionBlockedError)
  })
})

describe('carreras entre preparar y cambiar de modo', () => {
  it('una preparación con «MCP completo» que termina después del cambio no vuelve a añadir Notion', async () => {
    mode = 'mcp'
    await mcp.prepare(MESA, folder, 'gemini')
    modeDelay = 50
    const slow = mcp.prepare(MESA, folder, 'gemini')
    const change = mcp.setMode(MESA, 'files')
    const launch = await slow
    await change
    expect(Object.keys((await readJson(GEMINI)).mcpServers)).not.toContain('table-notion')
    // La preparación antigua ya no vale: la sesión se vuelve a preparar.
    expect(launch.isCurrent?.()).toBe(false)
    const fresh = await mcp.prepare(MESA, folder, 'claude')
    expect(fresh.isCurrent?.()).toBe(true)
    expect(fresh.mcp.map(item => item.name)).toEqual(['figma', 'browser'])
  })

  it('una preparación encolada después del cambio usa el modo nuevo', async () => {
    modeDelay = 20
    const change = mcp.setMode(MESA, 'mcp')
    const launch = await mcp.prepare(MESA, folder, 'gemini')
    await change
    expect(launch.mcp.map(item => item.name)).toEqual(['figma', 'browser', 'notion'])
    expect(launch.isCurrent?.()).toBe(true)
  })
})

describe('omp', () => {
  it('`.omp/mcp.json` con navegador (y Notion si toca); Figma no se configura', async () => {
    mode = 'mcp'
    const launch = await mcp.prepare(MESA, folder, 'omp')
    expect(await readJson(OMP)).toEqual({
      mcpServers: {
        'table-chrome-devtools': { type: 'stdio', command: 'npx', args: BROWSER_ARGS },
        'table-notion': { type: 'http', url: NOTION_URL },
      },
    })
    expect(launch.mcp.map(item => [item.name, item.status])).toEqual([
      ['figma', 'unsupported'],
      ['browser', 'configured'],
      ['notion', 'configured'],
    ])
    await mcp.setMode(MESA, 'files')
    expect(await readJson(OMP)).toEqual({ mcpServers: { 'table-chrome-devtools': { type: 'stdio', command: 'npx', args: BROWSER_ARGS } } })
  })
})

describe('sin MCP', () => {
  it('pi y los perfiles propios: todo «unsupported» con el motivo; la terminal normal, nada', () => {
    for (const adapter of ['pi', 'custom']) {
      const launch = agentMcpLaunch(adapter, 'mcp')
      expect(launch.args).toEqual([])
      expect(launch.env).toEqual({})
      expect(launch.files).toEqual([])
      expect(launch.mcp.map(item => item.status)).toEqual(['unsupported', 'unsupported', 'unsupported'])
    }
    expect(agentMcpLaunch('shell', 'mcp')).toEqual({ args: [], env: {}, files: [], mcp: [] })
  })

  it('cambiar el modo no crea archivos que Table no había creado', async () => {
    await mcp.setMode(MESA, 'mcp')
    expect(existsSync(join(folder, '.gemini'))).toBe(false)
    expect(existsSync(join(folder, '.omp'))).toBe(false)
  })

  it('una carpeta que no pasa la comprobación no se toca', async () => {
    const guarded = createAgentMcp({
      mode: async () => 'mcp',
      saveMode: async (_mesaId, next) => next,
      folder: async () => folder,
      verifyFolder: async () => {
        throw new Error('no es una carpeta normal')
      },
      registryFile: join(root, 'datos', 'agent-mcp-files.json'),
    })
    await expect(guarded.prepare(MESA, folder, 'gemini')).rejects.toThrow('no es una carpeta normal')
    await expect(guarded.setMode(MESA, 'files')).rejects.toThrow('no es una carpeta normal')
    expect(existsSync(join(folder, '.gemini'))).toBe(false)
  })
})
