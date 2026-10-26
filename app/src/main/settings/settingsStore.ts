import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeNotionId, type NotionDatabase, type NotionSettingsView } from '../../shared/notion'
import { writeFileAtomic } from '../files'

/**
 * Configuración global de Table (fuera de las mesas y de Git), en
 * `<userData>/settings.json`. Los tokens se guardan cifrados con el llavero
 * del sistema; el archivo nunca contiene un token en claro.
 */
interface SettingsFile {
  readonly version: 1
  readonly notion: {
    /** Token cifrado, en base64. */
    readonly token: string | null
    readonly tokenHint: string | null
    readonly database: NotionDatabase | null
  }
}

/** Cifrado del sistema; en Electron, `safeStorage` (Keychain en macOS). */
export interface SecretBox {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(encrypted: Buffer): string
}

export interface SettingsStore {
  /** Sube con cada cambio guardado: invalida lecturas de Notion iniciadas con la configuración anterior. */
  revision(): number
  notionView(): NotionSettingsView
  /** Token descifrado, o null. Solo para el cliente de Notion del proceso principal. */
  notionToken(): string | null
  setNotionToken(token: string): Promise<void>
  clearNotionToken(): Promise<void>
  setNotionDatabase(database: NotionDatabase | null): Promise<void>
}

const EMPTY: SettingsFile = { version: 1, notion: { token: null, tokenHint: null, database: null } }

/** Los tokens de integración de Notion empiezan por `ntn_` (antes `secret_`). */
export function parseNotionToken(value: unknown): string {
  const token = typeof value === 'string' ? value.trim() : ''
  if (!/^(ntn_|secret_)[A-Za-z0-9]{20,200}$/.test(token)) {
    throw new Error('Pega el token completo de la integración de Notion (empieza por ntn_)')
  }
  return token
}

export function createSettingsStore(userData: string, box: SecretBox): SettingsStore {
  const path = join(userData, 'settings.json')
  let settings = load(path)
  let revision = 0
  let queue: Promise<unknown> = Promise.resolve()

  /** Cada cambio se calcula sobre el estado vigente dentro de la cola: dos cambios seguidos no se pisan. */
  function update(change: (current: SettingsFile) => SettingsFile): Promise<void> {
    const write = queue.then(async () => {
      const next = change(settings)
      await writeFileAtomic(path, `${JSON.stringify(next, null, 2)}\n`)
      settings = next
      revision += 1
    })
    queue = write.catch(() => undefined)
    return write
  }

  return {
    revision() {
      return revision
    },

    notionView() {
      return { hasToken: settings.notion.token !== null, tokenHint: settings.notion.tokenHint, database: settings.notion.database }
    },

    notionToken() {
      if (!settings.notion.token || !box.isAvailable()) {
        return null
      }
      try {
        return box.decrypt(Buffer.from(settings.notion.token, 'base64'))
      } catch {
        // Llavero distinto (otro equipo o copia de datos): hay que volver a pegarlo.
        return null
      }
    },

    async setNotionToken(token) {
      const valid = parseNotionToken(token)
      if (!box.isAvailable()) {
        throw new Error('El llavero del sistema no está disponible; no se guarda el token')
      }
      const encrypted = box.encrypt(valid).toString('base64')
      await update(current => ({ ...current, notion: { ...current.notion, token: encrypted, tokenHint: valid.slice(-4) } }))
    },

    async clearNotionToken() {
      await update(current => ({ ...current, notion: { ...current.notion, token: null, tokenHint: null } }))
    },

    async setNotionDatabase(database) {
      await update(current => ({ ...current, notion: { ...current.notion, database } }))
    },
  }
}

/** Ajustes ilegibles o de otra versión: se empieza en blanco sin borrar el archivo hasta guardar. */
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
    if (parsed?.version !== 1 || !notion) {
      return EMPTY
    }
    const databaseId = typeof notion.database?.id === 'string' ? normalizeNotionId(notion.database.id) : null
    return {
      version: 1,
      notion: {
        token: typeof notion.token === 'string' ? notion.token : null,
        tokenHint: typeof notion.tokenHint === 'string' ? notion.tokenHint.slice(-4) : null,
        database:
          databaseId && typeof notion.database?.title === 'string' ? { id: databaseId, title: notion.database.title } : null,
      },
    }
  } catch {
    return EMPTY
  }
}
