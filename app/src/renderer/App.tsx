import type { Viewport } from '@xyflow/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_CARD_SIZE,
  type Card,
  type CardId,
  type CardPatch,
  type Mesa,
  type MesaId,
  type MesaListing,
  type MesaSummary,
  type Point,
} from '../shared/model'
import { serviceById } from '../shared/services'
import type { SurfaceCardState, UnloadResult } from '../shared/surface'
import { ConfirmDialog } from './components/Dialog'
import { Home } from './components/Home'
import { MesaCanvas } from './components/MesaCanvas'
import { NewMesaDialog } from './components/NewMesaDialog'
import { Rail } from './components/Rail'
import { ServiceBadge } from './components/ServiceBadge'
import { TopBar, type EnteredCard, type Notice, type SaveStatus } from './components/TopBar'
import { errorMessage } from './lib/errors'
import { cardCountLabel, displayHost } from './lib/format'
import { isExitShortcut } from './lib/shortcut'
import { cardStatus } from './lib/status'

const api = window.table
const isMac = api.platform === 'darwin'

type Route = { readonly kind: 'home' } | { readonly kind: 'mesa'; readonly mesaId: MesaId }

/** Historial de atrás/adelante entre el inicio y las mesas. */
interface NavHistory {
  readonly entries: readonly Route[]
  readonly index: number
}

type DialogState =
  | { readonly kind: 'new-mesa' }
  | { readonly kind: 'delete-mesa'; readonly mesa: Pick<MesaSummary, 'id' | 'name' | 'cardCount'> }

const HOME: Route = { kind: 'home' }
const NOTICE_MS = { info: 4000, error: 8000 } as const
/** Separación de las tarjetas creadas junto con la mesa. */
const INITIAL_GRID = { columns: 3, gap: 40 } as const

function sameRoute(a: Route, b: Route): boolean {
  return a.kind === 'home' ? b.kind === 'home' : b.kind === 'mesa' && a.mesaId === b.mesaId
}

function pushRoute(history: NavHistory, route: Route): NavHistory {
  return { entries: [...history.entries.slice(0, history.index + 1), route], index: history.index + 1 }
}

/** Quita una mesa borrada del historial. Se borra desde el inicio o desde la propia mesa: se acaba en el inicio. */
function withoutMesa(history: NavHistory, mesaId: MesaId): NavHistory {
  const isDeleted = (route: Route): boolean => route.kind === 'mesa' && route.mesaId === mesaId
  const current = history.entries[history.index]
  let entries: Route[] = []
  let index = 0
  history.entries.forEach((route, position) => {
    const last = entries[entries.length - 1]
    if (!isDeleted(route) && !(last && sameRoute(last, route))) {
      entries.push(route)
    }
    if (position === history.index) {
      index = Math.max(0, entries.length - 1)
    }
  })
  if (current && isDeleted(current)) {
    entries = entries.slice(0, index + 1)
    if (entries[index]?.kind !== 'home') {
      entries.push(HOME)
    }
    index = entries.length - 1
  }
  return entries.length === 0 ? { entries: [HOME], index: 0 } : { entries, index }
}

let noticeCounter = 0

/** Guardado fallido sin resolver: mesa a la que afecta (null si no se sabe) y operación. */
type FailureKey = string
const failureKey = (mesaId: MesaId | null, operation: string): FailureKey => `${mesaId ?? '*'}|${operation}`

/** Operaciones de guardado de una tarjeta según los campos que cambian. */
function geometryOperations(cardId: CardId, patch: CardPatch): string[] {
  const operations: string[] = []
  if (patch.position) {
    operations.push(`card:${cardId}:position`)
  }
  if (patch.size) {
    operations.push(`card:${cardId}:size`)
  }
  return operations
}

/** Qué hacer con los fallos de una escritura: mesa y operaciones que registra o resuelve. */
interface TrackedOperations {
  readonly mesaId: MesaId
  readonly operations: readonly string[]
}

