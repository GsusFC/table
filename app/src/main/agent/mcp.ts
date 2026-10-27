import type { Stats } from 'node:fs'
import { lstat, mkdir, readFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { AGENT_TOOLS } from '../../shared/agentTools'
import type { AgentNotionMode, MesaId } from '../../shared/model'
import type { AgentMcpName, SessionMcp } from '../../shared/terminal'
import { writeFileAtomic } from '../files'
import { log } from '../log'
import { NOTION_MCP_URL } from '../notion/mcp'
import { SessionBlockedError, type SessionLaunch } from '../terminal/sessions'
import { TABLE_MCP_ENV_NAMES } from './tableMcp'

/**
 * MCP de los agentes (D-019, T-010). Table configura en cada sesión de un
 * arnés conocido el MCP oficial de Figma, uno de navegador que usa el Chrome
 * de la persona y, si la mesa lo permite, el MCP oficial de Notion. Solo
 * define servidores: nunca copia credenciales de Table; cada arnés hace su
 * propia autorización con la cuenta de la persona.
 *
 * Por arnés (comprobado con las versiones instaladas el 2026-10-27, ver
 * docs/tasks/010-mcp-de-los-agentes.md):
 * - Claude Code: `--mcp-config=<json>` en el arranque (sin aprobación de proyecto).
 * - Codex: `-c mcp_servers.<nombre>.…` en el arranque (la configuración de
 *   proyecto solo se lee en carpetas de confianza).
 * - Gemini CLI: `.gemini/settings.json` en la carpeta de la mesa (se aplica
 *   cuando la persona confía en la carpeta desde Gemini).
 * - OpenCode: variable `OPENCODE_CONFIG_CONTENT` (se fusiona con su configuración).
 * - omp: `.omp/mcp.json` en la carpeta de la mesa; Figma no autoriza a omp.
 * - pi, perfiles propios: sin MCP.
 *
 * Los servidores se llaman `table-…` para no pisar los de la persona, y en
 * los archivos de proyecto Table solo toca las entradas que creó él (lo
 * anota en un registro en sus datos).
 */

export const FIGMA_MCP_URL = 'https://mcp.figma.com/mcp'
/** Chrome DevTools MCP de Google, versión fijada: se conecta al Chrome en uso (Chrome 144+) con permiso de la persona. */
export const BROWSER_MCP_PACKAGE = 'chrome-devtools-mcp@1.12.0'
/**
 * Dirección fija del servidor de depuración que abre `chrome://inspect/#remote-debugging`.
 * No se usa `--autoConnect`: lee `DevToolsActivePort` del perfil de Chrome, y macOS
 * protege esa carpeta frente a otras apps (`deny file-read-data`, comprobado el 2026-10-27).
 * Sin el identificador de la URL, Chrome acepta la conexión tras su diálogo «Permitir».
 */
export const BROWSER_WS_ENDPOINT = 'ws://127.0.0.1:9222/devtools/browser'
const BROWSER_MCP_COMMAND = 'npx'
const BROWSER_MCP_ARGS: readonly string[] = [
  '-y',
  BROWSER_MCP_PACKAGE,
  `--wsEndpoint=${BROWSER_WS_ENDPOINT}`,
  '--no-usage-statistics',
  '--no-performance-crux',
]

type McpTransport =
  | { readonly kind: 'remote'; readonly url: string }
  | {
      readonly kind: 'local'
      readonly command: string
      readonly args: readonly string[]
      /** Variables fijas para el servidor. */
      readonly env?: Readonly<Record<string, string>>
      /** Variables de la sesión que el arnés tiene que reenviar (Codex no pasa el entorno entero). */
      readonly forwardEnv?: readonly string[]
    }

export interface AgentMcpServer {
  readonly name: AgentMcpName
  /** Nombre del servidor en la configuración de cada arnés. */
  readonly key: string
  readonly transport: McpTransport
}

/** Cómo arranca el arnés el puente stdio del MCP de Table (T-011). */
export interface TableBridge {
  /** Ejecutable de Table (`process.execPath`), en modo Node. */
  readonly command: string
  readonly args: readonly string[]
}

const FIGMA: AgentMcpServer = { name: 'figma', key: 'table-figma', transport: { kind: 'remote', url: FIGMA_MCP_URL } }
/**
 * Sin `browser` en el nombre: omp descarta los MCP de navegador que se llaman
 * así. Con las variables del MCP de Table vacías: el arnés pasa su entorno a
 * sus MCP, y el navegador (un paquete de terceros) no debe recibir el testigo
 * de la sesión. Codex no las pasa salvo con `env_vars`, que solo lleva `table`.
 */
const BROWSER: AgentMcpServer = {
  name: 'browser',
  key: 'table-chrome-devtools',
  transport: {
    kind: 'local',
    command: BROWSER_MCP_COMMAND,
    args: BROWSER_MCP_ARGS,
    env: Object.fromEntries(TABLE_MCP_ENV_NAMES.map(name => [name, ''])),
  },
}
const NOTION: AgentMcpServer = { name: 'notion', key: 'table-notion', transport: { kind: 'remote', url: NOTION_MCP_URL } }
export const NOTION_MCP_KEY = NOTION.key
export const TABLE_MCP_KEY = 'table'

function tableServer(bridge: TableBridge): AgentMcpServer {
  return {
    name: 'table',
    key: TABLE_MCP_KEY,
    transport: {
      kind: 'local',
      command: bridge.command,
      args: bridge.args,
      env: { ELECTRON_RUN_AS_NODE: '1' },
      forwardEnv: TABLE_MCP_ENV_NAMES,
    },
  }
}

/** Servidores de una sesión: Table (si su servidor está en marcha), Figma y navegador siempre; Notion solo si la mesa lo permite. */
export function agentMcpServers(mode: AgentNotionMode, bridge: TableBridge | null = null): readonly AgentMcpServer[] {
  return [...(bridge ? [tableServer(bridge)] : []), FIGMA, BROWSER, ...(mode === 'mcp' ? [NOTION] : [])]
}

/** Lo que puede hacer el agente con el MCP de Table, para el chip. */
const TABLE_HINT = `El agente trabaja en esta mesa: ${AGENT_TOOLS.map(tool => tool.title.toLowerCase()).join(', ')}. Borrar pide tu confirmación en Table. No hace falta autorizarlo.`

const BROWSER_HINT =
  'Usa tu Chrome (versión 144 o posterior): activa una vez chrome://inspect/#remote-debugging; Chrome pide permiso cada vez que el agente se conecta. Con el permiso, el agente puede abrir cualquier web de ese Chrome, Notion incluido.'
const NOTION_WARNING = 'Sin filtro de Table: el agente puede leer presupuestos, oportunidades e importes.'

/** Archivo de configuración de proyecto en la carpeta de la mesa, fusionado con lo que ya tenga. */
export interface McpProjectFile {
  /** Ruta relativa a la carpeta de la mesa. */
  readonly path: string
  /** Entradas de Table en `mcpServers`, ya en el formato del arnés. */
  readonly servers: Readonly<Record<string, unknown>>
  /** Entradas que Table puede gestionar en este archivo: se quitan si ya no tocan (solo si las creó Table). */
  readonly managed: readonly string[]
}

/** Lo que el arnés recibe al arrancar, más lo que muestra el panel. Función pura de arnés y modo. */
export interface McpLaunch {
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly files: readonly McpProjectFile[]
  readonly mcp: readonly SessionMcp[]
}

const NONE: McpLaunch = { args: [], env: {}, files: [], mcp: [] }

function entry(server: AgentMcpServer, hint: string, status: SessionMcp['status'] = 'configured'): SessionMcp {
  return { name: server.name, status, hint }
}

function serverMap(servers: readonly AgentMcpServer[], format: (transport: McpTransport) => unknown): Record<string, unknown> {
  return Object.fromEntries(servers.map(server => [server.key, format(server.transport)]))
}

/** Servidor local en el formato habitual (`command`, `args`, `env`): Claude Code, Gemini CLI, omp. */
function stdioEntry(transport: Extract<McpTransport, { kind: 'local' }>, type?: 'stdio'): Record<string, unknown> {
  return {
    ...(type ? { type } : {}),
    command: transport.command,
    args: transport.args,
    ...(transport.env ? { env: transport.env } : {}),
  }
}

/** Ayuda del chip: Table y navegador, iguales en todos; el resto, la del arnés. */
function hint(server: AgentMcpServer, auth: (server: AgentMcpServer) => string): string {
  if (server.name === 'table') {
    return TABLE_HINT
  }
  if (server.name === 'browser') {
    return BROWSER_HINT
  }
  return server.name === 'notion' ? `${auth(server)} ${NOTION_WARNING}` : auth(server)
}

function claude(servers: readonly AgentMcpServer[]): McpLaunch {
  const config = {
    mcpServers: serverMap(servers, transport => (transport.kind === 'remote' ? { type: 'http', url: transport.url } : stdioEntry(transport, 'stdio'))),
  }
  return {
    // Con `=`: `--mcp-config` admite varios valores y se comería los argumentos siguientes.
    args: [`--mcp-config=${JSON.stringify(config)}`],
    env: {},
    files: [],
    mcp: servers.map(server =>
      entry(server, hint(server, ({ key }) => `Escribe /mcp en Claude Code, elige ${key} y «Authenticate» para autorizarlo con tu cuenta.`)),
    ),
  }
}

/** `-c clave=valor` de Codex: el valor se lee como TOML; JSON de textos y listas de textos lo es. */
function codex(servers: readonly AgentMcpServer[]): McpLaunch {
  const args: string[] = []
  for (const server of servers) {
    const prefix = `mcp_servers.${server.key}`
    const transport = server.transport
    if (transport.kind === 'remote') {
      args.push('-c', `${prefix}.url=${JSON.stringify(transport.url)}`)
      continue
    }
    args.push('-c', `${prefix}.command=${JSON.stringify(transport.command)}`, '-c', `${prefix}.args=${JSON.stringify(transport.args)}`)
    if (transport.env) {
      // Tabla en línea de TOML: `{NOMBRE="valor"}`.
      const pairs = Object.entries(transport.env).map(([name, value]) => `${name}=${JSON.stringify(value)}`)
      args.push('-c', `${prefix}.env={${pairs.join(',')}}`)
    }
    if (transport.forwardEnv) {
      // Codex no pasa el entorno entero a sus MCP: solo los nombres de `env_vars`.
      args.push('-c', `${prefix}.env_vars=${JSON.stringify(transport.forwardEnv)}`)
    }
    if (server.name === 'browser') {
      // La primera vez `npx` descarga el paquete: más que los 10 s por defecto.
      args.push('-c', `${prefix}.startup_timeout_sec=60`)
    }
  }
  return {
    args,
    env: {},
    files: [],
    mcp: servers.map(server =>
      entry(
        server,
        hint(server, ({ key, transport }) =>
          transport.kind === 'remote'
            ? `Para autorizarlo, ejecuta una vez en una terminal: codex mcp login ${key} -c mcp_servers.${key}.url="${transport.url}".`
            : '',
        ),
      ),
    ),
  }
}

const GEMINI_SETTINGS = '.gemini/settings.json'
const OMP_SETTINGS = '.omp/mcp.json'
const GEMINI_TRUST = 'Gemini pide confiar en la carpeta de la mesa la primera vez: acéptalo para cargar los MCP.'

function geminiFile(servers: readonly AgentMcpServer[]): McpProjectFile {
  return {
    path: GEMINI_SETTINGS,
    servers: serverMap(servers, transport => (transport.kind === 'remote' ? { httpUrl: transport.url } : stdioEntry(transport))),
    managed: [TABLE_MCP_KEY, FIGMA.key, BROWSER.key, NOTION.key],
  }
}

function gemini(servers: readonly AgentMcpServer[]): McpLaunch {
  return {
    args: [],
    env: {},
    files: [geminiFile(servers)],
    mcp: servers.map(server => entry(server, `${GEMINI_TRUST} ${hint(server, ({ key }) => `Después, autoriza con /mcp auth ${key}.`)}`)),
  }
}

function opencode(servers: readonly AgentMcpServer[]): McpLaunch {
  const config = {
    $schema: 'https://opencode.ai/config.json',
    mcp: serverMap(servers, transport =>
      transport.kind === 'remote'
        ? { type: 'remote', url: transport.url }
        : { type: 'local', command: [transport.command, ...transport.args], ...(transport.env ? { environment: transport.env } : {}) },
    ),
  }
  return {
    args: [],
    env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
    files: [],
    mcp: servers.map(server => entry(server, hint(server, ({ key }) => `OpenCode abre la autorización la primera vez que el agente usa ${key}.`))),
  }
}

function ompFile(servers: readonly AgentMcpServer[]): McpProjectFile {
  // Figma solo registra clientes de su catálogo; a omp le responde «Forbidden».
  return {
    path: OMP_SETTINGS,
    servers: serverMap(
      servers.filter(server => server.name !== 'figma'),
      transport => (transport.kind === 'remote' ? { type: 'http', url: transport.url } : stdioEntry(transport, 'stdio')),
    ),
    managed: [TABLE_MCP_KEY, BROWSER.key, NOTION.key],
  }
}

function omp(servers: readonly AgentMcpServer[]): McpLaunch {
  return {
    args: [],
    env: {},
    files: [ompFile(servers)],
    mcp: servers.map(server =>
      server.name === 'figma'
        ? entry(server, 'Figma solo autoriza a los clientes de su catálogo y omp no está en él. Usa Claude Code, Codex, Gemini CLI u OpenCode.', 'unsupported')
        : entry(server, hint(server, ({ key }) => `Autoriza con /mcp reauth ${key} en omp.`)),
    ),
  }
}

function unsupported(servers: readonly AgentMcpServer[], reason: string): McpLaunch {
  return { ...NONE, mcp: servers.map(server => entry(server, reason, 'unsupported')) }
}

/**
 * Configuración de MCP para un arnés (`adapterId`: el ID del perfil del
 * catálogo, `custom` para los propios, `shell` para la terminal normal).
 * Función pura: no toca disco.
 */
export function agentMcpLaunch(adapterId: string, mode: AgentNotionMode, bridge: TableBridge | null = null): McpLaunch {
  const servers = agentMcpServers(mode, bridge)
  switch (adapterId) {
    case 'claude':
      return claude(servers)
    case 'codex':
      return codex(servers)
    case 'gemini':
      return gemini(servers)
    case 'opencode':
      return opencode(servers)
    case 'omp':
      return omp(servers)
    case 'pi':
      return unsupported(servers, 'pi no admite MCP sin extensiones: el agente usa TABLE.md y notion/.')
    case 'shell':
      return NONE
    default:
      return unsupported(servers, 'Perfil propio: Table no sabe qué arnés es y no le configura MCP. El agente usa TABLE.md y notion/.')
  }
}

/** Arneses en los que Table configura su propio MCP (y registra la sesión en su servidor). */
export function supportsTableMcp(adapterId: string): boolean {
  return ['claude', 'codex', 'gemini', 'opencode', 'omp'].includes(adapterId)
}

/** Archivos de proyecto que Table puede crear, por ruta relativa. */
const PROJECT_FILES: Readonly<Record<string, (mode: AgentNotionMode, bridge: TableBridge | null) => McpProjectFile>> = {
  [GEMINI_SETTINGS]: (mode, bridge) => geminiFile(agentMcpServers(mode, bridge)),
  [OMP_SETTINGS]: (mode, bridge) => ompFile(agentMcpServers(mode, bridge)),
}

/** Archivos de proyecto que lee cada arnés al arrancar (omp también importa la configuración de Gemini CLI). */
const PROJECT_FILE_READERS: Readonly<Record<string, readonly string[]>> = {
  gemini: [GEMINI_SETTINGS],
  omp: [OMP_SETTINGS, GEMINI_SETTINGS],
}

/** `lstat`, o null si la ruta no existe. */
async function lstatIfExists(path: string): Promise<Stats | null> {
  try {
    return await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

type ConfigObject = { readonly [key: string]: unknown; readonly mcpServers?: Readonly<Record<string, unknown>> }

/** Objeto JSON de configuración con `mcpServers` ausente o también objeto; null si no. */
function configObject(value: unknown): ConfigObject | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  if (!('mcpServers' in value) || value.mcpServers === undefined) {
    return value as ConfigObject
  }
  const servers = value.mcpServers
  // Objeto JSON recién leído: sus claves son de texto y sus valores, cualquiera.
  return typeof servers === 'object' && servers !== null && !Array.isArray(servers) ? (value as ConfigObject) : null
}

/** Permisos del archivo reescrito: 0600, o los del original si son más restrictivos. */
const CONFIG_FILE_MODE = 0o600

type FilePlan =
  | { readonly kind: 'error'; readonly reason: string }
  | { readonly kind: 'absent' }
  | {
      readonly kind: 'merge'
      readonly text: string | null
      readonly mode: number
      readonly owned: ReadonlySet<string>
      readonly conflicts: readonly string[]
    }

/**
 * Lee el archivo y calcula la fusión: escribe las entradas que tocan, quita
 * las gestionadas que ya no tocan, y nunca toca una entrada que no creó Table
 * (`owned`): si tiene el mismo nombre que una de Table, es un conflicto. La
 * carpeta y el archivo tienen que ser normales (nunca enlaces simbólicos: un
 * enlace podría llevar la escritura a la configuración global del arnés).
 */
async function planProjectFile(path: string, file: McpProjectFile, owned: ReadonlySet<string>, create: boolean): Promise<FilePlan> {
  const dir = dirname(path)
  const dirStat = await lstatIfExists(dir)
  if (dirStat === null) {
    if (!create) {
      return { kind: 'absent' }
    }
    await mkdir(dir)
  } else if (!dirStat.isDirectory()) {
    return { kind: 'error', reason: `${file.path}: su carpeta no es una carpeta normal; Table no la toca.` }
  }
  const fileStat = await lstatIfExists(path)
  if (fileStat === null && !create) {
    return { kind: 'absent' }
  }
  if (fileStat !== null && !fileStat.isFile()) {
    return { kind: 'error', reason: `${file.path} no es un archivo normal; Table no lo toca.` }
  }
  let current: ConfigObject = {}
  if (fileStat !== null) {
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(path, 'utf8'))
    } catch {
      return { kind: 'error', reason: `${file.path} no es JSON válido; Table no lo sobrescribe.` }
    }
    const config = configObject(parsed)
    if (config === null) {
      return { kind: 'error', reason: `${file.path} no tiene la forma esperada; Table no lo sobrescribe.` }
    }
    current = config
  }
  const servers: Record<string, unknown> = { ...current.mcpServers }
  const nextOwned = new Set(owned)
  const conflicts: string[] = []
  for (const key of file.managed) {
    const wanted = file.servers[key]
    const present = Object.hasOwn(servers, key)
    if (present && !owned.has(key)) {
      // De la persona (o de otra herramienta): no se toca.
      if (wanted !== undefined) {
        conflicts.push(key)
      }
      continue
    }
    if (wanted !== undefined) {
      servers[key] = wanted
      nextOwned.add(key)
    } else {
      delete servers[key]
      nextOwned.delete(key)
    }
  }
  const next = { ...current, mcpServers: servers }
  const changed = fileStat === null || JSON.stringify(current) !== JSON.stringify(next)
  return {
    kind: 'merge',
    text: changed ? `${JSON.stringify(next, null, 2)}\n` : null,
    mode: fileStat === null ? CONFIG_FILE_MODE : fileStat.mode & CONFIG_FILE_MODE,
    owned: nextOwned,
    conflicts,
  }
}

