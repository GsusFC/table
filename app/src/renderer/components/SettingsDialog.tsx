import { useEffect, useState } from 'react'
import { PROJECT_FIELDS, type NotionDatabase, type NotionSettingsView } from '../../shared/notion'
import { errorMessage } from '../lib/errors'
import { notifyNotionSettingsChanged } from '../lib/notionSettings'
import { Dialog } from './Dialog'

const api = window.table

interface SettingsDialogProps {
  readonly onClose: () => void
}

/** Ajustes globales: conexión con Notion (token y base de proyectos). */
export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const [view, setView] = useState<NotionSettingsView | null>(null)
  const [editingToken, setEditingToken] = useState(false)
  const [token, setToken] = useState('')
  const [databases, setDatabases] = useState<readonly NotionDatabase[] | null>(null)
  const [selected, setSelected] = useState<string>('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.settings.notion().then(setView, (caught: unknown) => setError(errorMessage(caught)))
  }, [])

  const run = (label: string, task: () => Promise<void>): void => {
    if (busy) {
      return
    }
    setBusy(label)
    setError(null)
    task().then(
      () => setBusy(null),
      (caught: unknown) => {
        setBusy(null)
        setError(errorMessage(caught))
      },
    )
  }

  const applied = (next: NotionSettingsView): void => {
    setView(next)
    notifyNotionSettingsChanged()
  }

  const saveToken = (): void =>
    run('token', async () => {
      applied(await api.settings.setNotionToken(token))
      setToken('')
      setEditingToken(false)
      setDatabases(null)
    })

  const removeToken = (): void =>
    run('remove', async () => {
      applied(await api.settings.clearNotionToken())
      setDatabases(null)
    })

  const findDatabases = (): void =>
    run('search', async () => {
      const found = await api.settings.listNotionDatabases()
      setDatabases(found)
      setSelected(view?.database?.id ?? found[0]?.id ?? '')
    })

  const chooseDatabase = (): void =>
    run('database', async () => {
      applied(await api.settings.setNotionDatabase(selected || null))
      setDatabases(null)
    })

  const showTokenInput = view !== null && (!view.hasToken || editingToken)

  return (
    <Dialog
      title="Ajustes"
      onSubmit={() => (showTokenInput && token.trim() ? saveToken() : onClose())}
      onCancel={() => !busy && onClose()}
      actions={
        <button type="button" className="button button-primary" onClick={onClose} disabled={busy !== null}>
          Listo
        </button>
      }
    >
      <section className="settings-section" aria-labelledby="settings-notion">
        <h3 id="settings-notion" className="settings-heading">
          Notion
        </h3>
        <p className="settings-help">
          Table lee la ficha del proyecto con una integración interna de Notion, de solo lectura. El token se guarda
          cifrado en el llavero de este Mac.
        </p>

        {view === null ? (
          <p className="settings-help">Cargando…</p>
        ) : showTokenInput ? (
          <div className="field">
            <label className="field-label" htmlFor="notion-token">
              Token de la integración
            </label>
            <div className="settings-row">
              <input
                id="notion-token"
                className="input"
                type="password"
                value={token}
                onChange={event => setToken(event.target.value)}
                placeholder="ntn_…"
                autoComplete="off"
                spellCheck={false}
                autoFocus
              />
              <button type="button" className="button" onClick={saveToken} disabled={busy !== null || !token.trim()}>
                {busy === 'token' ? 'Guardando…' : 'Guardar'}
              </button>
              {editingToken && (
                <button type="button" className="button" onClick={() => setEditingToken(false)} disabled={busy !== null}>
                  Cancelar
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="settings-row">
            <span className="settings-value">Token guardado ···{view.tokenHint}</span>
            <button type="button" className="button button-small" onClick={() => setEditingToken(true)} disabled={busy !== null}>
              Cambiar
            </button>
            <button type="button" className="button button-small" onClick={removeToken} disabled={busy !== null}>
              Quitar
            </button>
          </div>
        )}

        {view?.hasToken && (
          <div className="field">
            <span className="field-label">Base de proyectos</span>
            <div className="settings-row">
              <span className="settings-value">{view.database?.title ?? 'Sin elegir'}</span>
              <button type="button" className="button button-small" onClick={findDatabases} disabled={busy !== null}>
                {busy === 'search' ? 'Comprobando…' : 'Comprobar conexión'}
              </button>
            </div>
            {databases !== null &&
              (databases.length === 0 ? (
                <p className="field-error">
                  Ninguna base compartida con la integración tiene los campos de proyecto (Status, Services, Start Date, Due
                  Date, Remaining days). Comparte la base de proyectos desde Notion.
                </p>
              ) : (
                <div className="settings-row">
                  <select
                    className="input"
                    value={selected}
                    onChange={event => setSelected(event.target.value)}
                    aria-label="Base de proyectos"
                  >
                    {databases.map(database => (
                      <option key={database.id} value={database.id}>
                        {database.title}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="button" onClick={chooseDatabase} disabled={busy !== null || !selected}>
                    Usar esta base
                  </button>
                </div>
              ))}
          </div>
        )}

        <p className="settings-help">
          Las tarjetas de fichas de esa base muestran solo: {PROJECT_FIELDS.map(field => field.label.toLowerCase()).join(', ')}.
          Nunca presupuesto, oportunidad, cuenta ni personas.
        </p>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </Dialog>
  )
}
