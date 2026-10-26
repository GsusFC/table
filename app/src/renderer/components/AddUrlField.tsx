import { Link } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { errorMessage } from '../lib/errors'
import { readUrlInput } from '../lib/url'

interface AddUrlFieldProps {
  /** Punto en píxeles dentro del contenedor del lienzo. */
  readonly left: number
  readonly top: number
  /** `true`: el campo se centra en el punto; si no, empieza en él. */
  readonly centered: boolean
  /** Recibe la URL ya normalizada; si falla, el error se muestra en el campo. */
  readonly onSubmit: (url: string) => Promise<void>
  readonly onCancel: () => void
}

const EDGE = 12

/** Campo flotante «Añadir URL». Enter crea, Esc o clic fuera cancela. */
export function AddUrlField({ left, top, centered, onSubmit, onCancel }: AddUrlFieldProps) {
  const ref = useRef<HTMLFormElement>(null)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  // Se mantiene dentro del lienzo aunque el clic esté cerca de un borde.
  useLayoutEffect(() => {
    const element = ref.current
    const container = element?.offsetParent
    if (!element || !container) {
      return
    }
    const { width, height } = element.getBoundingClientRect()
    const startLeft = centered ? left - width / 2 : left
    const startTop = centered ? top - height / 2 : top
    setPosition({
      left: Math.max(EDGE, Math.min(startLeft, container.clientWidth - width - EDGE)),
      top: Math.max(EDGE, Math.min(startTop, container.clientHeight - height - EDGE)),
    })
  }, [left, top, centered, error])

  // Los listeners se instalan una vez y leen siempre el estado más reciente.
  const latest = useRef({ busy, onCancel })
  useLayoutEffect(() => {
    latest.current = { busy, onCancel }
  })
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (!latest.current.busy && !ref.current?.contains(event.target as Node)) {
        latest.current.onCancel()
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [])

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (busy) {
      return
    }
    const result = readUrlInput(value)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setBusy(true)
    setError(null)
    onSubmit(result.url).catch((caught: unknown) => {
      setBusy(false)
      setError(errorMessage(caught))
    })
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (!busy) {
        onCancel()
      }
    }
  }

  return (
    <form
      ref={ref}
      className="add-url"
      style={position ?? { left, top, visibility: 'hidden' }}
      onSubmit={submit}
      onKeyDown={onKeyDown}
      onContextMenu={event => event.stopPropagation()}
      noValidate
    >
      <div className="add-url-row">
        <Link aria-hidden size={15} strokeWidth={1.75} className="add-url-icon" />
        <input
          className="add-url-input"
          value={value}
          onChange={event => {
            setValue(event.target.value)
            setError(null)
          }}
          placeholder="Pega o escribe una URL"
          aria-label="URL de la tarjeta"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'add-url-error' : 'add-url-hint'}
          disabled={busy}
          autoFocus
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      {error ? (
        <p id="add-url-error" className="field-error add-url-message" role="alert">
          {error}
        </p>
      ) : (
        <p id="add-url-hint" className="add-url-message add-url-hint">
          <kbd>Enter</kbd> añade · <kbd>Esc</kbd> cancela
        </p>
      )}
    </form>
  )
}