interface ApplyResult {
  /** Motivo si no se pudo aplicar; el archivo queda como estaba. */
  readonly reason: string | null
  /** Entradas de la persona con el nombre de una de Table. */
  readonly conflicts: readonly string[]
  /** Entradas de Table que siguen en el archivo después de aplicar. */
  readonly owned: ReadonlySet<string>
}

/** Registro de las entradas que Table creó en cada archivo de proyecto (ruta absoluta → nombres). */
interface Registry {
  readonly version: 1
  readonly files: Readonly<Record<string, readonly string[]>>
}

function parseRegistry(text: string): Record<string, readonly string[]> {
  const value: unknown = JSON.parse(text)
  if (typeof value !== 'object' || value === null || !('files' in value) || typeof value.files !== 'object' || value.files === null) {
    throw new Error('Registro de MCP no válido')
  }
  const files: Record<string, readonly string[]> = {}
  for (const [path, keys] of Object.entries(value.files)) {
    if (Array.isArray(keys) && keys.every(key => typeof key === 'string')) {
      files[path] = keys
    }
  }
  return files
}

export interface AgentMcpOptions {
  /** Modo de Notion guardado en la mesa; se lee dentro de la cola. */
  mode(mesaId: MesaId): Promise<AgentNotionMode>
  /** Guarda el modo en la mesa y devuelve el guardado. */
  saveMode(mesaId: MesaId, mode: AgentNotionMode): Promise<AgentNotionMode>
  /** Carpeta de trabajo de la mesa (ya comprobada). */
  folder(mesaId: MesaId): Promise<string>
  /** Lanza si la carpeta ya no es la carpeta normal de la mesa dentro de la raíz de Table (p. ej. un enlace simbólico). */
  verifyFolder(folder: string): Promise<void>
  /** Registro de entradas de Table (en los datos de Table). */
  registryFile: string
  /** Puente del MCP de Table, o null si su servidor no está en marcha (entonces no se configura). */
  tableBridge?: () => TableBridge | null
}

