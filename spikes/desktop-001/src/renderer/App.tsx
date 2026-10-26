import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import type { SurfaceState } from '../shared/ipc'
import { exitShortcutLabel } from '../shared/shortcut'
import { ZOOM_MAX, ZOOM_MIN } from '../shared/validate'

const api = window.tableSpike
const ZOOM_STEP = 0.1
const SHORTCUT = exitShortcutLabel(api.platform)

const STATUS_LABEL: Record<SurfaceState['status'], string> = {
  empty: 'Sin web',
  loading: 'Cargando',
  ready: 'Cargada',
  failed: 'Error',
  unloaded: 'Descargada',
}

function cardStateLabel(state: SurfaceState | null): string {
  if (!state || state.status === 'empty') {
    return '—'
  }
  if (state.status === 'unloaded') {
    return 'Descargada'
  }
  return state.entered ? 'Activa' : 'Conservada (cargada y oculta)'
}

function formatTime(epochMs: number | null): string {
  return epochMs === null ? '—' : new Date(epochMs).toLocaleTimeString('es-ES')
}

/** Quita el prefijo que Electron añade a los errores de `ipcRenderer.invoke`. */
function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export function App() {
  const [state, setState] = useState<SurfaceState | null>(null)
  const [address, setAddress] = useState('https://example.com')
  const [error, setError] = useState<string | null>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const enterRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    void api.getState().then(setState)
    return api.onState(setState)
  }, [])

  // La barra refleja la URL real tras redirecciones (p. ej. al iniciar sesión).
  const currentUrl = state?.url ?? null
  useEffect(() => {
    if (currentUrl) {
      setAddress(currentUrl)
    }
  }, [currentUrl])

  const reportBounds = useCallback(() => {
    const element = surfaceRef.current
    if (!element) {
      return
    }
    const rect = element.getBoundingClientRect()
    api.setBounds({ x: rect.left, y: rect.top, width: rect.width, height: rect.height })
  }, [])

  useLayoutEffect(() => {
    const element = surfaceRef.current
    if (!element) {
      return
    }
    const observer = new ResizeObserver(reportBounds)
    observer.observe(element)
    window.addEventListener('resize', reportBounds)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', reportBounds)
    }
  }, [reportBounds])

  // La posición puede cambiar sin cambiar el tamaño (p. ej. al aparecer un aviso).
  useLayoutEffect(reportBounds, [reportBounds, state, error])

  const entered = state?.entered ?? false
  useEffect(() => {
    if (!entered) {
      enterRef.current?.focus()
    }
  }, [entered])

  const run = useCallback(async (action: () => Promise<void>) => {
    setError(null)
    try {
      await action()
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }, [])

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault()
    const trimmed = address.trim()
    const url = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
    void run(() => api.open(url))
  }

  const canEnter = state?.status === 'ready' || state?.status === 'loading'
  const unloaded = state?.status === 'unloaded'
  const hasView = state !== null && state.status !== 'empty' && !unloaded
  const reload = (): void => {
    if (state?.url) {
      const url = state.url
      void run(() => api.open(url))
    }
  }
  const unload = (): void => {
    void run(async () => {
      await api.unload()
    })
  }
  const zoom = state?.zoomFactor ?? 1
  const changeZoom = (factor: number): void => {
    void run(() => api.setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, factor))))
  }

  return (
    <div className="app">
      <header className="toolbar">
        <form className="address" onSubmit={onSubmit}>
          <input
            aria-label="Dirección web"
            value={address}
            onChange={event => setAddress(event.target.value)}
            spellCheck={false}
          />
          <button type="submit">Abrir</button>
        </form>
        <span className={`status status-${state?.status ?? 'empty'}`}>
          {STATUS_LABEL[state?.status ?? 'empty']}
        </span>
      </header>

      <main className="workspace">
        <section className={`card${entered ? ' card-entered' : ''}`} aria-label="Tarjeta web">
          <div className="card-header">
            <span className="card-title">{state?.title ?? 'Superficie web'}</span>
            <div className="card-actions">
              <div className="zoom" role="group" aria-label="Zoom de la web">
                <button type="button" disabled={!hasView} onClick={() => changeZoom(zoom - ZOOM_STEP)}>
                  −
                </button>
                <button type="button" disabled={!hasView} onClick={() => changeZoom(1)}>
                  {Math.round(zoom * 100)}%
                </button>
                <button type="button" disabled={!hasView} onClick={() => changeZoom(zoom + ZOOM_STEP)}>
                  +
                </button>
              </div>
              {entered && (
                <button type="button" className="primary" onClick={() => void run(api.exit)}>
                  Volver a Table <kbd>{SHORTCUT}</kbd>
                </button>
              )}
              {!entered && hasView && (
                <>
                  <button type="button" onClick={unload}>
                    Descargar
                  </button>
                  <button
                    ref={enterRef}
                    type="button"
                    className="primary"
                    disabled={!canEnter}
                    onClick={() => void run(api.enter)}
                  >
                    Entrar
                  </button>
                </>
              )}
              {unloaded && (
                <button ref={enterRef} type="button" className="primary" onClick={reload}>
                  Recargar
                </button>
              )}
            </div>
          </div>
          <div
            ref={surfaceRef}
            className="card-body"
            data-surface
            onDoubleClick={canEnter && !entered ? () => void run(api.enter) : undefined}
          >
            {!entered &&
              (state?.captureDataUrl ? (
                <figure className="capture">
                  <img src={state.captureDataUrl} alt="Captura de la web" />
                  <figcaption>
                    {unloaded
                      ? `Descargada. Captura fija de las ${formatTime(state.capturedAt)}: la web no está cargada. Recargar para usarla.`
                      : `Conservada: la web sigue cargada en memoria. Captura de las ${formatTime(state.capturedAt)}; doble clic o Entrar para volver.`}
                  </figcaption>
                </figure>
              ) : (
                <p className="placeholder">
                  {unloaded
                    ? 'Descargada sin captura. Recargar para usarla.'
                    : hasView
                      ? 'Web cargada y oculta. Doble clic o Entrar para interactuar.'
                      : 'Abre una dirección para empezar.'}
                </p>
              ))}
          </div>
        </section>

        <aside className="side">
          <label className="note">
            Nota local
            <textarea placeholder="Escribe aquí al salir de la web para comprobar que el teclado vuelve a Table." />
          </label>
          <dl className="facts">
            <dt>Tarjeta</dt>
            <dd>{cardStateLabel(state)}</dd>
            <dt>Foco</dt>
            <dd>{entered ? 'Web' : 'Table'}</dd>
            <dt>Última carga</dt>
            <dd>{state?.loadMs == null ? '—' : `${(state.loadMs / 1000).toFixed(1)} s`}</dd>
            <dt>Zoom de la web</dt>
            <dd>{Math.round(zoom * 100)}%</dd>
            <dt>Salir de la web</dt>
            <dd>
              <kbd>{SHORTCUT}</kbd> o «Volver a Table». <kbd>Esc</kbd> llega a la web.
            </dd>
            <dt>Último popup</dt>
            <dd>
              {state?.lastPopup
                ? `${state.lastPopup.origin} · ${state.lastPopup.opened ? 'ventana' : 'bloqueado'}`
                : '—'}
            </dd>
          </dl>
          {(error ?? state?.error) && (
            <p className="error" role="alert">
              {error ?? state?.error}
            </p>
          )}
        </aside>
      </main>
    </div>
  )
}
