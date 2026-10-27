/**
 * Sesiones de terminal en el renderer (T-007): un `Terminal` de xterm por
 * sesión, creado la primera vez que se ve y reutilizado al moverlo entre el
 * panel de agentes y su tarjeta en el lienzo (se mueve el mismo elemento, sin
 * reiniciar nada). También guarda qué sesiones están desacopladas y dónde:
 * eso no va a la mesa, porque las sesiones no sobreviven a cerrar Table.
 */
import { FitAddon } from '@xterm/addon-fit'
import { Terminal, type ITheme } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useMemo, useSyncExternalStore } from 'react'
import type { MesaId, Point, Size } from '../../shared/model'
import {
  MAX_TERMINAL_COLS,
  MAX_TERMINAL_INPUT,
  MAX_TERMINAL_ROWS,
  TERMINAL_SCROLLBACK,
  type SessionId,
  type SessionInfo,
  type TerminalSize,
} from '../../shared/terminal'
import { sanitizePaste } from './paste'
import { isExitShortcut } from './shortcut'

const api = window.table

/** Tamaño por defecto de una sesión desacoplada en el lienzo. */
export const TERMINAL_CARD_SIZE: Size = { width: 640, height: 420 }
export const TERMINAL_CARD_MIN = { width: 360, height: 220 } as const
const FONT_SIZE = 12
const LINE_HEIGHT = 1.2
/** Retardo del reajuste de columnas mientras cambia el tamaño (borde del panel, zoom). */
const FIT_DELAY_MS = 80
/**
 * Una escritura del renderer no pasa de MAX_TERMINAL_INPUT en UTF-8: cada
 * unidad UTF-16 ocupa como mucho 3 bytes.
 */
const INPUT_CHUNK = Math.floor(MAX_TERMINAL_INPUT / 3)

// ---------- Estado: sesiones y tarjetas desacopladas ----------

/** Sesión desacoplada: tarjeta flotante en el lienzo. Sin posición hasta que el lienzo la coloca. */
export interface DetachedTerminal {
  readonly position: Point | null
  readonly size: Size
}

interface Snapshot {
  readonly sessions: ReadonlyMap<SessionId, SessionInfo>
  readonly detached: ReadonlyMap<SessionId, DetachedTerminal>
  /** Pestaña elegida en el panel de cada mesa. */
  readonly active: ReadonlyMap<MesaId, SessionId>
}

let snapshot: Snapshot = { sessions: new Map(), detached: new Map(), active: new Map() }
const listeners = new Set<() => void>()

function update(next: Partial<Snapshot>): void {
  snapshot = { ...snapshot, ...next }
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getSnapshot = (): Snapshot => snapshot

/** Sesión nueva o con estado nuevo (arranque, salida). */
export function upsertSession(session: SessionInfo): void {
  const previous = snapshot.sessions.get(session.id)
  if (previous?.status === 'running' && session.status === 'exited') {
    const entry = entries.get(session.id)
    entry?.term.write(`\r\n\x1b[2m[El proceso terminó${session.exitCode === null ? '' : ` con código ${session.exitCode}`}]\x1b[0m\r\n`)
  }
  update({ sessions: new Map(snapshot.sessions).set(session.id, session) })
}

/** Sesiones de una mesa que ya existen en el proceso principal (p. ej. tras recargar la interfaz). */
export async function loadSessions(mesaId: MesaId): Promise<void> {
  const list = await api.terminal.sessions(mesaId)
  const sessions = new Map(snapshot.sessions)
  for (const [id, session] of sessions) {
    if (session.mesaId === mesaId && !list.some(item => item.id === id)) {
      sessions.delete(id)
      disposeTerminal(id)
    }
  }
  for (const session of list) {
    sessions.set(session.id, session)
  }
  update({ sessions })
}

/** Arranca un perfil en la carpeta de la mesa y elige su pestaña. */
export async function startSession(mesaId: MesaId, profileId: string, size: TerminalSize): Promise<SessionInfo> {
  const session = await api.terminal.start(mesaId, profileId, size)
  upsertSession(session)
  ensureTerminal(session.id)
  selectSession(session)
  return session
}

/** Pestaña elegida en el panel de la mesa de la sesión. */
export function selectSession(session: SessionInfo): void {
  if (snapshot.active.get(session.mesaId) !== session.id) {
    update({ active: new Map(snapshot.active).set(session.mesaId, session.id) })
  }
}

/** Termina el proceso y olvida la sesión, su terminal y su tarjeta. La interfaz confirma antes. */
export async function closeSession(sessionId: SessionId): Promise<void> {
  await api.terminal.close(sessionId)
  const sessions = new Map(snapshot.sessions)
  sessions.delete(sessionId)
  const detached = new Map(snapshot.detached)
  detached.delete(sessionId)
  update({ sessions, detached })
  disposeTerminal(sessionId)
}

/** La mesa se borró: el proceso principal ya terminó sus sesiones; aquí se olvidan. */
export function forgetMesaSessions(mesaId: MesaId): void {
  const sessions = new Map(snapshot.sessions)
  const detached = new Map(snapshot.detached)
  for (const session of snapshot.sessions.values()) {
    if (session.mesaId === mesaId) {
      sessions.delete(session.id)
      detached.delete(session.id)
      disposeTerminal(session.id)
    }
  }
  const active = new Map(snapshot.active)
  active.delete(mesaId)
  update({ sessions, detached, active })
}

/** Lleva la sesión al lienzo; el lienzo la coloca cerca del centro visible. */
export function detachSession(sessionId: SessionId): void {
  if (!snapshot.detached.has(sessionId)) {
    update({ detached: new Map(snapshot.detached).set(sessionId, { position: null, size: TERMINAL_CARD_SIZE }) })
  }
}

/** Devuelve la sesión al panel y elige su pestaña. */
export function attachSession(sessionId: SessionId): void {
  if (snapshot.detached.has(sessionId)) {
    const detached = new Map(snapshot.detached)
    detached.delete(sessionId)
    update({ detached })
  }
  const session = snapshot.sessions.get(sessionId)
  if (session) {
    selectSession(session)
  }
}

/** Posición o tamaño nuevos de una tarjeta de terminal. */
export function moveDetached(sessionId: SessionId, patch: Partial<DetachedTerminal>): void {
  const current = snapshot.detached.get(sessionId)
  if (current) {
    update({ detached: new Map(snapshot.detached).set(sessionId, { ...current, ...patch }) })
  }
}

function useSnapshot(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot)
}

