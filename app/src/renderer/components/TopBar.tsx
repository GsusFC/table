import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  CircleAlert,
  Ellipsis,
  Info,
  PanelLeft,
  Pencil,
  Plus,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import type { ServiceDefinition } from '../../shared/services'
import { EXIT_SHORTCUT_LABEL } from '../lib/shortcut'
import type { CardStatus } from '../lib/status'
import { Menu } from './Menu'
import { NameEditor } from './NameEditor'
import { ServiceBadge } from './ServiceBadge'

export type SaveStatus = 'saving' | 'saved' | 'failed'

export interface Notice {
  readonly id: number
  readonly text: string
  readonly tone: 'info' | 'error'
}

export interface EnteredCard {
  readonly service: ServiceDefinition
  readonly title: string
  readonly status: CardStatus
  readonly error: string | null
}

interface TopBarProps {
  readonly isMac: boolean
  readonly canGoBack: boolean
  readonly canGoForward: boolean
  readonly onBack: () => void
  readonly onForward: () => void
  readonly railOpen: boolean
  readonly onToggleRail: () => void
  readonly onNewMesa: () => void
  /** null en el inicio. */
  readonly mesa: { readonly name: string; readonly save: SaveStatus } | null
  readonly onRenameMesa: (name: string) => Promise<void>
  readonly onDeleteMesa: () => void
  readonly onAddUrl: () => void
  /** Web en el panel principal (opción B). */
  readonly entered: EnteredCard | null
  readonly onExit: () => void
  readonly notice: Notice | null
  readonly onDismissNotice: () => void
}

const SAVE_LABEL: Record<SaveStatus, string> = {
  saving: 'Guardando…',
  saved: 'Guardado',
  failed: 'Sin guardar',
}

const ICON = { size: 16, strokeWidth: 1.75 } as const

/**
 * Barra superior arrastrable (`-webkit-app-region: drag`). Con una web en el
 * panel no abre nada que baje sobre él: solo navegación y «Volver al lienzo».
 */
export function TopBar({
  isMac,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  railOpen,
  onToggleRail,
  onNewMesa,
  mesa,
  onRenameMesa,
  onDeleteMesa,
  onAddUrl,
  entered,
  onExit,
  notice,
  onDismissNotice,
}: TopBarProps) {
  const [renaming, setRenaming] = useState(false)
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null)
  const closeMenu = useCallback(() => setMenuAnchor(null), [])
  const editing = renaming && mesa !== null && entered === null
  const menuOpen = menuAnchor !== null && mesa !== null && entered === null

  return (
    <header className={isMac ? 'topbar topbar-mac' : 'topbar'}>
      <div className="topbar-group">
        <button
          type="button"
          className="icon-button"
          aria-label="Atrás"
          title="Atrás"
          disabled={!canGoBack}
          onClick={onBack}
        >
          <ArrowLeft aria-hidden {...ICON} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Adelante"
          title="Adelante"
          disabled={!canGoForward}
          onClick={onForward}
        >
          <ArrowRight aria-hidden {...ICON} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={railOpen ? 'Ocultar carril lateral' : 'Mostrar carril lateral'}
          aria-pressed={railOpen}
          title={railOpen ? 'Ocultar carril' : 'Mostrar carril'}
          onClick={onToggleRail}
        >
          <PanelLeft aria-hidden {...ICON} />
        </button>
        <button type="button" className="icon-button" aria-label="Nueva mesa" title="Nueva mesa" onClick={onNewMesa}>
          <SquarePen aria-hidden {...ICON} />
        </button>
      </div>

      <span className="topbar-divider" aria-hidden />

      <div className="topbar-title">
        {mesa === null && <span className="topbar-name topbar-name-static">Inicio</span>}

        {mesa !== null && entered === null && !editing && (
          <>
            <span
              className="topbar-name"
              title="Doble clic para renombrar"
              onDoubleClick={() => setRenaming(true)}
            >
              {mesa.name}
            </span>
            <span className={`save-indicator save-${mesa.save}`} role="status">
              <span className="save-dot" aria-hidden />
              {SAVE_LABEL[mesa.save]}
            </span>
          </>
        )}

        {editing && mesa && (
          <NameEditor
            initial={mesa.name}
            label="Nombre de la mesa"
            className="topbar-name-editor"
            onSubmit={onRenameMesa}
            onDone={() => setRenaming(false)}
          />
        )}

        {mesa !== null && entered !== null && (
          <>
            <span className="topbar-name topbar-name-muted">{mesa.name}</span>
            <ChevronRight aria-hidden size={14} strokeWidth={1.75} className="topbar-crumb" />
            <ServiceBadge service={entered.service} />
            <span className="topbar-web-title" title={entered.title}>
              {entered.title}
            </span>
            {entered.status.tone !== 'live' && (
              <span className={`status status-${entered.status.tone}`} title={entered.error ?? undefined}>
                {entered.status.label}
              </span>
            )}
          </>
        )}
      </div>

      <div className="topbar-end">
        {notice && (
          <div className={`notice notice-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
            {notice.tone === 'error' ? (
              <CircleAlert aria-hidden size={14} strokeWidth={1.75} />
            ) : (
              <Info aria-hidden size={14} strokeWidth={1.75} />
            )}
            <span className="notice-text" title={notice.text}>
              {notice.text}
            </span>
            <button type="button" className="icon-button icon-button-small" aria-label="Cerrar aviso" onClick={onDismissNotice}>
              <X aria-hidden size={14} strokeWidth={1.75} />
            </button>
          </div>
        )}

        {mesa !== null && entered === null && (
          <div className="topbar-group">
            <button
              type="button"
              className="icon-button"
              aria-label="Acciones de la mesa"
              title="Acciones de la mesa"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={event => {
                if (menuOpen) {
                  closeMenu()
                  return
                }
                const rect = event.currentTarget.getBoundingClientRect()
                setMenuAnchor({ x: rect.right, y: rect.bottom + 6 })
              }}
            >
              <Ellipsis aria-hidden {...ICON} />
            </button>
            <button type="button" className="icon-button" aria-label="Añadir URL" title="Añadir URL" onClick={onAddUrl}>
              <Plus aria-hidden {...ICON} />
            </button>
          </div>
        )}

        {entered !== null && (
          <button type="button" className="button button-primary button-exit" onClick={onExit}>
            Volver al lienzo
            <kbd className="kbd-inverse">{EXIT_SHORTCUT_LABEL}</kbd>
          </button>
        )}
      </div>

      {menuOpen && menuAnchor && (
        <Menu
          anchor={menuAnchor}
          align="end"
          label="Acciones de la mesa"
          onClose={closeMenu}
          items={[
            { label: 'Renombrar', icon: Pencil, onSelect: () => setRenaming(true) },
            { label: 'Borrar mesa', icon: Trash2, danger: true, onSelect: onDeleteMesa },
          ]}
        />
      )}
    </header>
  )
}
