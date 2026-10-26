import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { MAX_MESA_NAME_LENGTH } from '../../shared/model'
import { parseMesaName } from '../../shared/validate'
import { errorMessage } from '../lib/errors'

interface NameEditorProps {
  readonly initial: string
  readonly label: string
  readonly className?: string
  /** Recibe el nombre ya validado y distinto del actual. */
  readonly onSubmit: (name: string) => Promise<void>
  readonly onDone: () => void
}

/** Renombrar en el sitio: Enter o salir del campo guarda, Esc cancela. */
export function NameEditor({ initial, label, className, onSubmit, onDone }: NameEditorProps) {
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const finished = useRef(false)

  useEffect(() => {
    ref.current?.select()
  }, [])

  const commit = (): void => {
    if (busy || finished.current) {
      return
    }
    let name: string
    try {
      name = parseMesaName(value)
    } catch (caught) {
      setError(errorMessage(caught))
      return
    }
    if (name === initial) {
      finished.current = true
      onDone()
      return
    }
    setBusy(true)
    onSubmit(name).then(
      () => {
        finished.current = true
        onDone()
      },
      (caught: unknown) => {
        setBusy(false)
        setError(errorMessage(caught))
      },
    )
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      finished.current = true
      onDone()
    }
  }

  return (
    <span className={className ? `name-editor ${className}` : 'name-editor'}>
      <input
        ref={ref}
        className="input name-editor-input"
        value={value}
        onChange={event => {
          setValue(event.target.value)
          setError(null)
        }}
        onKeyDown={onKeyDown}
        onBlur={commit}
        maxLength={MAX_MESA_NAME_LENGTH}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        disabled={busy}
        autoFocus
        spellCheck={false}
      />
      {error && (
        <span className="field-error name-editor-error" role="alert">
          {error}
        </span>
      )}
    </span>
  )
}