export interface AgentMcp {
  /**
   * Antes de arrancar un arnés: deja los archivos de proyecto de Table de la
   * carpeta al día con el modo de la mesa, escribe los del arnés y devuelve
   * argumentos, entorno y MCP de la sesión. Si un archivo que ese arnés lee
   * podría seguir teniendo el Notion de Table con la mesa en «archivos
   * filtrados», lanza `SessionBlockedError` y la sesión no se abre.
   */
  prepare(mesaId: MesaId, folder: string, adapterId: string): Promise<SessionLaunch>
  /**
   * Guarda el modo y reescribe los archivos de proyecto de Table de la
   * carpeta. Si alguno no se puede actualizar, lanza con el motivo (el modo
   * queda guardado y los arneses que leen ese archivo no arrancan).
   */
  setMode(mesaId: MesaId, mode: AgentNotionMode): Promise<AgentNotionMode>
}

export function createAgentMcp(options: AgentMcpOptions): AgentMcp {
  /**
   * Una sola cola para preparar sesiones y cambiar el modo (de todas las
   * mesas, que comparten el registro): una preparación antigua no puede
   * escribir Notion después de quitarlo.
   */
  let queue: Promise<unknown> = Promise.resolve()
  /** Cambios de modo por mesa: una preparación de antes de un cambio ya no vale. */
  const revisions = new Map<MesaId, number>()
  let registry: Record<string, readonly string[]> | null = null

  function enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = queue.then(run, run)
    queue = next.catch(() => undefined)
    return next
  }

  async function loadRegistry(): Promise<Record<string, readonly string[]>> {
    if (registry === null) {
      try {
        registry = parseRegistry(await readFile(options.registryFile, 'utf8'))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          log('agent-mcp-registry-unreadable', { message: error instanceof Error ? error.message : String(error) })
        }
        registry = {}
      }
    }
    return registry
  }

  async function setOwned(path: string, owned: ReadonlySet<string>): Promise<void> {
    const current = await loadRegistry()
    const before = current[path] ?? []
    if (before.length === owned.size && before.every(key => owned.has(key))) {
      return
    }
    const { [path]: _previous, ...rest } = current
    const next: Record<string, readonly string[]> = owned.size > 0 ? { ...rest, [path]: [...owned].sort() } : rest
    const data: Registry = { version: 1, files: next }
    await writeFileAtomic(options.registryFile, `${JSON.stringify(data, null, 2)}\n`, { mode: CONFIG_FILE_MODE })
    registry = next
  }

  /**
   * Aplica un archivo y mantiene el registro. Antes de escribir se anotan
   * también las entradas nuevas: si algo falla a medias, Table sigue sabiendo
   * que son suyas y podrá quitarlas.
   */
  async function apply(folder: string, file: McpProjectFile, create: boolean): Promise<ApplyResult> {
    const path = join(folder, file.path)
    const owned = new Set((await loadRegistry())[path] ?? [])
    try {
      const plan = await planProjectFile(path, file, owned, create)
      if (plan.kind === 'error') {
        return { reason: plan.reason, conflicts: [], owned }
      }
      if (plan.kind === 'absent') {
        // Sin archivo no queda ninguna entrada de Table.
        await setOwned(path, new Set())
        return { reason: null, conflicts: [], owned: new Set() }
      }
      if (plan.text !== null) {
        await setOwned(path, new Set([...owned, ...plan.owned]))
        await writeFileAtomic(path, plan.text, { mode: plan.mode })
      }
      await setOwned(path, plan.owned)
      return { reason: null, conflicts: plan.conflicts, owned: plan.owned }
    } catch (error) {
      log('agent-mcp-file-failed', { file: file.path, message: error instanceof Error ? error.message : String(error) })
      return { reason: `No se pudo escribir ${file.path}.`, conflicts: [], owned }
    }
  }

  /** Reescribe con `mode` los archivos de la carpeta donde Table tiene entradas. Devuelve los que fallaron. */
  async function syncFolder(folder: string, mode: AgentNotionMode): Promise<{ path: string; reason: string; notionLeft: boolean }[]> {
    const failures: { path: string; reason: string; notionLeft: boolean }[] = []
    const tracked = Object.keys(await loadRegistry()).filter(path => path.startsWith(folder + sep))
    for (const absolute of tracked) {
      const relativePath = absolute.slice(folder.length + 1)
      const spec = PROJECT_FILES[relativePath]
      if (!spec) {
        continue
      }
      const result = await apply(folder, spec(mode, options.tableBridge?.() ?? null), false)
      if (result.reason !== null) {
        failures.push({ path: relativePath, reason: result.reason, notionLeft: mode === 'files' && result.owned.has(NOTION.key) })
      }
    }
    return failures
  }

  return {
    prepare(mesaId, folder, adapterId) {
      // Al pedirla: si después (aunque sea antes de que corra en la cola) cambia el modo, ya no vale.
      const revision = revisions.get(mesaId) ?? 0
      return enqueue(async () => {
        const mode = await options.mode(mesaId)
        const bridge = options.tableBridge?.() ?? null
        const launch = agentMcpLaunch(adapterId, mode, bridge)
        const reads = PROJECT_FILE_READERS[adapterId] ?? []
        if (reads.length === 0) {
          return { args: launch.args, env: launch.env, mcp: launch.mcp, isCurrent: () => (revisions.get(mesaId) ?? 0) === revision }
        }
        await options.verifyFolder(folder)
        const stuck = (await syncFolder(folder, mode)).filter(failure => failure.notionLeft && reads.includes(failure.path))
        if (stuck.length > 0) {
          throw new SessionBlockedError(
            `La mesa usa «archivos filtrados», pero Table no pudo quitar su MCP de Notion de ${stuck
              .map(failure => failure.path)
              .join(' y ')} (${stuck.map(failure => failure.reason).join(' ')}). Arréglalo o quita la entrada «${NOTION.key}» y vuelve a abrir la sesión.`,
          )
        }
        const results = await Promise.all(launch.files.map(file => apply(folder, file, true)))
        const reasons = results.map(result => result.reason).filter((reason): reason is string => reason !== null)
        const conflicts = new Set(results.flatMap(result => result.conflicts))
        const servers = agentMcpServers(mode, bridge)
        const mcp = launch.mcp.map((item): SessionMcp => {
          if (item.status !== 'configured') {
            return item
          }
          if (reasons.length > 0) {
            return { ...item, status: 'unsupported', hint: reasons.join(' ') }
          }
          const key = servers.find(server => server.name === item.name)?.key
          return key !== undefined && conflicts.has(key)
            ? { ...item, status: 'unsupported', hint: `Ya hay una entrada «${key}» que no es de Table en la configuración del arnés; Table no la toca.` }
            : item
        })
        return { args: launch.args, env: launch.env, mcp, isCurrent: () => (revisions.get(mesaId) ?? 0) === revision }
      })
    },

    setMode(mesaId, mode) {
      // Al momento: una preparación en curso o ya hecha con el modo anterior deja de valer.
      revisions.set(mesaId, (revisions.get(mesaId) ?? 0) + 1)
      return enqueue(async () => {
        const saved = await options.saveMode(mesaId, mode)
        const folder = await options.folder(mesaId)
        await options.verifyFolder(folder)
        const failures = await syncFolder(folder, saved)
        if (failures.length > 0) {
          const label = saved === 'mcp' ? 'MCP completo' : 'archivos filtrados'
          throw new Error(
            `Se guardó «${label}», pero Table no pudo actualizar ${failures.map(failure => failure.path).join(' y ')}: ${failures
              .map(failure => failure.reason)
              .join(' ')}${failures.some(failure => failure.notionLeft) ? ' Las sesiones de los arneses que lo leen no se abrirán hasta que se arregle.' : ''}`,
          )
        }
        return saved
      })
    },
  }
}
