import { FileText } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ProjectSearchResult } from '../../shared/notion'
import { errorMessage } from '../lib/errors'
import { relativeDate } from '../lib/format'
import { Dialog } from './Dialog'

const api = window.table
const SEARCH_DELAY_MS = 300

interface LinkProjectDialogProps {
  /** Crea la tarjeta de la ficha elegida. */
  readonly onPick: (project: ProjectSearchResult) => Promise<void>
  readonly onClose: () => void
}

type SearchState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'searching' }
  | { readonly kind: 'done'; readonly results: readonly ProjectSearchResult[] }
  | { readonly kind: 'error'; readonly message: string }

/** «Vincular proyecto de Notion»: busca fichas de proyecto por nombre y crea su tarjeta. */
export function LinkProjectDialog({ onPick, onClose }: LinkProjectDialogProps) {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<SearchState>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)
  const latest = useRef(0)

  useEffect(() => {
    api.settings.notion().then(view => setConnected(view.connected), () => setConnected(false))
  }, [])

  useEffect(() => {
    const text = query.trim()
    if (!connected || text.length < 2) {
      setSearch({ kind: 'idle' })
      return
    }
    // Solo cuenta la última búsqueda: las respuestas viejas se ignoran.
    const id = ++latest.current
    setSearch({ kind: 'searching' })
    const timer = setTimeout(() => {
      api.notion.searchProjects(text).then(
        results => id === latest.current && setSearch({ kind: 'done', results }),
        (error: unknown) => id === latest.current && setSearch({ kind: 'error', message: errorMessage(error) }),
      )
    }, SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [query, connected])

  const pick = (project: ProjectSearchResult): void => {
    if (busy) {
      return
    }
    setBusy(true)
    onPick(project).then(onClose, (error: unknown) => {
      setBusy(false)
      setSearch({ kind: 'error', message: errorMessage(error) })
    })
  }

  const results = search.kind === 'done' ? search.results : []

  return (
    <Dialog
      title="Vincular proyecto de Notion"
      onSubmit={() => results[0] && pick(results[0])}
      onCancel={() => !busy && onClose()}
      actions={
        <button type="button" className="button" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
      }
    >
      {connected === false ? (
        <p className="dialog-body">Conecta Notion en Ajustes (abajo en la barra lateral) para buscar tus proyectos.</p>
      ) : (
        <>
          <input
            className="input"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Nombre del proyecto"
            aria-label="Nombre del proyecto"
            maxLength={200}
            autoFocus
            spellCheck={false}
            disabled={busy}
          />
          <div className="link-results" role="listbox" aria-label="Proyectos encontrados" aria-busy={search.kind === 'searching'}>
            {search.kind === 'idle' && <p className="settings-help">Escribe al menos dos letras.</p>}
            {search.kind === 'searching' && <p className="settings-help">Buscando en Notion…</p>}
            {search.kind === 'error' && (
              <p className="field-error" role="alert">
                {search.message}
              </p>
            )}
            {search.kind === 'done' && results.length === 0 && (
              <p className="settings-help">Ninguna ficha de proyecto con ese nombre.</p>
            )}
            {results.map(project => (
              <button
                key={project.pageId}
                type="button"
                role="option"
                aria-selected={false}
                className="link-result"
                onClick={() => pick(project)}
                disabled={busy}
              >
                <FileText aria-hidden size={15} strokeWidth={1.75} />
                <span className="link-result-text">
                  <span className="link-result-title">{project.title}</span>
                  <span className="link-result-meta">
                    {[project.path, project.editedAt ? `editada ${relativeDate(project.editedAt)}` : null].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </Dialog>
  )
}
