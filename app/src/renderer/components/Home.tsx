import { LayoutGrid, Pencil, Plus, TriangleAlert, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { MesaId, MesaSummary } from '../../shared/model'
import { absoluteDate, cardCountLabel, relativeDate } from '../lib/format'
import { NameEditor } from './NameEditor'

interface HomeProps {
  /** null mientras se carga la lista. */
  readonly mesas: readonly MesaSummary[] | null
  /** Archivos de mesa que no se pudieron leer (dañados o de otra versión). */
  readonly unreadable: number
  readonly onOpen: (id: MesaId) => void
  readonly onNewMesa: () => void
  readonly onRename: (id: MesaId, name: string) => Promise<void>
  readonly onDelete: (mesa: MesaSummary) => void
}

/** Inicio: mesas más recientes primero y «Nueva mesa». */
export function Home({ mesas, unreadable, onOpen, onNewMesa, onRename, onDelete }: HomeProps) {
  const [renaming, setRenaming] = useState<MesaId | null>(null)
  const sorted = mesas ? [...mesas].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : null

  return (
    <div className="home">
      <div className="home-inner">
        <header className="home-header">
          <div>
            <h1 className="home-title">Mesas</h1>
            <p className="home-subtitle">Cada mesa reúne los enlaces de un proyecto en un lienzo.</p>
          </div>
          {sorted && sorted.length > 0 && (
            <button type="button" className="button button-primary" onClick={onNewMesa}>
              <Plus aria-hidden size={15} strokeWidth={1.75} />
              Nueva mesa
            </button>
          )}
        </header>

        {unreadable > 0 && (
          <p className="home-unreadable" role="status">
            <TriangleAlert aria-hidden size={14} strokeWidth={1.75} />
            {unreadable === 1
              ? '1 mesa no se puede abrir: archivo dañado o de otra versión. No se ha modificado.'
              : `${unreadable} mesas no se pueden abrir: archivo dañado o de otra versión. No se han modificado.`}
          </p>
        )}

        {sorted === null && (
          <ul className="mesa-list" aria-busy="true" aria-label="Cargando mesas">
            {[0, 1, 2].map(index => (
              <li key={index} className="mesa-row mesa-row-skeleton" aria-hidden>
                <span className="skeleton skeleton-title" />
                <span className="skeleton skeleton-meta" />
              </li>
            ))}
          </ul>
        )}

        {sorted?.length === 0 && (
          <div className="home-empty">
            <LayoutGrid aria-hidden size={24} strokeWidth={1.5} className="home-empty-icon" />
            <h2 className="home-empty-title">Todavía no hay mesas</h2>
            <p className="home-empty-text">
              Crea una con el nombre del proyecto y añade sus enlaces de Figma, Notion, Pinterest o cualquier web.
            </p>
            <button type="button" className="button button-primary" onClick={onNewMesa}>
              <Plus aria-hidden size={15} strokeWidth={1.75} />
              Nueva mesa
            </button>
          </div>
        )}

        {sorted && sorted.length > 0 && (
          <ul className="mesa-list" aria-label="Mesas">
            {sorted.map(mesa => (
              <li key={mesa.id} className="mesa-row">
                {renaming === mesa.id ? (
                  <NameEditor
                    initial={mesa.name}
                    label="Nuevo nombre de la mesa"
                    className="mesa-row-editor"
                    onSubmit={name => onRename(mesa.id, name)}
                    onDone={() => setRenaming(null)}
                  />
                ) : (
                  <button
                    type="button"
                    className="mesa-row-open"
                    onClick={() => onOpen(mesa.id)}
                  >
                    <span className="mesa-row-name">{mesa.name}</span>
                    <span className="mesa-row-meta">
                      <span className="tabular">{cardCountLabel(mesa.cardCount)}</span>
                      <span aria-hidden>·</span>
                      <time dateTime={mesa.updatedAt} title={absoluteDate(mesa.updatedAt)}>
                        {relativeDate(mesa.updatedAt)}
                      </time>
                    </span>
                  </button>
                )}
                <div className="mesa-row-actions">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Renombrar ${mesa.name}`}
                    title="Renombrar"
                    onClick={() => setRenaming(mesa.id)}
                  >
                    <Pencil aria-hidden size={15} strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    className="icon-button icon-button-danger"
                    aria-label={`Borrar ${mesa.name}`}
                    title="Borrar"
                    onClick={() => onDelete(mesa)}
                  >
                    <Trash2 aria-hidden size={15} strokeWidth={1.75} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
