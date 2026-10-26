import { execFile } from 'node:child_process'
import type { HarnessProfile } from '../../shared/terminal'
import { log } from '../log'
import type { CustomProfile } from '../settings/settingsStore'

/** Arneses conocidos: se ofrecen si su ejecutable está en el PATH del shell de inicio de sesión. */
const BUILTIN_HARNESSES: readonly { id: string; name: string; bin: string }[] = [
  { id: 'claude', name: 'Claude Code', bin: 'claude' },
  { id: 'codex', name: 'Codex', bin: 'codex' },
  { id: 'gemini', name: 'Gemini CLI', bin: 'gemini' },
  { id: 'opencode', name: 'OpenCode', bin: 'opencode' },
  { id: 'omp', name: 'omp', bin: 'omp' },
  { id: 'pi', name: 'pi', bin: 'pi' },
]

/** Terminal normal: el shell interactivo del usuario. */
export const SHELL_PROFILE_ID = 'shell'
const SHELL_PROFILE: HarnessProfile = { id: SHELL_PROFILE_ID, name: 'Terminal', command: null, source: 'builtin', available: true }

/** Antigüedad a partir de la cual `list()` vuelve a buscar los arneses instalados. */
const DETECTION_MAX_AGE_MS = 60_000
/** Un shell de inicio de sesión lento (p. ej. nvm) no debe bloquear la lista de perfiles. */
const DETECTION_TIMEOUT_MS = 8_000
const MARKER = '__table_bin:'

/** Ejecutables que existen según `command -v` dentro del shell de inicio de sesión. */
export type DetectInstalled = (bins: readonly string[]) => Promise<ReadonlySet<string>>

/**
 * Una sola llamada para todos: `$SHELL -l -c 'command -v …'`. Una app abierta
 * desde Finder no hereda el PATH del usuario; su shell de inicio de sesión sí
 * lo construye. Los nombres son constantes del catálogo, nunca datos del usuario.
 */
export function loginShellDetector(shell: string, env: NodeJS.ProcessEnv): DetectInstalled {
  return bins => {
    const { promise, resolve, reject } = Promise.withResolvers<ReadonlySet<string>>()
    const script = `for b in ${bins.join(' ')}; do command -v "$b" >/dev/null 2>&1 && printf '%s\\n' "${MARKER}$b"; done; exit 0`
    execFile(shell, ['-l', '-c', script], { env, timeout: DETECTION_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) {
        reject(error)
        return
      }
      // Los archivos de inicio pueden imprimir texto; solo cuentan las líneas marcadas.
      const found = new Set<string>()
      for (const line of stdout.split('\n')) {
        const bin = line.startsWith(MARKER) ? line.slice(MARKER.length).trim() : ''
        if (bins.includes(bin)) {
          found.add(bin)
        }
      }
      resolve(found)
    })
    return promise
  }
}

export interface ProfileCatalog {
  /** Arranca la búsqueda de arneses instalados (al abrir Table). */
  refresh(): Promise<void>
  /** Catálogo (vuelve a buscar si la búsqueda tiene más de un minuto), terminal normal y perfiles propios. */
  list(): Promise<HarnessProfile[]>
  /** Perfil por ID, sin volver a buscar; undefined si no existe. */
  get(id: string): HarnessProfile | undefined
}

export function createProfileCatalog(detect: DetectInstalled, customProfiles: () => readonly CustomProfile[]): ProfileCatalog {
  let installed: ReadonlySet<string> = new Set()
  let detectedAt = 0
  let detecting: Promise<void> | null = null

  function refresh(): Promise<void> {
    detecting ??= detect(BUILTIN_HARNESSES.map(harness => harness.bin))
      .then(
        found => {
          installed = found
          log('harnesses-detected', { available: [...found] })
        },
        (error: unknown) => {
          // Se conserva el resultado anterior; se reintenta pasado DETECTION_MAX_AGE_MS.
          log('harnesses-detect-failed', { message: error instanceof Error ? error.message : String(error) })
        },
      )
      .finally(() => {
        detectedAt = Date.now()
        detecting = null
      })
    return detecting
  }

  function snapshot(): HarnessProfile[] {
    return [
      ...BUILTIN_HARNESSES.map(
        (harness): HarnessProfile => ({
          id: harness.id,
          name: harness.name,
          command: harness.bin,
          source: 'builtin',
          available: installed.has(harness.bin),
        }),
      ),
      SHELL_PROFILE,
      ...customProfiles().map((profile): HarnessProfile => ({ ...profile, source: 'custom', available: true })),
    ]
  }

  return {
    refresh,

    async list() {
      if (detecting || Date.now() - detectedAt > DETECTION_MAX_AGE_MS) {
        await refresh()
      }
      return snapshot()
    },

    get(id) {
      return snapshot().find(profile => profile.id === id)
    },
  }
}
