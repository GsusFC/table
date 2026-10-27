import {
  Ellipsis,
  Eye,
  EyeOff,
  FileText,
  ListChecks,
  PanelRightClose,
  Plug,
  Plus,
  RefreshCw,
  ShieldCheck,
  SquareArrowOutUpRight,
  SquareTerminal,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { AgentNotionMode, MesaId } from '../../shared/model'
import type { NotionContextProgress } from '../../shared/notionContext'
import type { AgentMcpName, HarnessProfile, SessionInfo } from '../../shared/terminal'
import { errorMessage } from '../lib/errors'
import { activityLabel, useAgentActivities, useFollowAgent } from '../lib/agentActivity'
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
import { NotionPagesDialog } from './NotionPagesDialog'
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
  readonly notify: (text: string, tone?: 'info' | 'error') => void
}

/** Nombre visible de cada MCP de la sesión (T-010). */
const MCP_LABELS: Readonly<Record<AgentMcpName, string>> = { table: 'Table', figma: 'Figma', notion: 'Notion' }

/** Línea compacta del progreso de la lectura de Notion (T-009). */
function progressText(progress: NotionContextProgress): string {
  switch (progress.phase) {
    case 'listing':
      return 'Leyendo Notion…'
    case 'reading':
      return progress.total > 0 ? `Leyendo Notion: ${progress.done}/${progress.total}` : 'Leyendo Notion…'
    case 'writing':
      return 'Escribiendo el contexto de Notion…'
    case 'done':
      return `Notion: ${progress.pages === 1 ? '1 página' : `${progress.pages} páginas`} para el agente`
    case 'error':
      return `Notion: ${progress.message ?? 'no se pudo leer'}`
  }
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
  const activities = useAgentActivities()
  const [followAgent, setFollowAgent] = useFollowAgent()
  const [profiles, setProfiles] = useState<readonly HarnessProfile[] | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null)
  /** Menú «Más acciones» del panel (p. ej. «Actualizar contexto»). */
  const [moreAnchor, setMoreAnchor] = useState<{ x: number; y: number } | null>(null)
  const [confirmClose, setConfirmClose] = useState<SessionInfo | null>(null)
  const [starting, setStarting] = useState(false)
  /** Lectura de Notion de la mesa (T-009): último progreso y si se ven sus avisos. */
  const [contextProgress, setContextProgress] = useState<NotionContextProgress | null>(null)
  const [showWarnings, setShowWarnings] = useState(false)
  const [choosingPages, setChoosingPages] = useState(false)
  /** «Notion para el agente» de la mesa (T-010); null mientras se lee. */
  const [notionMode, setNotionMode] = useState<AgentNotionMode | null>(null)
  const [confirmNotionMcp, setConfirmNotionMcp] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let current = true
    setContextProgress(null)
    setShowWarnings(false)
    const off = api.agent.onProgress(progress => {
      if (progress.mesaId === mesaId) {
        current = false
        setContextProgress(progress)
      }
    })
    api.agent.contextState(mesaId).then(
      state => current && setContextProgress(state),
      () => undefined,
    )
    return () => {
      current = false
      off()
    }
  }, [mesaId])

  const loadNotionMode = useCallback((): (() => void) => {
    let current = true
    api.mesas.get(mesaId).then(
      mesa => current && setNotionMode(mesa.agentNotion),
      () => undefined,
    )
    return () => {
      current = false
    }
  }, [mesaId])
  useEffect(() => {
    setNotionMode(null)
    return loadNotionMode()
  }, [loadNotionMode])

  const saveNotionMode = (mode: AgentNotionMode): Promise<void> =>
    api.agent.setNotionMode(mesaId, mode).then(
      saved => {
        setNotionMode(saved)
        notify(saved === 'mcp' ? 'Notion por MCP en las sesiones nuevas' : 'Notion por archivos filtrados en las sesiones nuevas', 'info')
      },
      (error: unknown) => {
        // El modo pudo guardarse aunque fallaran los archivos: se vuelve a leer el de la mesa.
        loadNotionMode()
        throw error
      },
    )

  const askNotionMcp = (): void => {
    if (entered) {
      onExitWeb().then(() => setConfirmNotionMcp(true), (error: unknown) => notify(errorMessage(error)))
    } else {
      setConfirmNotionMcp(true)
    }
  }

  const chooseNotionPages = (): void => {
    if (entered) {
      onExitWeb().then(() => setChoosingPages(true), (error: unknown) => notify(errorMessage(error)))
    } else {
      setChoosingPages(true)
    }
  }

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
            // La sesión trabaja en una tarjeta (T-012): la pestaña lo indica.
            const working = activities.find(activity => activity.sessionId === session.id)
            return (
              <div key={session.id} className={selected ? 'agents-tab agents-tab-selected' : 'agents-tab'}>
                <button
                  type="button"
                  role="tab"
                  className="agents-tab-button"
                  aria-selected={selected}
                  title={`${session.title} · ${working ? activityLabel(working) : status.label}${detached.has(session.id) ? ' · en el lienzo' : ''}`}
                  data-working={working ? 'true' : undefined}
                  onClick={() => choose(session)}
                >
                  <span className={working ? 'agents-dot agents-dot-working' : `agents-dot agents-dot-${status.tone}`} aria-hidden />
                  <span className="agents-tab-title">{session.title}</span>
                  {working && <span className="visually-hidden">, trabajando en una tarjeta</span>}
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
            aria-label="Seguir al agente"
            aria-pressed={followAgent}
            title={
              followAgent
                ? 'Seguir al agente: activado. Cuando un agente empieza a trabajar en una tarjeta, Table la abre (salvo si escribes o estás en otra web).'
                : 'Seguir al agente: desactivado. La tarjeta se ilumina y un aviso ofrece «Ver».'
            }
            onClick={() => setFollowAgent(!followAgent)}
          >
            {followAgent ? <Eye aria-hidden size={16} strokeWidth={1.75} /> : <EyeOff aria-hidden size={16} strokeWidth={1.75} />}
          </button>
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
          <button
            type="button"
            className="icon-button"
            aria-label="Más acciones de agentes"
            title="Más acciones"
            aria-haspopup="menu"
            aria-expanded={moreAnchor !== null}
            onClick={event => {
              if (moreAnchor) {
                setMoreAnchor(null)
                return
              }
              const rect = event.currentTarget.getBoundingClientRect()
              setMoreAnchor({ x: rect.right, y: rect.bottom + 4 })
            }}
          >
            <Ellipsis aria-hidden size={16} strokeWidth={1.75} />
          </button>
          <button type="button" className="icon-button" aria-label="Plegar agentes" title="Plegar" onClick={onCollapse}>
            <PanelRightClose aria-hidden size={16} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {contextProgress && !(contextProgress.phase === 'done' && contextProgress.projects === 0 && contextProgress.warnings.length === 0) && (
        <div className="agents-context">
          <div className="agents-context-line">
            <span
              className={contextProgress.phase === 'error' ? 'agents-context-text agents-context-error' : 'agents-context-text tabular'}
              role="status"
              title={progressText(contextProgress)}
            >
              {progressText(contextProgress)}
            </span>
            {contextProgress.warnings.length > 0 && (
              <button
                type="button"
                className="agents-context-toggle"
                aria-expanded={showWarnings}
                onClick={() => setShowWarnings(shown => !shown)}
              >
                {contextProgress.warnings.length === 1 ? '1 aviso' : `${contextProgress.warnings.length} avisos`}
              </button>
            )}
          </div>
          {showWarnings && contextProgress.warnings.length > 0 && (
            <ul className="agents-context-warnings">
              {contextProgress.warnings.map(warning => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {active && activeStatus && (
        <div className="agents-session-bar">
          <span className="agents-cwd" title={active.cwd}>
            {active.cwd}
          </span>
          {active.mcp.length > 0 && (
            <span className="agents-mcp" aria-label="MCP de la sesión">
              {active.mcp.map(item => (
                <span
                  key={item.name}
                  className={item.status === 'configured' ? 'agents-mcp-chip' : 'agents-mcp-chip agents-mcp-unsupported'}
                  data-mcp={item.name}
                  data-status={item.status}
                  title={item.status === 'configured' ? item.hint : `No configurado: ${item.hint}`}
                >
                  {MCP_LABELS[item.name]}
                </span>
              ))}
            </span>
          )}
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

      {moreAnchor && (
        <Menu
          anchor={moreAnchor}
          align="end"
          label="Más acciones de agentes"
          items={[
            {
              label: 'Actualizar contexto',
              icon: RefreshCw,
              onSelect: () => {
                api.agent.refreshContext(mesaId).then(
                  () => notify('TABLE.md actualizado; Table vuelve a leer Notion', 'info'),
                  (error: unknown) => notify(errorMessage(error)),
                )
              },
            },
            { label: 'Elegir páginas de Notion…', icon: ListChecks, onSelect: chooseNotionPages },
            {
              label: 'Ver contexto',
              icon: FileText,
              onSelect: () => {
                api.agent.openContext(mesaId).catch((error: unknown) => notify(errorMessage(error)))
              },
            },
            {
              label: 'Notion para el agente: archivos filtrados',
              icon: ShieldCheck,
              hint: notionMode === 'files' ? 'activo' : undefined,
              disabled: notionMode === null,
              title:
                'Table no configura el MCP de Notion en las sesiones nuevas y sus herramientas web no abren Notion. No es una garantía: un MCP de Notion en la configuración global del arnés sigue disponible para el agente.',
              // Elegirlo aunque ya esté activo vuelve a quitar Notion de los archivos (p. ej. tras un error).
              onSelect: () => {
                saveNotionMode('files').catch((error: unknown) => notify(errorMessage(error)))
              },
            },
            {
              label: 'Notion para el agente: MCP completo',
              icon: Plug,
              hint: notionMode === 'mcp' ? 'activo' : undefined,
              disabled: notionMode === null,
              onSelect: () => {
                if (notionMode !== 'mcp') {
                  askNotionMcp()
                }
              },
            },
          ]}
          onClose={() => setMoreAnchor(null)}
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

      {!entered && choosingPages && (
        <NotionPagesDialog
          mesaId={mesaId}
          onSaved={() => notify('Selección guardada; Table vuelve a leer Notion', 'info')}
          onClose={() => setChoosingPages(false)}
        />
      )}

      {!entered && confirmNotionMcp && (
        <ConfirmDialog
          title="Activar el MCP de Notion"
          confirmLabel="Activar MCP completo"
          description={
            <>
              <p>
                El agente podrá leer todo lo que tu cuenta ve en Notion, sin el filtro de Table: presupuestos, oportunidades y
                cualquier importe.
              </p>
              <p>
                Se aplica a las sesiones que abras a partir de ahora en esta mesa; la primera vez, el arnés te pedirá
                autorizar Notion con tu cuenta.
              </p>
              <p>
                Las herramientas web de Table también podrán abrir y mirar las webs de Notion de esta mesa con tu sesión.
              </p>
            </>
          }
          onConfirm={() => saveNotionMode('mcp')}
          onClose={() => setConfirmNotionMcp(false)}
        />
      )}
    </aside>
  )
}
