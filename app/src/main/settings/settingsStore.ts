import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FigmaSettingsView } from '../../shared/figma'
import type { NotionSettingsView } from '../../shared/notion'
import { isCustomProfileId, parseCustomProfileInput } from '../../shared/validate'
import { writeFileAtomic } from '../files'

/**
 * Configuración global de Table (fuera de las mesas y de Git), en
 * `<userData>/settings.json`. Las credenciales se guardan cifradas con el
 * llavero del sistema; el archivo nunca las contiene en claro. Los perfiles
 * propios de terminal no son secretos y se guardan en claro.
 */
interface SettingsFile {
  readonly version: 2
  readonly notion: {
    /** Credenciales OAuth del MCP de Notion (cliente registrado y tokens), cifradas, en base64. */
    readonly connection: string | null
    readonly workspaceName: string | null
    readonly userName: string | null
  }
  readonly figma: {
    /** Token personal de Figma, cifrado, en base64. */
    readonly token: string | null
    /** Usuario de Figma del token, para mostrar quién está conectado. */
    readonly handle: string | null
  }
  readonly terminal: {
    readonly customProfiles: readonly CustomProfile[]
  }
}

/** Perfil de terminal añadido por el usuario en Ajustes (T-007). */
export interface CustomProfile {
  /** `custom:<uuid>` */
  readonly id: string
  readonly name: string
  readonly command: string
}

/** Perfiles propios que se conservan como máximo. */
export const MAX_CUSTOM_PROFILES = 50

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
  figmaView(): FigmaSettingsView
  /** Token descifrado, o null. Solo para el cliente de Figma del proceso principal. */
  figmaToken(): string | null
  connectFigma(token: string, handle: string | null): Promise<void>
  disconnectFigma(): Promise<void>
  customProfiles(): readonly CustomProfile[]
  /** `input` sin validar; lanza si no es válido o se supera MAX_CUSTOM_PROFILES. */
  addCustomProfile(input: unknown): Promise<CustomProfile>
  /** Sin efecto si no existe. */
  removeCustomProfile(id: string): Promise<void>
}

const EMPTY: SettingsFile = {
  version: 2,
  notion: { connection: null, workspaceName: null, userName: null },
  figma: { token: null, handle: null },
  terminal: { customProfiles: [] },
}

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

  function seal(plain: string): string {
    if (!box.isAvailable()) {
      throw new Error('El llavero del sistema no está disponible; no se guarda la credencial')
    }
    return box.encrypt(plain).toString('base64')
  }

  function unseal(sealed: string | null): string | null {
    if (!sealed || !box.isAvailable()) {
      return null
    }
    try {
      return box.decrypt(Buffer.from(sealed, 'base64'))
    } catch {
      // Llavero distinto (otro equipo o copia de datos): hay que volver a conectar.
      return null
    }
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
      const plain = unseal(settings.notion.connection)
      if (!plain) {
        return null
      }
      try {
        const parsed = JSON.parse(plain) as Partial<NotionConnection>
        return { client: parsed.client, tokens: parsed.tokens }
      } catch {
        return null
      }
    },

    async connectNotion(connection, identity) {
      const sealed = seal(JSON.stringify(connection))
      await update(current => ({ ...current, notion: { connection: sealed, ...identity } }), true)
    },

    async updateNotionConnection(connection) {
      const sealed = seal(JSON.stringify(connection))
      // Solo si sigue conectado: una renovación tardía no resucita una conexión quitada.
      await update(current => (current.notion.connection ? { ...current, notion: { ...current.notion, connection: sealed } } : current), false)
    },

    async disconnectNotion() {
      await update(current => ({ ...current, notion: EMPTY.notion }), true)
    },

    figmaView() {
      return { connected: settings.figma.token !== null, handle: settings.figma.handle }
    },

    figmaToken() {
      return unseal(settings.figma.token)
    },

    async connectFigma(token, handle) {
      const sealed = seal(token)
      await update(current => ({ ...current, figma: { token: sealed, handle } }), false)
    },

    async disconnectFigma() {
      await update(current => ({ ...current, figma: EMPTY.figma }), false)
    },

    customProfiles() {
      return settings.terminal.customProfiles
    },

    async addCustomProfile(input) {
      const profile: CustomProfile = { id: `custom:${randomUUID()}`, ...parseCustomProfileInput(input) }
      await update(current => {
        if (current.terminal.customProfiles.length >= MAX_CUSTOM_PROFILES) {
          throw new Error(`Se admiten hasta ${MAX_CUSTOM_PROFILES} perfiles propios`)
        }
        return { ...current, terminal: { customProfiles: [...current.terminal.customProfiles, profile] } }
      }, false)
      return profile
    },

    async removeCustomProfile(id) {
      await update(current => {
        const customProfiles = current.terminal.customProfiles.filter(profile => profile.id !== id)
        return customProfiles.length === current.terminal.customProfiles.length ? current : { ...current, terminal: { customProfiles } }
      }, false)
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
    const figma = parsed.figma
    return {
      version: 2,
      notion: {
        connection: typeof notion.connection === 'string' ? notion.connection : null,
        workspaceName: typeof notion.workspaceName === 'string' ? notion.workspaceName : null,
        userName: typeof notion.userName === 'string' ? notion.userName : null,
      },
      // Ajustes guardados antes de añadir Figma no tienen esta parte.
      figma: {
        token: typeof figma?.token === 'string' ? figma.token : null,
        handle: typeof figma?.handle === 'string' ? figma.handle : null,
      },
      // Ajustes guardados antes de T-007 no tienen perfiles propios; los dañados se descartan.
      terminal: { customProfiles: loadCustomProfiles(parsed.terminal?.customProfiles) },
    }
  } catch {
    return EMPTY
  }
}

function loadCustomProfiles(value: unknown): CustomProfile[] {
  if (!Array.isArray(value)) {
    return []
  }
  const profiles: CustomProfile[] = []
  for (const item of value.slice(0, MAX_CUSTOM_PROFILES)) {
    const id = (item as { id?: unknown } | null)?.id
    if (typeof id !== 'string' || !isCustomProfileId(id) || profiles.some(profile => profile.id === id)) {
      continue
    }
    try {
      profiles.push({ id, ...parseCustomProfileInput(item) })
    } catch {
      // Perfil dañado: se omite.
    }
  }
  return profiles
}
