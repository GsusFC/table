import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NotionSettingsView } from '../../shared/notion'
import { writeFileAtomic } from '../files'

/**
 * Configuración global de Table (fuera de las mesas y de Git), en
 * `<userData>/settings.json`. Las credenciales se guardan cifradas con el
 * llavero del sistema; el archivo nunca las contiene en claro.
 */
interface SettingsFile {
  readonly version: 2
  readonly notion: {
    /** Credenciales OAuth del MCP de Notion (cliente registrado y tokens), cifradas, en base64. */
    readonly connection: string | null
    readonly workspaceName: string | null
    readonly userName: string | null
  }
}

/** Credenciales de la conexión con el MCP de Notion. Formato del SDK de MCP; Table no las interpreta. */
export interface NotionConnection {
  readonly client: unknown
  readonly tokens: unknown
}

export interface NotionIdentity {
  readonly workspaceName: string | null
  readonly userName: string | null
}

/** Cifrado del sistema; en Electron, `safeStorage` (Keychain en macOS). */
export interface SecretBox {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(encrypted: Buffer): string
}

export interface SettingsStore {
  /** Sube al conectar o desconectar: invalida lecturas de Notion iniciadas con la conexión anterior. */
  revision(): number
  notionView(): NotionSettingsView
  /** Credenciales descifradas, o null. Solo para el proceso principal. */
  notionConnection(): NotionConnection | null
  /** Guarda una conexión nueva (sube la revisión). */
  connectNotion(connection: NotionConnection, identity: NotionIdentity): Promise<void>
  /** Sustituye las credenciales de la conexión actual (tokens renovados) sin cambiar la revisión. */
  updateNotionConnection(connection: NotionConnection): Promise<void>
  disconnectNotion(): Promise<void>
}

const EMPTY: SettingsFile = { version: 2, notion: { connection: null, workspaceName: null, userName: null } }

export function createSettingsStore(userData: string, box: SecretBox): SettingsStore {
  const path = join(userData, 'settings.json')
  let settings = load(path)
  let revision = 0
  let queue: Promise<unknown> = Promise.resolve()

  /** Cada cambio se calcula sobre el estado vigente dentro de la cola: dos cambios seguidos no se pisan. */
  function update(change: (current: SettingsFile) => SettingsFile, bump: boolean): Promise<void> {
    const write = queue.then(async () => {
      const next = change(settings)
      await writeFileAtomic(path, `${JSON.stringify(next, null, 2)}\n`)
      settings = next
      if (bump) {
        revision += 1
      }
    })
    queue = write.catch(() => undefined)
    return write
  }

  function seal(connection: NotionConnection): string {
    if (!box.isAvailable()) {
      throw new Error('El llavero del sistema no está disponible; no se guarda la conexión con Notion')
    }
    return box.encrypt(JSON.stringify(connection)).toString('base64')
  }

  return {
    revision() {
      return revision
    },

    notionView() {
      const { connection, workspaceName, userName } = settings.notion
      return { connected: connection !== null, workspaceName, userName }
    },

    notionConnection() {
      if (!settings.notion.connection || !box.isAvailable()) {
        return null
      }
      try {
        const parsed = JSON.parse(box.decrypt(Buffer.from(settings.notion.connection, 'base64'))) as Partial<NotionConnection>
        return { client: parsed.client, tokens: parsed.tokens }
      } catch {
        // Llavero distinto (otro equipo o copia de datos): hay que volver a conectar.
        return null
      }
    },

    async connectNotion(connection, identity) {
      const sealed = seal(connection)
      await update(current => ({ ...current, notion: { connection: sealed, ...identity } }), true)
    },

    async updateNotionConnection(connection) {
      const sealed = seal(connection)
      // Solo si sigue conectado: una renovación tardía no resucita una conexión quitada.
      await update(current => (current.notion.connection ? { ...current, notion: { ...current.notion, connection: sealed } } : current), false)
    },

    async disconnectNotion() {
      await update(current => ({ ...current, notion: EMPTY.notion }), true)
    },
  }
}

/** Ajustes ilegibles o de otra versión (la 1 usaba un token pegado): se empieza en blanco. */
function load(path: string): SettingsFile {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return EMPTY
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SettingsFile> | null
    const notion = parsed?.notion
    if (parsed?.version !== 2 || !notion) {
      return EMPTY
    }
    return {
      version: 2,
      notion: {
        connection: typeof notion.connection === 'string' ? notion.connection : null,
        workspaceName: typeof notion.workspaceName === 'string' ? notion.workspaceName : null,
        userName: typeof notion.userName === 'string' ? notion.userName : null,
      },
    }
  } catch {
    return EMPTY
  }
}
