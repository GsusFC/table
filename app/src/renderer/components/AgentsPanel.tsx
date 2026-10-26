import { PanelRightClose, Plus, SquareArrowOutUpRight, SquareTerminal, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { MesaId } from '../../shared/model'
import type { HarnessProfile, SessionInfo } from '../../shared/terminal'
import { errorMessage } from '../lib/errors'
import {
  attachSession,
  closeSession,
  detachSession,
  estimateTerminalSize,
  focusTerminal,
  selectSession,
  sessionStatus,
  startSession,
  useActiveSession,
  useDetached,
  useMesaSessions,
} from '../lib/terminals'
import { ConfirmDialog } from './Dialog'
import { Menu, type MenuItem } from './Menu'
import { TerminalView } from './TerminalView'

const api = window.table

/** Ancho del panel de agentes: mínimo fijo y como mucho el 70 % de la ventana. */
export const AGENTS_MIN_WIDTH = 320
export const AGENTS_MAX_RATIO = 0.7
const RESIZE_STEP = 24

export function clampAgentsWidth(width: number): number {
  return Math.round(Math.max(AGENTS_MIN_WIDTH, Math.min(width, window.innerWidth * AGENTS_MAX_RATIO)))
}

interface AgentsPanelProps {
  readonly mesaId: MesaId
  readonly width: number
  readonly onResize: (width: number) => void
  readonly onCollapse: () => void
  /** Web en el panel principal: un diálogo la cerraría antes (la vista nativa lo taparía). */
  readonly entered: boolean
  readonly onExitWeb: () => Promise<void>
  readonly notify: (text: string) => void
}

/**
 * Panel derecho de la mesa con sus sesiones de arnés en pestañas (T-007). Las
 * sesiones son del proceso principal: plegar el panel o cambiar de mesa no las
 * detiene.
 */
export function AgentsPanel({ mesaId, width, onResize, onCollapse, entered, onExitWeb, notify }: AgentsPanelProps) {
  const sessions = useMesaSessions(mesaId)
  const detached = useDetached()
  const active = useActiveSession(mesaId, sessions)
  const [profiles, setProfiles] = useState<readonly HarnessProfile[] | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null)
  const [confirmClose, setConfirmClose] = useState<SessionInfo | null>(null)
  const [starting, setStarting] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  const loadProfiles = useCallback(() => {
    api.terminal.profiles().then(setProfiles, (error: unknown) => notify(errorMessage(error)))
  }, [notify])
  useEffect(loadProfiles, [loadProfiles])

  const start = (profile: HarnessProfile): void => {
    if (starting) {
      return
    }
    const rect = bodyRef.current?.getBoundingClientRect()
    setStarting(true)
    startSession(mesaId, profile.id, estimateTerminalSize(rect?.width ?? width, rect?.height ?? 400)).then(
      session => {
        setStarting(false)
        requestAnimationFrame(() => focusTerminal(session.id))
      },
      (error: unknown) => {
        setStarting(false)
        notify(errorMessage(error))
      },
    )
  }

  const choose = (session: SessionInfo): void => {
    selectSession(session)
    if (!detached.has(session.id)) {
      requestAnimationFrame(() => focusTerminal(session.id))
    }
  }

  const requestClose = (session: SessionInfo): void => {
    if (session.status !== 'running') {
      closeSession(session.id).catch((error: unknown) => notify(errorMessage(error)))
      return
    }
    if (entered) {
      onExitWeb().then(() => setConfirmClose(session), (error: unknown) => notify(errorMessage(error)))
    } else {
      setConfirmClose(session)
    }
  }

  const detach = (session: SessionInfo): void => {
    detachSession(session.id)
    // La tarjeta va al lienzo: con una web en el panel no se vería.
    if (entered) {
      onExitWeb().catch((error: unknown) => notify(errorMessage(error)))
    }
  }

  // Arrastrar el borde izquierdo; flechas con el separador enfocado.
  const resizeFrom = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    // Desde el ancho de partida: el panel crece lo que el puntero se mueve a la izquierda.
    const startX = event.clientX
    const startWidth = clampAgentsWidth(width)
    const move = (moveEvent: globalThis.PointerEvent): void =>
      onResize(clampAgentsWidth(startWidth + startX - moveEvent.clientX))
    const stop = (): void => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', stop)
      handle.removeEventListener('pointercancel', stop)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
  }
  const resizeWithKeys = (event: KeyboardEvent<HTMLDivElement>): void => {
    const delta = event.key === 'ArrowLeft' ? RESIZE_STEP : event.key === 'ArrowRight' ? -RESIZE_STEP : 0
    if (delta !== 0) {
      event.preventDefault()
      onResize(clampAgentsWidth(width + delta))
    }
  }

  const profileItems = (profiles ?? []).map(
    (profile): MenuItem => ({
      label: profile.name,
      icon: SquareTerminal,
      hint: profile.available ? undefined : 'no instalado',
      disabled: !profile.available,
      onSelect: () => start(profile),
    }),
  )

  const activeDetached = active ? detached.has(active.id) : false
  const activeStatus = active ? sessionStatus(active) : null

  return (
    <aside className="agents" aria-label="Agentes">
      <div
        className="agents-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Ancho del panel de agentes"
        aria-valuenow={width}
        aria-valuemin={AGENTS_MIN_WIDTH}
        tabIndex={0}
        onPointerDown={resizeFrom}
        onKeyDown={resizeWithKeys}
      />

      <div className="agents-header">
        <div className="agents-tabs" role="tablist" aria-label="Sesiones de la mesa">
          {sessions.map(session => {
            const status = sessionStatus(session)
            const selected = session.id === active?.id
            return (
              <div key={session.id} className={selected ? 'agents-tab agents-tab-selected' : 'agents-tab'}>
                <button
                  type="button"
                  role="tab"
                  className="agents-tab-button"
                  aria-selected={selected}
                  title={`${session.title} · ${status.label}${detached.has(session.id) ? ' · en el lienzo' : ''}`}
                  onClick={() => choose(session)}
                >
                  <span className={`agents-dot agents-dot-${status.tone}`} aria-hidden />
                  <span className="agents-tab-title">{session.title}</span>
                  {session.status === 'exited' && (
                    <span className="agents-tab-code tabular">{session.exitCode ?? '–'}</span>
                  )}
                  {detached.has(session.id) && <SquareArrowOutUpRight aria-hidden size={12} strokeWidth={1.75} />}
                </button>
                <button
                  type="button"
                  className="icon-button icon-button-small agents-tab-close"
                  aria-label={`Cerrar ${session.title}`}
                  title="Cerrar sesión"
                  onClick={() => requestClose(session)}
                >
                  <X aria-hidden size={13} strokeWidth={1.75} />
                </button>
              </div>
            )
          })}
        </div>
        <div className="agents-actions">
          <button
            type="button"
            className="icon-button"
            aria-label="Nueva sesión"
            title="Nueva sesión"
            aria-haspopup="menu"
            aria-expanded={menuAnchor !== null}
            disabled={starting}
            onClick={event => {
              if (menuAnchor) {
                setMenuAnchor(null)
                return
              }
              loadProfiles()
              const rect = event.currentTarget.getBoundingClientRect()
              setMenuAnchor({ x: rect.right, y: rect.bottom + 4 })
            }}
          >
            <Plus aria-hidden size={16} strokeWidth={1.75} />
          </button>
          <button type="button" className="icon-button" aria-label="Plegar agentes" title="Plegar" onClick={onCollapse}>
            <PanelRightClose aria-hidden size={16} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {active && activeStatus && (
        <div className="agents-session-bar">
          <span className="agents-cwd" title={active.cwd}>
            {active.cwd}
          </span>
          <span className={`status status-${activeStatus.tone}`}>{activeStatus.label}</span>
          {!activeDetached && (
            <button type="button" className="button button-small" onClick={() => detach(active)}>
              <SquareArrowOutUpRight aria-hidden size={13} strokeWidth={1.75} />
              Desacoplar
            </button>
          )}
        </div>
      )}

      <div ref={bodyRef} className="agents-body" role={active ? 'tabpanel' : undefined}>
        {active && !activeDetached && <TerminalView key={active.id} sessionId={active.id} className="agents-terminal" />}

        {active && activeDetached && (
          <div className="agents-empty">
            <p className="agents-empty-text">Esta sesión está en el lienzo como tarjeta. Sigue en marcha.</p>
            <button type="button" className="button" onClick={() => attachSession(active.id)}>
              Volver al panel
            </button>
          </div>
        )}

        {!active && (
          <div className="agents-empty">
            <p className="agents-empty-title">Sin sesiones</p>
            <p className="agents-empty-text">
              Abre un arnés o una terminal en la carpeta de esta mesa. Funciona con tus permisos: Table no filtra lo que
              hace el agente ni contesta por ti a sus peticiones.
            </p>
            <div className="agents-profiles">
              {profiles === null && <p className="agents-empty-text">Cargando…</p>}
              {profiles?.map(profile => (
                <button
                  key={profile.id}
                  type="button"
                  className="agents-profile"
                  disabled={!profile.available || starting}
                  onClick={() => start(profile)}
                >
                  <SquareTerminal aria-hidden size={15} strokeWidth={1.75} />
                  <span className="agents-profile-name">{profile.name}</span>
                  {!profile.available && <span className="agents-profile-hint">no instalado</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {menuAnchor && (
        <Menu
          anchor={menuAnchor}
          align="end"
          label="Abrir sesión con"
          items={profileItems}
          onClose={() => setMenuAnchor(null)}
        />
      )}

      {!entered && confirmClose && (
        <ConfirmDialog
          title={`Cerrar «${confirmClose.title}»`}
          confirmLabel="Cerrar sesión"
          description={<p>El agente sigue en marcha. Se cerrará el proceso.</p>}
          onConfirm={() => closeSession(confirmClose.id)}
          onClose={() => setConfirmClose(null)}
        />
      )}
    </aside>
  )
}
