import { useState } from 'react'
import { MAX_MESA_NAME_LENGTH } from '../../shared/model'
import { parseMesaName } from '../../shared/validate'
import { errorMessage } from '../lib/errors'
import { readUrlInput } from '../lib/url'
import { Dialog } from './Dialog'

interface NewMesaDialogProps {
  /** Crea la mesa con sus enlaces iniciales ya validados y la abre. */
  readonly onCreate: (name: string, urls: readonly string[]) => Promise<void>
  readonly onClose: () => void
}

interface FormErrors {
  readonly name?: string
  readonly links?: string
  readonly submit?: string
}

/** «Nueva mesa»: nombre y, si se tienen ya, enlaces (D-013). */
export function NewMesaDialog({ onCreate, onClose }: NewMesaDialogProps) {
  const [name, setName] = useState('')
  const [links, setLinks] = useState('')
  const [errors, setErrors] = useState<FormErrors>({})
  const [busy, setBusy] = useState(false)

  const submit = (): void => {
    if (busy) {
      return
    }
    const next: { name?: string; links?: string } = {}
    let validName = ''
    try {
      validName = parseMesaName(name)
    } catch (error) {
      next.name = errorMessage(error)
    }
    const urls: string[] = []
    const invalid: number[] = []
    links.split(/\r?\n/).forEach((line, index) => {
      if (line.trim().length === 0) {
        return
      }
      const result = readUrlInput(line)
      if (result.ok) {
        urls.push(result.url)
      } else {
        invalid.push(index + 1)
      }
    })
    if (invalid.length > 0) {
      next.links =
        invalid.length === 1
          ? `La línea ${invalid[0]} no es una URL http(s) válida`
          : `Las líneas ${invalid.join(', ')} no son URL http(s) válidas`
    }
    setErrors(next)
    if (next.name || next.links) {
      return
    }
    setBusy(true)
    onCreate(validName, urls).then(onClose, (error: unknown) => {
      setBusy(false)
      setErrors({ submit: errorMessage(error) })
    })
  }

  return (
    <Dialog
      title="Nueva mesa"
      onSubmit={submit}
      onCancel={() => !busy && onClose()}
      actions={
        <>
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? 'Creando…' : 'Crear mesa'}
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">Nombre</span>
        <input
          className="input"
          value={name}
          onChange={event => setName(event.target.value)}
          maxLength={MAX_MESA_NAME_LENGTH}
          placeholder="Por ejemplo, Rediseño de la tienda"
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? 'new-mesa-name-error' : undefined}
          autoFocus
          spellCheck={false}
        />
        {errors.name && (
          <span id="new-mesa-name-error" className="field-error">
            {errors.name}
          </span>
        )}
      </label>
      <label className="field">
        <span className="field-label">
          Enlaces <span className="field-optional">opcional, uno por línea</span>
        </span>
        <textarea
          className="input textarea"
          value={links}
          onChange={event => setLinks(event.target.value)}
          rows={4}
          placeholder={'figma.com/design/…\nnotion.so/…'}
          aria-invalid={errors.links ? true : undefined}
          aria-describedby={errors.links ? 'new-mesa-links-error' : undefined}
          spellCheck={false}
        />
        {errors.links && (
          <span id="new-mesa-links-error" className="field-error">
            {errors.links}
          </span>
        )}
      </label>
      {errors.submit && (
        <p className="field-error" role="alert">
          {errors.submit}
        </p>
      )}
    </Dialog>
  )
}
