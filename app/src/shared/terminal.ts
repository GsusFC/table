/**
 * Sesiones de terminal con un arnés (T-007). Cada sesión es un proceso en un
 * pseudoterminal del proceso principal; el renderer solo envía teclas y recibe
 * salida. Las sesiones no se guardan: terminan al cerrar Table.
 */
import type { MesaId } from './model'

export type SessionId = string

/** Perfil de arranque: qué programa abrir en la terminal. */
export interface HarnessProfile {
  /** Estable: `claude`, `codex`… para los del catálogo; `custom:<uuid>` para los propios. */
  readonly id: string
  readonly name: string
  /**
   * Comando que se ejecuta dentro del shell de inicio de sesión del usuario
   * (`$SHELL -l -c '<command>'`); null = shell interactivo normal.
   */
  readonly command: string | null
  /** Del catálogo de Table o añadido por el usuario en Ajustes. */
  readonly source: 'builtin' | 'custom'
  /** Solo perfiles del catálogo: si su ejecutable está en el PATH del usuario. */
  readonly available: boolean
}

export type SessionStatus = 'running' | 'exited'

/** MCP del catálogo de Table para los agentes (T-010) y el propio de Table (T-011). */
export type AgentMcpName = 'table' | 'figma' | 'browser' | 'notion'

/**
 * Un MCP en una sesión: `configured` si Table lo configuró en el arnés al
 * abrirla; `unsupported` si ese arnés no lo admite o Table no sabe
 * configurarlo. Nunca lleva credenciales: la autorización la hace el arnés.
 */
export interface SessionMcp {
  readonly name: AgentMcpName
  readonly status: 'configured' | 'unsupported'
  /** Cómo autorizarlo o por qué no está, para la persona. */
  readonly hint: string
}

export interface SessionInfo {
  readonly id: SessionId
  readonly mesaId: MesaId
  readonly profileId: string
  /** Nombre visible de la pestaña (nombre del perfil, numerado si se repite). */
  readonly title: string
  readonly cwd: string
  readonly status: SessionStatus
  /** Código de salida cuando `exited`; null si terminó por señal o sigue en marcha. */
  readonly exitCode: number | null
  readonly startedAt: string
  /** MCP de la sesión, fijados al arrancarla (T-010); vacío en la terminal normal. */
  readonly mcp: readonly SessionMcp[]
}

/** Columnas y filas del terminal visible. */
export interface TerminalSize {
  readonly cols: number
  readonly rows: number
}

/** Historial que conserva el proceso principal por sesión para volver a pintarla (bytes de salida). */
export const SESSION_REPLAY_BYTES = 256 * 1024
/** Historial de líneas de cada terminal en el renderer. */
export const TERMINAL_SCROLLBACK = 5_000
/** Límites de tamaño aceptados. */
export const MAX_TERMINAL_COLS = 500
export const MAX_TERMINAL_ROWS = 200
/** Tamaño máximo de una escritura del renderer (pegar texto largo se trocea). */
export const MAX_TERMINAL_INPUT = 64 * 1024
/** Perfil propio: nombre visible y comando de una sola línea. */
export const MAX_PROFILE_NAME_LENGTH = 60
export const MAX_PROFILE_COMMAND_LENGTH = 500
