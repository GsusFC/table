import { useEffect, useState } from 'react'
import type { FigmaFileFrames, FigmaFrame } from '../../shared/figma'
import type { CardId, MesaId } from '../../shared/model'
import { errorMessage } from '../lib/errors'
import { Dialog } from './Dialog'

interface FramesDialogProps {
  readonly mesaId: MesaId
  /** Tarjeta del archivo de Figma. */
  readonly cardId: CardId
  /** Frames ya presentes en la mesa (IDs de nodo): aparecen marcados y no se repiten. */
  readonly existing: ReadonlySet<string>
  /** Crea las tarjetas de los frames elegidos. */
  readonly onAdd: (frames: readonly { frame: FigmaFrame; pageName: string }[]) => Promise<void>
  readonly onClose: () => void
}

/** «Añadir frames»: páginas del archivo con sus frames de primer nivel para elegir. */
export function FramesDialog({ mesaId, cardId, existing, onAdd, onClose }: FramesDialogProps) {
  const [file, setFile] = useState<FigmaFileFrames | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.table.figma.listFrames(mesaId, cardId).then(setFile, (caught: unknown) => setError(errorMessage(caught)))
  }, [mesaId, cardId])

  const toggle = (nodeId: string): void =>
    setSelected(current => {
      const next = new Set(current)
      if (!next.delete(nodeId)) {
        next.add(nodeId)
      }
      return next
    })

  const submit = (): void => {
    if (busy || !file || selected.size === 0) {
      return
    }
    const chosen = file.pages.flatMap(page =>
      page.frames.filter(frame => selected.has(frame.nodeId)).map(frame => ({ frame, pageName: page.name })),
    )
    setBusy(true)
    setError(null)
    onAdd(chosen).then(onClose, (caught: unknown) => {
      setBusy(false)
      setError(errorMessage(caught))
    })
  }

  const count = selected.size
  return (
    <Dialog
      title={file ? `Añadir frames de «${file.fileName}»` : 'Añadir frames'}
      onSubmit={submit}
      onCancel={() => !busy && onClose()}
      actions={
        <>
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="button button-primary" disabled={busy || count === 0}>
            {busy ? 'Añadiendo…' : count === 1 ? 'Añadir 1 frame' : `Añadir ${count} frames`}
          </button>
        </>
      }
    >
      <div className="frames-list">
        {!file && !error && <p className="settings-help">Leyendo el archivo en Figma…</p>}
        {file?.pages.map(page => (
          <fieldset key={page.id} className="frames-page">
            <legend className="field-label">{page.name}</legend>
            {page.frames.length === 0 && <p className="settings-help">Sin frames en esta página.</p>}
            {page.frames.map(frame => {
              const already = existing.has(frame.nodeId)
              return (
                <label key={frame.nodeId} className={already ? 'frames-item frames-item-existing' : 'frames-item'}>
                  <input
                    type="checkbox"
                    checked={already || selected.has(frame.nodeId)}
                    disabled={already || busy}
                    onChange={() => toggle(frame.nodeId)}
                  />
                  <span className="frames-item-name">{frame.name}</span>
                  {already && <span className="frames-item-note">ya en la mesa</span>}
                </label>
              )
            })}
          </fieldset>
        ))}
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  )
}