/** Sesión de la pestaña elegida (si ya no existe, la última). */
export function useActiveSession(mesaId: MesaId, sessions: readonly SessionInfo[]): SessionInfo | undefined {
  const chosen = useSnapshot().active.get(mesaId)
  return sessions.find(session => session.id === chosen) ?? sessions[sessions.length - 1]
}

/** Sesiones de la mesa por orden de arranque. */
export function useMesaSessions(mesaId: MesaId | null): readonly SessionInfo[] {
  const { sessions } = useSnapshot()
  return useMemo(
    () =>
      mesaId
        ? [...sessions.values()]
            .filter(session => session.mesaId === mesaId)
            .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
        : [],
    [sessions, mesaId],
  )
}

export function useSession(sessionId: SessionId): SessionInfo | undefined {
  return useSnapshot().sessions.get(sessionId)
}

/** Sesiones desacopladas de toda la interfaz (cada lienzo filtra las de su mesa). */
export function useDetached(): ReadonlyMap<SessionId, DetachedTerminal> {
  return useSnapshot().detached
}

export interface SessionStatusView {
  readonly label: string
  readonly tone: 'live' | 'neutral' | 'danger'
}

export function sessionStatus(session: SessionInfo): SessionStatusView {
  if (session.status === 'running') {
    return { label: 'En marcha', tone: 'live' }
  }
  if (session.exitCode === null) {
    return { label: 'Terminada', tone: 'neutral' }
  }
  return { label: `Terminada (${session.exitCode})`, tone: session.exitCode === 0 ? 'neutral' : 'danger' }
}

// ---------- Terminales de xterm ----------

interface TerminalEntry {
  readonly term: Terminal
  readonly fit: FitAddon
  opened: boolean
  /** Salida recibida mientras llega `replay`; null cuando ya se pinta en directo. */
  pending: string[] | null
  /** Contenedor donde se ve ahora (panel o tarjeta); null si no se ve. */
  host: HTMLElement | null
  fitTimer: number | undefined
  /** Ya pintó la salida guardada: sus modos (pegado entre corchetes) son los del proceso. */
  ready: boolean
  /** Textos de «Enviar al agente» que esperan a que el terminal esté abierto y listo. */
  queuedPaste: string[]
}

const entries = new Map<SessionId, TerminalEntry>()
/** Con una web en el panel, ⌘⇧Esc vuelve al lienzo y no llega al terminal. */
let exitShortcutReserved = false

export function setExitShortcutReserved(reserved: boolean): void {
  exitShortcutReserved = reserved
}

// Una sola suscripción a la salida de todas las sesiones. Cada trozo se confirma
// (`ack`) cuando xterm lo ha procesado: así el proceso principal pausa la sesión
// si la interfaz no da abasto, en lugar de que xterm descarte salida.
api.terminal.onData((sessionId, data) => {
  const entry = entries.get(sessionId)
  if (!entry || entry.pending) {
    // Sin terminal, o esperando `replay`: la salida llegará incluida en él.
    entry?.pending?.push(data)
    api.terminal.ack(sessionId, data.length)
    return
  }
  entry.term.write(data, () => api.terminal.ack(sessionId, data.length))
})
api.terminal.onSession(upsertSession)