export function App() {
  const [history, setHistory] = useState<NavHistory>({ entries: [HOME], index: 0 })
  const route = history.entries[history.index] ?? HOME
  const routeRef = useRef(route)
  useEffect(() => {
    routeRef.current = route
  })
  const [mesa, setMesa] = useState<Mesa | null>(null)
  const [mesas, setMesas] = useState<readonly MesaSummary[] | null>(null)
  const [unreadable, setUnreadable] = useState<readonly string[]>([])
  const [railOpen, setRailOpen] = useState(true)
  const [states, setStates] = useState<ReadonlyMap<CardId, SurfaceCardState>>(() => new Map())
  const [notice, setNotice] = useState<Notice | null>(null)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [addUrlRequest, setAddUrlRequest] = useState(0)
  const [pendingSaves, setPendingSaves] = useState(0)
  /**
   * Guardados fallidos por operación, con la mesa a la que afectan (null: error
   * del proceso principal sin mesa conocida). Una operación solo se resuelve
   * cuando esa misma operación se guarda bien o se recarga la mesa desde disco.
   */
  const [failures, setFailures] = useState<ReadonlyMap<FailureKey, MesaId | null>>(() => new Map())
  /** Escrituras en curso, para esperarlas antes de cerrar. */
  const inFlight = useRef(new Set<Promise<unknown>>())
  /** Guardados con retardo del lienzo que hay que adelantar antes de cerrar. */
  const flushers = useRef(new Set<() => void>())
  const panelRef = useRef<HTMLElement>(null)

  const notify = useCallback((text: string, tone: Notice['tone'] = 'error') => {
    noticeCounter += 1
    setNotice({ id: noticeCounter, text, tone })
  }, [])
  const notifyError = useCallback((error: unknown) => notify(errorMessage(error)), [notify])

  useEffect(() => {
    if (!notice) {
      return
    }
    const timer = window.setTimeout(
      () => setNotice(current => (current?.id === notice.id ? null : current)),
      NOTICE_MS[notice.tone],
    )
    return () => window.clearTimeout(timer)
  }, [notice])

  // Estados de las webs: instantánea inicial y cambios en vivo.
  useEffect(() => {
    let active = true
    const unsubscribe = api.surface.onState(state => {
      setStates(previous => new Map(previous).set(state.cardId, state))
    })
    api.surface.getStates().then(list => {
      if (active) {
        setStates(new Map(list.map(state => [state.cardId, state])))
      }
    }, notifyError)
    return () => {
      active = false
      unsubscribe()
    }
  }, [notifyError])

  /** Quita los fallos que cumplen `matches`. */
  const clearFailures = useCallback((matches: (key: FailureKey, mesaId: MesaId | null) => boolean) => {
    setFailures(previous => {
      const next = new Map([...previous].filter(([key, mesaId]) => !matches(key, mesaId)))
      return next.size === previous.size ? previous : next
    })
  }, [])

  // Título y captura nuevos de una tarjeta, guardados por el proceso principal.
  // Un guardado correcto resuelve los fallos anteriores de esa misma tarjeta.
  useEffect(
    () =>
      api.onCardChanged((mesaId, card) => {
        setMesa(current =>
          current && current.id === mesaId
            ? { ...current, cards: current.cards.map(existing => (existing.id === card.id ? card : existing)) }
            : current,
        )
        const capture = failureKey(mesaId, `card:${card.id}:capture`)
        const title = failureKey(mesaId, `card:${card.id}:title`)
        clearFailures(key => key === capture || key === title)
      }),
    [clearFailures],
  )

  const applyListing = useCallback((listing: MesaListing) => {
    setMesas(listing.mesas)
    setUnreadable(listing.unreadable)
  }, [])

  useEffect(() => {
    api.mesas.list().then(applyListing, (error: unknown) => {
      setMesas([])
      notifyError(error)
    })
  }, [applyListing, notifyError])

  // Errores de guardado del proceso principal (capturas, títulos): aviso y fallo
  // visible en su mesa, con la operación que falló.
  useEffect(
    () =>
      api.onPersistenceError(error => {
        const key = failureKey(error.mesaId, `card:${error.cardId}:${error.operation}`)
        setFailures(previous => new Map(previous).set(key, error.mesaId))
        notify(error.message)
      }),
    [notify],
  )

  const enteredState = useMemo(() => {
    for (const state of states.values()) {
      if (state.entered) {
        return state
      }
    }
    return null
  }, [states])
  const entered = enteredState !== null
  const enteredRef = useRef(entered)
  useEffect(() => {
    enteredRef.current = entered
  })

  // La web ocupa exactamente el panel principal (opción B): se informa su rectángulo.
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) {
      return
    }
    const report = (): void => {
      const rect = panel.getBoundingClientRect()
      api.surface.setPanelBounds({ x: rect.left, y: rect.top, width: rect.width, height: rect.height })
    }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(panel)
    window.addEventListener('resize', report)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', report)
    }
  }, [railOpen])

  const exitWeb = useCallback(() => {
    api.surface.exit().catch(notifyError)
  }, [notifyError])

  // Con el foco en la barra (no en la web) el atajo también vuelve al lienzo.
  useEffect(() => {
    if (!entered) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isExitShortcut(event)) {
        event.preventDefault()
        exitWeb()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [entered, exitWeb])

  /**
   * Envuelve una escritura para el indicador de guardado y la espera de cierre.
   * Con `tracked`, un fallo queda registrado por operación y solo se borra
   * cuando la misma operación se guarda bien.
   */
  const track = useCallback(<T,>(promise: Promise<T>, tracked?: TrackedOperations): Promise<T> => {
    setPendingSaves(count => count + 1)
    const settle = (failed: boolean): void => {
      if (!tracked || tracked.operations.length === 0) {
        return
      }
      const keys = tracked.operations.map(operation => failureKey(tracked.mesaId, operation))
      setFailures(previous => {
        const next = new Map(previous)
        for (const key of keys) {
          if (failed) {
            next.set(key, tracked.mesaId)
          } else {
            next.delete(key)
          }
        }
        return next
      })
    }
    const result = promise
      .then(
        value => {
          settle(false)
          return value
        },
        (error: unknown) => {
          settle(true)
          throw error
        },
      )
      .finally(() => setPendingSaves(count => count - 1))
    const pending = inFlight.current
    pending.add(result)
    const forget = (): void => {
      pending.delete(result)
    }
    result.then(forget, forget)
    return result
  }, [])

  // Antes de cerrar: adelantar los guardados con retardo, esperar las escrituras
  // en curso y avisar (rechazando) si alguna falló o queda un fallo sin resolver.
  const failuresRef = useRef(failures)
  useEffect(() => {
    failuresRef.current = failures
  })
  useEffect(
    () =>
      api.onFlushRequest(async () => {
        for (const flush of flushers.current) {
          flush()
        }
        let failed = false
        while (inFlight.current.size > 0) {
          const results = await Promise.allSettled([...inFlight.current])
          failed ||= results.some(result => result.status === 'rejected')
        }
        if (failed || failuresRef.current.size > 0) {
          throw new Error('Hay cambios sin guardar')
        }
      }),
    [],
  )

  const registerFlush = useCallback((flush: () => void) => {
    flushers.current.add(flush)
    return () => {
      flushers.current.delete(flush)
    }
  }, [])

  // Navegación: cambia la mesa visible en la superficie y solo entonces la pantalla.
  const navigation = useRef(0)
  const show = useCallback(
    async (target: Route, apply: (history: NavHistory) => NavHistory): Promise<void> => {
      const token = ++navigation.current
      const previous = routeRef.current
      let surfaceSwitched = false
      try {
        if (enteredRef.current) {
          await api.surface.exit()
        }
        const result = await api.surface.openMesa(target.kind === 'mesa' ? target.mesaId : null)
        if (token !== navigation.current) {
          return
        }
        if (result === 'kept') {
          notify('Una web avisó de cambios sin guardar y sigue abierta; no se ha cambiado de mesa', 'info')
          return
        }
        surfaceSwitched = true
        if (target.kind === 'mesa') {
          const loaded = await api.mesas.get(target.mesaId)
          if (token !== navigation.current) {
            return
          }
          setMesa(loaded)
          // Lo que se ve ahora es lo que hay en disco: los fallos anteriores quedan revertidos.
          clearFailures((_key, failedMesaId) => failedMesaId === loaded.id || failedMesaId === null)
          setHistory(apply)
          return
        }
        setMesa(null)
        setHistory(apply)
        const listing = await api.mesas.list()
        if (token === navigation.current) {
          applyListing(listing)
        }
      } catch (error) {
        // La superficie ya cambió de mesa pero la pantalla no: se vuelve a la que se ve.
        if (surfaceSwitched) {
          await api.surface.openMesa(previous.kind === 'mesa' ? previous.mesaId : null).catch(() => undefined)
        }
        if (token === navigation.current) {
          notifyError(error)
        }
      }
    },
    [notify, notifyError, clearFailures, applyListing],
  )

  const navigate = (target: Route): void => {
    if (!sameRoute(target, route)) {
      void show(target, current => pushRoute(current, target))
    }
  }
  const back = history.entries[history.index - 1]
  const forward = history.entries[history.index + 1]

  const openNewMesa = (): void => {
    if (enteredRef.current) {
      api.surface.exit().then(() => setDialog({ kind: 'new-mesa' }), notifyError)
    } else {
      setDialog({ kind: 'new-mesa' })
    }
  }

  const createMesa = async (name: string, urls: readonly string[]): Promise<void> => {
    const created = await api.mesas.create(name)
    const failed: string[] = []
    for (const [index, url] of urls.entries()) {
      const position: Point = {
        x: (index % INITIAL_GRID.columns) * (DEFAULT_CARD_SIZE.width + INITIAL_GRID.gap),
        y: Math.floor(index / INITIAL_GRID.columns) * (DEFAULT_CARD_SIZE.height + INITIAL_GRID.gap),
      }
      try {
        await api.cards.add(created.id, url, position)
      } catch {
        failed.push(displayHost(url))
      }
    }
    const target: Route = { kind: 'mesa', mesaId: created.id }
    await show(target, current => pushRoute(current, target))
    if (failed.length > 0) {
      notify(`No se pudieron añadir: ${failed.join(', ')}`)
    }
  }

  const renameMesa = async (id: MesaId, name: string): Promise<void> => {
    const renamed = await track(api.mesas.rename(id, name), { mesaId: id, operations: ['rename'] })
    setMesa(current =>
      current && current.id === id ? { ...current, name: renamed.name, updatedAt: renamed.updatedAt } : current,
    )
    setMesas(list =>
      list?.map(summary =>
        summary.id === id ? { ...summary, name: renamed.name, updatedAt: renamed.updatedAt } : summary,
      ) ?? null,
    )
  }

  const deleteMesa = async (id: MesaId): Promise<void> => {
    // El proceso principal descarga antes las webs de la mesa (beforeunload).
    await api.mesas.remove(id)
    setHistory(current => withoutMesa(current, id))
    setMesa(current => (current?.id === id ? null : current))
    setMesas(list => list?.filter(summary => summary.id !== id) ?? null)
    clearFailures((_key, failedMesaId) => failedMesaId === id)
    api.mesas.list().then(applyListing, notifyError)
  }

  // Operaciones sobre la mesa abierta. El lienzo se monta con `key={mesa.id}`.
  const mesaId = mesa?.id ?? null
  const replaceCard = useCallback((ownerId: MesaId, update: (cards: readonly Card[]) => readonly Card[]) => {
    setMesa(current => (current && current.id === ownerId ? { ...current, cards: update(current.cards) } : current))
  }, [])

  const addCard = useCallback(
    async (url: string, position: Point): Promise<Card> => {
      if (!mesaId) {
        throw new Error('No hay ninguna mesa abierta')
      }
      const card = await track(api.cards.add(mesaId, url, position))
      replaceCard(mesaId, cards => [...cards.filter(existing => existing.id !== card.id), card])
      return card
    },
    [mesaId, track, replaceCard],
  )

  const updateCard = useCallback(
    (cardId: CardId, patch: CardPatch) => {
      if (!mesaId) {
        return
      }
      track(api.cards.update(mesaId, cardId, patch), { mesaId, operations: geometryOperations(cardId, patch) }).then(
        card => replaceCard(mesaId, cards => cards.map(existing => (existing.id === card.id ? card : existing))),
        notifyError,
      )
    },
    [mesaId, track, replaceCard, notifyError],
  )

  const removeCard = useCallback(
    async (cardId: CardId): Promise<UnloadResult> => {
      if (!mesaId) {
        throw new Error('No hay ninguna mesa abierta')
      }
      const result = await track(api.cards.remove(mesaId, cardId))
      if (result === 'unloaded') {
        replaceCard(mesaId, cards => cards.filter(existing => existing.id !== cardId))
        // La tarjeta ya no existe: sus guardados fallidos dejan de importar.
        const prefix = failureKey(mesaId, `card:${cardId}:`)
        clearFailures(key => key.startsWith(prefix))
      }
      return result
    },
    [mesaId, track, replaceCard, clearFailures],
  )

  const saveViewport = useCallback(
    (viewport: Viewport) => {
      if (mesaId) {
        track(api.mesas.setViewport(mesaId, { x: viewport.x, y: viewport.y, zoom: viewport.zoom }), {
          mesaId,
          operations: ['viewport'],
        }).catch(notifyError)
      }
    },
    [mesaId, track, notifyError],
  )

  const enterCard = useCallback(
    (cardId: CardId) => {
      if (mesaId) {
        api.surface.enter(mesaId, cardId).catch(notifyError)
      }
    },
    [mesaId, notifyError],
  )

  const enteredCard = useMemo((): EnteredCard | null => {
    if (!enteredState) {
      return null
    }
    const card = mesa?.cards.find(candidate => candidate.id === enteredState.cardId)
    const url = enteredState.currentUrl ?? card?.url ?? ''
    return {
      service: serviceById(card?.serviceId ?? ''),
      title: enteredState.title ?? card?.title ?? displayHost(url),
      status: cardStatus(enteredState),
      error: enteredState.error,
    }
  }, [enteredState, mesa])

  const showingMesa = route.kind === 'mesa' && mesa?.id === route.mesaId ? mesa : null
  const saveFailed =
    showingMesa !== null &&
    [...failures.values()].some(failedMesaId => failedMesaId === null || failedMesaId === showingMesa.id)
  const saveStatus: SaveStatus = pendingSaves > 0 ? 'saving' : saveFailed ? 'failed' : 'saved'

  return (
    <div className={railOpen ? 'shell' : 'shell shell-no-rail'}>
      <TopBar
        isMac={isMac}
        canGoBack={back !== undefined}
        canGoForward={forward !== undefined}
        onBack={() => back && void show(back, current => ({ ...current, index: current.index - 1 }))}
        onForward={() => forward && void show(forward, current => ({ ...current, index: current.index + 1 }))}
        railOpen={railOpen}
        onToggleRail={() => setRailOpen(open => !open)}
        onNewMesa={openNewMesa}
        mesa={showingMesa ? { name: showingMesa.name, save: saveStatus } : null}
        onRenameMesa={name => (showingMesa ? renameMesa(showingMesa.id, name) : Promise.resolve())}
        onDeleteMesa={() =>
          showingMesa &&
          setDialog({
            kind: 'delete-mesa',
            mesa: { id: showingMesa.id, name: showingMesa.name, cardCount: showingMesa.cards.length },
          })
        }
        onAddUrl={() => setAddUrlRequest(count => count + 1)}
        entered={enteredCard}
        onExit={exitWeb}
        notice={notice}
        onDismissNotice={() => setNotice(null)}
      />

      {railOpen && <Rail homeActive={route.kind === 'home'} onHome={() => navigate(HOME)} />}

      <main ref={panelRef} className="panel">
        {route.kind === 'home' && (
          <Home
            mesas={mesas}
            unreadable={unreadable}
            onOpen={id => navigate({ kind: 'mesa', mesaId: id })}
            onNewMesa={openNewMesa}
            onRename={renameMesa}
            onDelete={summary => setDialog({ kind: 'delete-mesa', mesa: summary })}
          />
        )}

        {showingMesa && (
          <div className={entered ? 'panel-content panel-content-hidden' : 'panel-content'} inert={entered}>
            <MesaCanvas
              key={showingMesa.id}
              mesa={showingMesa}
              states={states}
              enteredCardId={enteredState?.cardId ?? null}
              addUrlRequest={addUrlRequest}
              onAddCard={addCard}
              onUpdateCard={updateCard}
              onRemoveCard={removeCard}
              onSaveViewport={saveViewport}
              onEnter={enterCard}
              notify={notify}
              registerFlush={registerFlush}
            />
          </div>
        )}

        {/* Debajo de la vista nativa: solo se ve mientras la web aún no pinta o si falla. */}
        {enteredCard && (
          <div className="panel-web" aria-live="polite">
            <ServiceBadge service={enteredCard.service} size="lg" />
            <p className="panel-web-title">{enteredCard.title}</p>
            <p className={enteredCard.status.tone === 'danger' ? 'panel-web-status field-error' : 'panel-web-status'}>
              {enteredCard.status.tone === 'danger'
                ? (enteredCard.error ?? 'La web no se pudo cargar')
                : 'Abriendo la web…'}
            </p>
          </div>
        )}
      </main>

      {!entered && dialog?.kind === 'new-mesa' && (
        <NewMesaDialog onCreate={createMesa} onClose={() => setDialog(null)} />
      )}

      {!entered && dialog?.kind === 'delete-mesa' && (
        <ConfirmDialog
          title="Borrar mesa"
          confirmLabel="Borrar mesa"
          description={
            <p>
              {dialog.mesa.cardCount === 0
                ? `Se borrará «${dialog.mesa.name}». `
                : `Se borrará «${dialog.mesa.name}» con ${cardCountLabel(dialog.mesa.cardCount)} y sus capturas. `}
              No se puede deshacer. Las webs originales no cambian.
            </p>
          }
          onConfirm={() => deleteMesa(dialog.mesa.id)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}
