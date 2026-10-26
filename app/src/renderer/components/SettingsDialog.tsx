import { useEffect, useState, type KeyboardEvent } from 'react'
import type { FigmaSettingsView } from '../../shared/figma'
import { PROJECT_FIELDS, type NotionSettingsView } from '../../shared/notion'
import { errorMessage } from '../lib/errors'
import { notifyFigmaThumbnailsChanged } from '../lib/figmaThumbnails'
import { notifyNotionSettingsChanged } from '../lib/notionSettings'
import { Dialog } from './Dialog'

const api = window.table

interface SettingsDialogProps {
  readonly onClose: () => void
}

/** Ajustes globales: conexión con Notion y con Figma, con la cuenta de cada persona. */
export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const [view, setView] = useState<NotionSettingsView | null>(null)
  const [busy, setBusy] = useState<'connect' | 'disconnect' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.settings.notion().then(setView, (caught: unknown) => setError(errorMessage(caught)))
  }, [])

  const run = (kind: 'connect' | 'disconnect', task: () => Promise<NotionSettingsView>): void => {
    if (busy) {
      return
    }
    setBusy(kind)
    setError(null)
    task().then(
      next => {
        setBusy(null)
        setView(next)
        notifyNotionSettingsChanged()
      },
      (caught: unknown) => {
        setBusy(null)
        setError(errorMessage(caught))
      },
    )
  }

  const close = (): void => {
    // Cerrar con la autorización abierta la cancela: no queda nada esperando en segundo plano.
    if (busy === 'connect') {
      void api.settings.cancelConnectNotion()
    }
    onClose()
  }

  const identity = [view?.userName, view?.workspaceName].filter(Boolean).join(' · ')

  return (
    <Dialog
      title="Ajustes"
      onSubmit={close}
      onCancel={close}
      actions={
        <button type="submit" className="button button-primary" disabled={busy === 'disconnect'}>
          Listo
        </button>
      }
    >
      <section className="settings-section" aria-labelledby="settings-notion">
        <h3 id="settings-notion" className="settings-heading">
          Notion
        </h3>
        <p className="settings-help">
          Table lee la ficha de cada proyecto con tu cuenta de Notion. Al conectar se abre el navegador para que lo
          autorices; la conexión se guarda cifrada en el llavero de este Mac.
        </p>

        {view === null ? (
          <p className="settings-help">Cargando…</p>
        ) : view.connected ? (
          <div className="settings-row">
            <span className="settings-value" title={identity}>
              Conectado{identity ? ` como ${identity}` : ''}
            </span>
            <button type="button" className="button" onClick={() => run('disconnect', api.settings.disconnectNotion)} disabled={busy !== null}>
              {busy === 'disconnect' ? 'Desconectando…' : 'Desconectar'}
            </button>
          </div>
        ) : busy === 'connect' ? (
          <div className="settings-row">
            <span className="settings-value">Esperando a que autorices en el navegador…</span>
            <button type="button" className="button" onClick={() => void api.settings.cancelConnectNotion()}>
              Cancelar
            </button>
          </div>
        ) : (
          <div className="settings-row">
            <button type="button" className="button button-primary" onClick={() => run('connect', api.settings.connectNotion)} autoFocus>
              Conectar con Notion
            </button>
          </div>
        )}

        <p className="settings-help">
          Las tarjetas de fichas de proyecto muestran solo: {PROJECT_FIELDS.map(field => field.label.toLowerCase()).join(', ')}.
          Nunca presupuesto, oportunidad, cuenta ni personas.
        </p>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </section>
      <FigmaSettings />
    </Dialog>
  )
}

/** Figma: token personal pegado una vez (Figma no permite conectar con un botón a apps como Table). */
function FigmaSettings() {
  const [view, setView] = useState<FigmaSettingsView | null>(null)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.settings.figma().then(setView, (caught: unknown) => setError(errorMessage(caught)))
  }, [])

  const run = (task: () => Promise<FigmaSettingsView>): void => {
    if (busy) {
      return
    }
    setBusy(true)
    setError(null)
    task().then(
      next => {
        setBusy(false)
        setView(next)
        setToken('')
        notifyFigmaThumbnailsChanged()
      },
      (caught: unknown) => {
        setBusy(false)
        setError(errorMessage(caught))
      },
    )
  }

  const save = (): void => run(() => api.settings.connectFigma(token))
  // Enter guarda el token en lugar de cerrar Ajustes.
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (token.trim()) {
        save()
      }
    }
  }

  return (
    <section className="settings-section" aria-labelledby="settings-figma">
      <h3 id="settings-figma" className="settings-heading">
        Figma
      </h3>
      <p className="settings-help">
        Para añadir frames con miniatura. Crea un token en Figma → Settings → Security → Personal access tokens con
        dos permisos de solo lectura: contenido de archivos (<code>file_content:read</code>) y tu usuario
        (<code>current_user:read</code>), y pégalo aquí. Se guarda cifrado en el llavero de este Mac.
      </p>
      {view === null ? (
        <p className="settings-help">Cargando…</p>
      ) : view.connected ? (
        <div className="settings-row">
          <span className="settings-value">Conectado{view.handle ? ` como ${view.handle}` : ''}</span>
          <button type="button" className="button" onClick={() => run(api.settings.disconnectFigma)} disabled={busy}>
            Quitar
          </button>
        </div>
      ) : (
        <div className="settings-row">
          <input
            className="input"
            type="password"
            value={token}
            onChange={event => setToken(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="figd_…"
            aria-label="Token personal de Figma"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="button" onClick={save} disabled={busy || !token.trim()}>
            {busy ? 'Comprobando…' : 'Guardar'}
          </button>
        </div>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