function cssVar(style: CSSStyleDeclaration, name: string): string | undefined {
  return style.getPropertyValue(name).trim() || undefined
}

/** Colores claros de tokens.css. */
function terminalTheme(): ITheme {
  const style = getComputedStyle(document.documentElement)
  const color = (name: string): string | undefined => cssVar(style, `--terminal-${name}`)
  return {
    background: color('background'),
    foreground: color('foreground'),
    cursor: color('foreground'),
    cursorAccent: color('background'),
    selectionBackground: color('selection'),
    selectionInactiveBackground: color('selection'),
    black: color('black'),
    red: color('red'),
    green: color('green'),
    yellow: color('yellow'),
    blue: color('blue'),
    magenta: color('magenta'),
    cyan: color('cyan'),
    white: color('white'),
    brightBlack: color('bright-black'),
    brightRed: color('bright-red'),
    brightGreen: color('bright-green'),
    brightYellow: color('bright-yellow'),
    brightBlue: color('bright-blue'),
    brightMagenta: color('bright-magenta'),
    brightCyan: color('bright-cyan'),
    brightWhite: color('bright-white'),
  }
}

/** Envía lo escrito o pegado, en trozos que el proceso principal acepta. */
function sendInput(sessionId: SessionId, data: string): void {
  for (let start = 0; start < data.length; ) {
    let end = Math.min(start + INPUT_CHUNK, data.length)
    // No partir un par sustituto (emoji y similares).
    const last = data.charCodeAt(end - 1)
    if (end < data.length && last >= 0xd800 && last <= 0xdbff) {
      end -= 1
    }
    api.terminal.write(sessionId, data.slice(start, end))
    start = end
  }
}

