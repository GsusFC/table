import { useEffect, useMemo, useState } from 'react'
import type { MesaId } from '../../shared/model'
import { isPageSelected, toggleBase, togglePage, type NotionPageSelection, type NotionTree } from '../../shared/notionContext'
import { errorMessage } from '../lib/errors'
import { Dialog } from './Dialog'

interface NotionPagesDialogProps {
  readonly mesaId: MesaId
  readonly onSaved: () => void
  readonly onClose: () => void
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/**
 * «Elegir páginas de Notion…»: el árbol de las fichas de la mesa (cuerpo,
 * bases y páginas) para marcar lo que Table lee para el agente. Por defecto,
 * todo; las páginas nuevas de una base marcada entran solas. Cada casilla
 * cambia solo lo que toca: la selección guardada de lo demás (también páginas
 * que no aparecen en el árbol) se conserva tal cual.
 */
export function NotionPagesDialog({ mesaId, onSaved, onClose }: NotionPagesDialogProps) {
  const [tree, setTree] = useState<NotionTree | null>(null)
  const [selections, setSelections] = useState<ReadonlyMap<string, NotionPageSelection>>(new Map())
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.table.agent.notionTree(mesaId).then(
      loaded => {
        setTree(loaded)
        setSelections(new Map(loaded.projects.map(project => [project.pageId, project.selection])))
      },
      (caught: unknown) => setError(errorMessage(caught)),
    )
  }, [mesaId])

  const update = (projectId: string, change: (current: NotionPageSelection) => NotionPageSelection): void =>
    setSelections(current => {
      const selection = current.get(projectId)
      return selection ? new Map(current).set(projectId, change(selection)) : current
    })

  const setBase = (projectId: string, baseUrl: string, change: (current: NotionPageSelection['bases'][string] | undefined) => NotionPageSelection['bases'][string]): void =>
    update(projectId, selection => ({ ...selection, bases: { ...selection.bases, [baseUrl]: change(selection.bases[baseUrl]) } }))

  const counts = useMemo(() => {
    let selected = 0
    let total = 0
    for (const project of tree?.projects ?? []) {
      const selection = selections.get(project.pageId)
      total += 1
      selected += selection?.body ? 1 : 0
      for (const base of project.bases) {
        total += base.pages.length
        selected += selection ? base.pages.filter(page => isPageSelected(selection, base.dataSourceUrl, page.pageId)).length : 0
      }
    }
    return { selected, total }
  }, [tree, selections])

  const submit = (): void => {
    if (busy || !tree) {
      return
    }
    setBusy(true)
    setError(null)
    window.table.agent.setNotionSelection(mesaId, Object.fromEntries(selections)).then(
      () => {
        onSaved()
        onClose()
      },
      (caught: unknown) => {
        setBusy(false)
        setError(errorMessage(caught))
      },
    )
  }

  const needle = fold(query.trim())
  return (
    <Dialog
      title="Páginas de Notion para el agente"
      onSubmit={submit}
      onCancel={() => !busy && onClose()}
      actions={
        <>
          <span className="notion-pages-count tabular" aria-live="polite">
            {tree ? `${counts.selected} de ${counts.total} páginas` : ''}
          </span>
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="button button-primary" disabled={busy || !tree || tree.projects.length === 0}>
            {busy ? 'Guardando…' : 'Guardar y leer'}
          </button>
        </>
      }
    >
      <p className="settings-help">
        Table lee lo marcado, lo filtra y lo deja en <code>notion/</code> para el agente. Las páginas nuevas de una base marcada
        entran solas.
      </p>
      {tree && tree.projects.length > 0 && (
        <input
          className="input"
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Filtrar páginas"
          aria-label="Filtrar páginas"
          maxLength={200}
          spellCheck={false}
          disabled={busy}
        />
      )}
      <div className="notion-pages-list">
        {!tree && !error && <p className="settings-help">Leyendo las fichas en Notion…</p>}
        {tree?.projects.length === 0 && (
          <p className="settings-help">
            La mesa no tiene fichas de proyecto de Notion. Vincula una con clic derecho en el lienzo → «Vincular proyecto de
            Notion».
          </p>
        )}
        {tree?.projects.map(project => {
          const selection = selections.get(project.pageId) ?? project.selection
          return (
            <fieldset key={project.pageId} className="notion-pages-project">
              <legend className="field-label">{project.title}</legend>
              <label className="frames-item">
                <input
                  type="checkbox"
                  checked={selection.body}
                  disabled={busy}
                  onChange={event => {
                    const body = event.target.checked
                    update(project.pageId, current => ({ ...current, body }))
                  }}
                />
                <span className="frames-item-name">Cuerpo de la ficha</span>
              </label>
              {project.bases.map(base => {
                const marked = base.pages.filter(page => isPageSelected(selection, base.dataSourceUrl, page.pageId)).length
                const all = base.pages.length > 0 && marked === base.pages.length
                const some = marked > 0 && !all
                const visible = needle ? base.pages.filter(page => fold(page.title).includes(needle)) : base.pages
                const pageIds = base.pages.map(page => page.pageId)
                return (
                  <div key={base.dataSourceUrl} className="notion-pages-base">
                    <label className="frames-item notion-pages-base-row">
                      <input
                        type="checkbox"
                        checked={all}
                        ref={element => {
                          if (element) {
                            element.indeterminate = some
                          }
                        }}
                        disabled={busy || base.pages.length === 0}
                        onChange={() => setBase(project.pageId, base.dataSourceUrl, current => toggleBase(current, pageIds, !all))}
                      />
                      <span className="frames-item-name">Base «{base.title}»</span>
                      <span className="frames-item-note tabular">
                        {marked} de {base.pages.length}
                      </span>
                    </label>
                    {base.truncated && (
                      <p className="frames-item-note notion-pages-note">La base tiene más filas de las que Table lee.</p>
                    )}
                    {visible.map(page => {
                      const checked = isPageSelected(selection, base.dataSourceUrl, page.pageId)
                      return (
                        <label key={page.pageId} className="frames-item notion-pages-page">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={busy}
                            onChange={() => setBase(project.pageId, base.dataSourceUrl, current => togglePage(current, page.pageId, !checked))}
                          />
                          <span className="frames-item-name">{page.title || 'Sin título'}</span>
                        </label>
                      )
                    })}
                    {needle && visible.length === 0 && base.pages.length > 0 && (
                      <p className="frames-item-note notion-pages-note">Ninguna página con ese nombre.</p>
                    )}
                  </div>
                )
              })}
            </fieldset>
          )
        })}
      </div>
      {tree && tree.warnings.length > 0 && (
        <ul className="notion-pages-warnings">
          {tree.warnings.map(warning => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  )
}
