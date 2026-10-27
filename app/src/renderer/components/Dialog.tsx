import { useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { errorMessage } from '../lib/errors'

interface DialogProps {
  readonly title: string
  readonly children: ReactNode
  /** Botones del pie; el de envío usa `type="submit"`. */
  readonly actions: ReactNode
  readonly onSubmit: () => void
  readonly onCancel: () => void
  readonly role?: 'dialog' | 'alertdialog'
}

/**
 * Diálogo modal nativo (`<dialog>` + `showModal`): capa superior, foco
 * atrapado y Esc los da el navegador. Nunca se abre con una web en el panel:
 * la vista nativa lo taparía.
 */
export function Dialog({ title, children, actions, onSubmit, onCancel, role = 'dialog' }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useLayoutEffect(() => {
    const dialog = ref.current
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog?.showModal()
    return () => {
      dialog?.close()
      if (previous?.isConnected) {
        previous.focus()
      }
    }
  }, [])

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    onSubmit()
  }

  return (
    <dialog
      ref={ref}
      className="dialog"
      role={role}
      aria-labelledby="dialog-title"
      onCancel={event => {
        event.preventDefault()
        onCancel()
      }}
    >
      <form className="dialog-form" onSubmit={submit} noValidate>
        <h2 id="dialog-title" className="dialog-title">
          {title}
        </h2>
        {children}
        <div className="dialog-actions">{actions}</div>
      </form>
    </dialog>
  )
}

interface ConfirmDialogProps {
  readonly title: string
  readonly description: ReactNode
  readonly confirmLabel: string
  /** `danger` (por defecto) para lo que destruye; `primary` para conceder un permiso. */
  readonly confirmTone?: 'danger' | 'primary'
  readonly onConfirm: () => Promise<void>
  readonly onClose: () => void
}

/** Confirmación de una acción destructiva o de un permiso. El error se muestra en el propio diálogo. */
export function ConfirmDialog({ title, description, confirmLabel, confirmTone = 'danger', onConfirm, onClose }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = (): void => {
    if (busy) {
      return
    }
    setBusy(true)
    setError(null)
    onConfirm().then(onClose, (caught: unknown) => {
      setBusy(false)
      setError(errorMessage(caught))
    })
  }

  return (
    <Dialog
      title={title}
      role="alertdialog"
      onSubmit={confirm}
      onCancel={() => !busy && onClose()}
      actions={
        <>
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className={`button button-${confirmTone}`} disabled={busy} autoFocus>
            {busy ? 'Un momento…' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="dialog-body">{description}</div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  )
}