/** Terminal de la sesión; la primera vez se crea y se pinta con la salida guardada. */
function ensureTerminal(sessionId: SessionId): TerminalEntry {
  const existing = entries.get(sessionId)
  if (existing) {
    return existing
  }
  const style = getComputedStyle(document.documentElement)
  const term = new Terminal({
    scrollback: TERMINAL_SCROLLBACK,
    fontFamily: cssVar(style, '--font-mono'),
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
    theme: terminalTheme(),
    cursorBlink: true,
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  const entry: TerminalEntry = {
    term,
    fit,
    opened: false,
    pending: [],
    host: null,
    fitTimer: undefined,
    ready: false,
    queuedPaste: [],
  }
  entries.set(sessionId, entry)

  term.onData(data => sendInput(sessionId, data))
  term.onResize(size => api.terminal.resize(sessionId, size))
  term.attachCustomKeyEventHandler(event => !(exitShortcutReserved && isExitShortcut(event)))

  // Lo recibido antes de la respuesta ya va incluido en ella (el orden de los mensajes se conserva).
  const markReady = (): void => {
    entry.ready = true
    flushPaste(entry)
  }
  api.terminal.replay(sessionId).then(
    output => {
      if (entries.get(sessionId) === entry) {
        entry.pending = null
        term.write(output, markReady)
      }
    },
    () => {
      if (entries.get(sessionId) === entry) {
        const pending = entry.pending ?? []
        entry.pending = null
        term.write(pending.join(''), markReady)
      }
    },
  )
  return entry
}

function disposeTerminal(sessionId: SessionId): void {
  const entry = entries.get(sessionId)
  if (entry) {
    entries.delete(sessionId)
    window.clearTimeout(entry.fitTimer)
    entry.term.dispose()
  }
}

/**
 * Pega el texto como si la persona lo pegara: entre corchetes si el programa
 * lo activó (los arneses y zsh o bash lo hacen) y nunca con Intro. Antes se
 * quitan las secuencias de control (`sanitizePaste`): un `ESC [201~` en una
 * nota cerraría el pegado y su salto de línea ejecutaría lo que sigue. Sin
 * pegado entre corchetes, cada salto de línea ejecutaría una línea: se pega en una sola.
 */
function flushPaste(entry: TerminalEntry): void {
  if (!entry.opened || !entry.ready || entry.queuedPaste.length === 0) {
    return
  }
  const text = sanitizePaste(entry.queuedPaste.join('\n\n')).replace(/\s+$/, '')
  entry.queuedPaste = []
  const { term } = entry
  term.paste(term.modes.bracketedPasteMode ? text : text.replace(/\s*\n\s*/g, ' '))
  term.focus()
}

/** Sesión en marcha que recibe «Enviar al agente»: la pestaña elegida o, si no está en marcha, la última que sí. */
export function runningSession(mesaId: MesaId): SessionInfo | undefined {
  const running = [...snapshot.sessions.values()]
    .filter(session => session.mesaId === mesaId && session.status === 'running')
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  const chosen = snapshot.active.get(mesaId)
  return running.find(session => session.id === chosen) ?? running[running.length - 1]
}

/**
 * Pega el texto en el terminal de la sesión (en el panel o en su tarjeta del
 * lienzo) y elige su pestaña. Si el terminal aún no se ve, se pega al montarse.
 */
export function pasteIntoSession(sessionId: SessionId, text: string): void {
  const session = snapshot.sessions.get(sessionId)
  if (session) {
    selectSession(session)
  }
  const entry = ensureTerminal(sessionId)
  entry.queuedPaste.push(text)
  flushPaste(entry)
}

/** Ajusta columnas y filas al contenedor; si cambian, se avisa al proceso (onResize). */
function fitTerminal(entry: TerminalEntry): void {
  const container = entry.host
  if (!container?.isConnected || container.clientWidth === 0 || container.clientHeight === 0) {
    return
  }
  const proposed = entry.fit.proposeDimensions()
  if (!proposed || !Number.isFinite(proposed.cols) || !Number.isFinite(proposed.rows)) {
    return
  }
  const cols = Math.max(2, Math.min(MAX_TERMINAL_COLS, proposed.cols))
  const rows = Math.max(1, Math.min(MAX_TERMINAL_ROWS, proposed.rows))
  if (cols !== entry.term.cols || rows !== entry.term.rows) {
    entry.term.resize(cols, rows)
  }
}

/** Ajuste con retardo: arrastrar el borde del panel o hacer zoom cambia el tamaño muchas veces seguidas. */
function fitSoon(entry: TerminalEntry): void {
  window.clearTimeout(entry.fitTimer)
  entry.fitTimer = window.setTimeout(() => fitTerminal(entry), FIT_DELAY_MS)
}

/** Letra proporcional al zoom del lienzo (1 en el panel), para que la tarjeta se vea como el resto del lienzo. */
function applyFontScale(entry: TerminalEntry, fontScale: number): void {
  const fontSize = FONT_SIZE * fontScale
  if (entry.term.options.fontSize !== fontSize) {
    entry.term.options.fontSize = fontSize
  }
}

/**
 * Pone el terminal de la sesión dentro de `container` (lo abre la primera vez;
 * después mueve su elemento) y lo mantiene ajustado a su tamaño. Devuelve la baja.
 */
export function mountTerminal(sessionId: SessionId, container: HTMLElement, fontScale: number): () => void {
  const entry = ensureTerminal(sessionId)
  const { term } = entry
  entry.host = container
  applyFontScale(entry, fontScale)
  if (!entry.opened) {
    entry.opened = true
    term.open(container)
  } else if (term.element && term.element.parentElement !== container) {
    container.appendChild(term.element)
    term.refresh(0, term.rows - 1)
  }
  const observer = new ResizeObserver(() => fitSoon(entry))
  observer.observe(container)
  fitTerminal(entry)
  flushPaste(entry)
  return () => {
    observer.disconnect()
    if (entry.host === container) {
      entry.host = null
      window.clearTimeout(entry.fitTimer)
    }
    if (term.element?.parentElement === container) {
      container.removeChild(term.element)
    }
  }
}

/** Cambia la escala de la letra de un terminal montado (zoom del lienzo) y lo reajusta. */
export function scaleTerminal(sessionId: SessionId, fontScale: number): void {
  const entry = entries.get(sessionId)
  if (entry?.host) {
    applyFontScale(entry, fontScale)
    fitSoon(entry)
  }
}

export function focusTerminal(sessionId: SessionId): void {
  entries.get(sessionId)?.term.focus()
}

/** Columnas y filas aproximadas para arrancar una sesión en un área de ese tamaño (luego se ajusta). */
export function estimateTerminalSize(width: number, height: number): TerminalSize {
  const canvas = document.createElement('canvas').getContext('2d')
  let cellWidth = FONT_SIZE * 0.6
  if (canvas) {
    canvas.font = `${FONT_SIZE}px ${cssVar(getComputedStyle(document.documentElement), '--font-mono') ?? 'monospace'}`
    cellWidth = canvas.measureText('W').width || cellWidth
  }
  const cellHeight = Math.ceil(FONT_SIZE * LINE_HEIGHT)
  return {
    cols: Math.max(20, Math.min(MAX_TERMINAL_COLS, Math.floor(width / cellWidth))),
    rows: Math.max(5, Math.min(MAX_TERMINAL_ROWS, Math.floor(height / cellHeight))),
  }
}

/** ¿El evento viene de dentro de un terminal? Los atajos del lienzo no actúan ahí. */
export function isInTerminal(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.terminal-view') !== null
}
