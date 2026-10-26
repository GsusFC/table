import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  useStore,
  ViewportPortal,
  type NodeChange,
  type NodePositionChange,
  type NodeTypes,
  type OnNodeDrag,
  type ResizeParams,
  type Viewport,
} from '@xyflow/react'
import { AlignStartHorizontal, AlignStartVertical, Copy, Download, LayoutGrid, LogIn, Plus, Trash2 } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react'
import { DEFAULT_CARD_SIZE, type Card, type CardId, type CardPatch, type Mesa, type Point } from '../../shared/model'
import type { SurfaceCardState, UnloadResult } from '../../shared/surface'
import { copyText } from '../lib/clipboard'
import { errorMessage } from '../lib/errors'
import { displayHost } from '../lib/format'
import { cardStatus } from '../lib/status'
import { alignEdge, arrangeInGrid, magnetSnap, NO_GUIDES, snapToGrid, type Guides, type Rect } from '../lib/layout'
import { readPastedUrls } from '../lib/url'
import { AddUrlField } from './AddUrlField'
import { CanvasContext, type CanvasContextValue } from './canvasContext'
import { CardNode, type CardNodeType } from './CardNode'
import { ConfirmDialog } from './Dialog'
import { Menu, type MenuItem } from './Menu'

export type Notify = (text: string, tone?: 'info' | 'error') => void

interface MesaCanvasProps {
  readonly mesa: Mesa
  readonly states: ReadonlyMap<CardId, SurfaceCardState>
  readonly enteredCardId: CardId | null
  /** Cambia cada vez que la barra superior pide «Añadir URL». */
  readonly addUrlRequest: number
  readonly onAddCard: (url: string, position: Point) => Promise<Card>
  readonly onUpdateCard: (cardId: CardId, patch: CardPatch) => void
  readonly onRemoveCard: (cardId: CardId) => Promise<UnloadResult>
  readonly onSaveViewport: (viewport: Viewport) => void
  readonly onEnter: (cardId: CardId) => void
  readonly notify: Notify
  /** Registra un guardado inmediato de lo pendiente (antes de cerrar); devuelve la baja. */
  readonly registerFlush: (flush: () => void) => () => void
}

const NODE_TYPES: NodeTypes = { card: CardNode }
const VIEWPORT_SAVE_DELAY_MS = 400
const PASTE_OFFSET = 24
const MIN_ZOOM = 0.1
const MAX_ZOOM = 4
const PASTE_KEY = window.table.platform === 'darwin' ? '⌘V' : 'Ctrl+V'
const ARIA_LABELS = {
  'controls.ariaLabel': 'Controles del lienzo',
  'controls.zoomIn.ariaLabel': 'Acercar',
  'controls.zoomOut.ariaLabel': 'Alejar',
  'controls.fitView.ariaLabel': 'Ver todas las tarjetas',
  'node.a11yDescription.default': 'Tarjeta web. Enter para entrar en la web.',
  'node.a11yDescription.keyboardDisabled': 'Tarjeta web. Enter para entrar en la web.',
}

function toNode(card: Card): CardNodeType {
  return {
    id: card.id,
    type: 'card',
    position: card.position,
    width: card.size.width,
    height: card.size.height,
    data: { card },
  }
}

/** Mantiene la geometría local (el usuario puede estar arrastrando) y toma el resto del disco. */
function mergeNodes(previous: readonly CardNodeType[], cards: readonly Card[]): CardNodeType[] {
  const byId = new Map(previous.map(node => [node.id, node]))
  return cards.map(card => {
    const existing = byId.get(card.id)
    if (!existing) {
      return toNode(card)
    }
    return existing.data.card === card ? existing : { ...existing, data: { card } }
  })
}

const roundPoint = (point: Point): Point => ({ x: Math.round(point.x), y: Math.round(point.y) })

/** Distancia en píxeles de pantalla a la que el imán atrae una tarjeta. */
const MAGNET_SCREEN_PX = 8

function rectOf(node: CardNodeType): Rect {
  return {
    id: node.id,
    x: node.position.x,
    y: node.position.y,
    width: node.measured?.width ?? node.width ?? DEFAULT_CARD_SIZE.width,
    height: node.measured?.height ?? node.height ?? DEFAULT_CARD_SIZE.height,
  }
}

function isDragPosition(change: NodeChange<CardNodeType>): change is NodePositionChange & { position: Point } {
  return change.type === 'position' && change.dragging === true && change.position !== undefined
}

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
  )
}

interface AddFieldState {
  /** Píxeles dentro del contenedor. */
  readonly left: number
  readonly top: number
  readonly centered: boolean
  /** Esquina superior izquierda de la tarjeta, en coordenadas del lienzo. */
  readonly flow: Point
}

interface CardMenuState {
  readonly cardId: CardId
  readonly anchor: Point
}

function CanvasInner({
  mesa,
  states,
  enteredCardId,
  addUrlRequest,
  onAddCard,
  onUpdateCard,
  onRemoveCard,
  onSaveViewport,
  onEnter,
  notify,
  registerFlush,
}: MesaCanvasProps) {
  const flow = useReactFlow<CardNodeType>()
  const containerRef = useRef<HTMLDivElement>(null)
  const [nodes, setNodes] = useState<CardNodeType[]>(() => mesa.cards.map(toNode))
  const [addField, setAddField] = useState<AddFieldState | null>(null)
  const [cardMenu, setCardMenu] = useState<CardMenuState | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<Card | null>(null)
  const [guides, setGuides] = useState<Guides>(NO_GUIDES)
  const zoom = useStore(state => state.transform[2])
  /** Con Opción (Alt) pulsada se arrastra sin imán ni rejilla. */
  const magnetOff = useRef(false)
  useEffect(() => {
    const track = (event: globalThis.KeyboardEvent): void => {
      magnetOff.current = event.altKey
    }
    window.addEventListener('keydown', track)
    window.addEventListener('keyup', track)
    return () => {
      window.removeEventListener('keydown', track)
      window.removeEventListener('keyup', track)
    }
  }, [])

  useEffect(() => {
    setNodes(previous => mergeNodes(previous, mesa.cards))
  }, [mesa.cards])

  // Opción B: con una web en el panel no queda nada del lienzo abierto debajo.
  // Al salir, el foco vuelve a la tarjeta de la que se salió.
  const lastEntered = useRef<CardId | null>(null)
  useEffect(() => {
    if (enteredCardId) {
      lastEntered.current = enteredCardId
      setAddField(null)
      setCardMenu(null)
      setConfirmRemove(null)
      return
    }
    const previous = lastEntered.current
    lastEntered.current = null
    if (previous) {
      const node = containerRef.current?.querySelector<HTMLElement>(
        `.react-flow__node[data-id="${CSS.escape(previous)}"]`,
      )
      ;(node ?? containerRef.current)?.focus({ preventScroll: true })
    }
  }, [enteredCardId])

  // Vista guardada con retardo; lo pendiente se guarda al salir de la mesa o al cerrar Table.
  const pendingViewport = useRef<Viewport | null>(null)
  const viewportTimer = useRef<number | undefined>(undefined)
  const saveViewportRef = useRef(onSaveViewport)
  useEffect(() => {
    saveViewportRef.current = onSaveViewport
  })
  const flushViewport = useCallback(() => {
    window.clearTimeout(viewportTimer.current)
    const viewport = pendingViewport.current
    pendingViewport.current = null
    if (viewport) {
      saveViewportRef.current(viewport)
    }
  }, [])
  useEffect(() => flushViewport, [flushViewport])
  useEffect(() => registerFlush(flushViewport), [registerFlush, flushViewport])

  const onMoveEnd = useCallback(
    (_event: unknown, viewport: Viewport) => {
      pendingViewport.current = viewport
      window.clearTimeout(viewportTimer.current)
      viewportTimer.current = window.setTimeout(flushViewport, VIEWPORT_SAVE_DELAY_MS)
    },
    [flushViewport],
  )

  /**
   * Imán al arrastrar: una tarjeta sola se alinea con bordes o centros de las
   * demás y, si no hay ninguna cerca, con la rejilla; un grupo se mueve a la
   * rejilla conservando las distancias entre sus tarjetas.
   */
  const onNodesChange = useCallback(
    (changes: NodeChange<CardNodeType>[]) => {
      const moving = changes.filter(isDragPosition)
      if (moving.length === 0 || magnetOff.current) {
        if (moving.length > 0) {
          setGuides(NO_GUIDES)
        }
        setNodes(previous => applyNodeChanges(changes, previous))
        return
      }
      const current = flow.getNodes()
      let adjusted = changes
      const [first] = moving
      if (moving.length === 1 && first) {
        const node = current.find(candidate => candidate.id === first.id)
        if (node) {
          const others = current.filter(candidate => candidate.id !== first.id).map(rectOf)
          const snap = magnetSnap({ ...rectOf(node), ...first.position }, others, MAGNET_SCREEN_PX / flow.getZoom())
          setGuides(snap.guides)
          adjusted = changes.map(change => (change === first ? { ...first, position: snap.position } : change))
        }
      } else if (first) {
        const dx = snapToGrid(first.position.x) - first.position.x
        const dy = snapToGrid(first.position.y) - first.position.y
        setGuides(NO_GUIDES)
        adjusted = changes.map(change =>
          isDragPosition(change) ? { ...change, position: { x: change.position.x + dx, y: change.position.y + dy } } : change,
        )
      }
      setNodes(previous => applyNodeChanges(adjusted, previous))
    },
    [flow],
  )

  const cardsById = useMemo(() => new Map(mesa.cards.map(card => [card.id, card])), [mesa.cards])

  /** Guarda las posiciones que cambiaron respecto a lo guardado. */
  const savePositions = useCallback(
    (positions: Iterable<readonly [CardId, Point]>) => {
      for (const [cardId, raw] of positions) {
        const position = roundPoint(raw)
        const saved = cardsById.get(cardId)?.position
        if (!saved || saved.x !== position.x || saved.y !== position.y) {
          onUpdateCard(cardId, { position })
        }
      }
    },
    [cardsById, onUpdateCard],
  )

  const onNodeDragStop = useCallback<OnNodeDrag<CardNodeType>>(
    (_event, _node, dragged) => {
      setGuides(NO_GUIDES)
      savePositions(dragged.map(node => [node.id, node.position] as const))
    },
    [savePositions],
  )

  const selectedCount = nodes.filter(node => node.selected).length

  /** Ordena o alinea las tarjetas seleccionadas y guarda sus posiciones. */
  const arrangeSelection = useCallback(
    (kind: 'grid' | 'left' | 'top') => {
      const rects = flow
        .getNodes()
        .filter(node => node.selected)
        .map(rectOf)
      if (rects.length < 2) {
        return
      }
      const positions = kind === 'grid' ? arrangeInGrid(rects) : alignEdge(rects, kind)
      setNodes(previous =>
        previous.map(node => {
          const position = positions.get(node.id)
          return position ? { ...node, position } : node
        }),
      )
      savePositions(positions)
    },
    [flow, savePositions],
  )

  const openAddFieldAt = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) {
        return
      }
      setCardMenu(null)
      setAddField({
        left: clientX - rect.left,
        top: clientY - rect.top,
        centered: false,
        flow: roundPoint(flow.screenToFlowPosition({ x: clientX, y: clientY })),
      })
    },
    [flow],
  )

  /** Esquina de una tarjeta centrada en la vista, desplazada `offset` pasos. */
  const visibleCenterSlot = useCallback(
    (offset = 0): { left: number; top: number; flow: Point } | null => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) {
        return null
      }
      const center = flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      return {
        left: rect.width / 2,
        top: rect.height / 2,
        flow: roundPoint({
          x: center.x - DEFAULT_CARD_SIZE.width / 2 + offset * PASTE_OFFSET,
          y: center.y - DEFAULT_CARD_SIZE.height / 2 + offset * PASTE_OFFSET,
        }),
      }
    },
    [flow],
  )

  const openCenteredAddField = useCallback(() => {
    const slot = visibleCenterSlot()
    if (slot) {
      setCardMenu(null)
      setAddField({ ...slot, centered: true })
    }
  }, [visibleCenterSlot])

  const handledRequest = useRef(addUrlRequest)
  useEffect(() => {
    if (addUrlRequest !== handledRequest.current) {
      handledRequest.current = addUrlRequest
      openCenteredAddField()
    }
  }, [addUrlRequest, openCenteredAddField])

  const submitAddField = async (url: string): Promise<void> => {
    if (!addField) {
      return
    }
    await onAddCard(url, addField.flow)
    setAddField(null)
    containerRef.current?.focus({ preventScroll: true })
  }

  const onPaste = (event: ClipboardEvent<HTMLDivElement>): void => {
    if (isEditable(event.target) || addField || enteredCardId) {
      return
    }
    const text = event.clipboardData.getData('text/plain')
    const urls = readPastedUrls(text)
    event.preventDefault()
    if (urls.length === 0) {
      notify(text.trim() ? 'Lo pegado no es una URL http(s)' : 'No hay texto que pegar', 'info')
      return
    }
    urls.forEach((url, index) => {
      const slot = visibleCenterSlot(index)
      if (slot) {
        onAddCard(url, slot.flow).catch((error: unknown) => notify(errorMessage(error)))
      }
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && (addField || cardMenu)) {
      event.preventDefault()
      setAddField(null)
      setCardMenu(null)
      return
    }
    const target = event.target
    // ⌘A / Ctrl+A selecciona todas las tarjetas.
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a' && !isEditable(target)) {
      event.preventDefault()
      setNodes(previous => previous.map(node => (node.selected ? node : { ...node, selected: true })))
      return
    }
    if (event.key === 'Enter' && target instanceof HTMLElement && target.classList.contains('react-flow__node')) {
      const cardId = target.dataset['id']
      if (cardId) {
        event.preventDefault()
        onEnter(cardId)
      }
    }
  }

  const closeCardMenu = useCallback(() => setCardMenu(null), [])

  const resizeEnd = useCallback(
    (cardId: CardId, params: ResizeParams) => {
      onUpdateCard(cardId, {
        position: roundPoint(params),
        size: { width: Math.round(params.width), height: Math.round(params.height) },
      })
    },
    [onUpdateCard],
  )

  const context = useMemo<CanvasContextValue>(
    () => ({
      mesaId: mesa.id,
      states,
      menuCardId: cardMenu?.cardId ?? null,
      enter: onEnter,
      openMenu: (cardId, anchor) => {
        setAddField(null)
        setCardMenu(current => (current?.cardId === cardId ? null : { cardId, anchor }))
      },
      resizeEnd,
    }),
    [mesa.id, states, cardMenu?.cardId, onEnter, resizeEnd],
  )

  const menuCard = cardMenu ? cardsById.get(cardMenu.cardId) : undefined
  const menuItems = useMemo((): MenuItem[] => {
    if (!menuCard) {
      return []
    }
    const status = cardStatus(states.get(menuCard.id))
    const items: MenuItem[] = [{ label: 'Entrar', icon: LogIn, onSelect: () => onEnter(menuCard.id) }]
    if (status.loaded) {
      items.push({
        label: 'Descargar',
        icon: Download,
        onSelect: () => {
          window.table.surface.unload(menuCard.id).then(
            result => {
              if (result === 'kept') {
                notify('La web avisó de cambios sin guardar; sigue en memoria', 'info')
              }
            },
            (error: unknown) => notify(errorMessage(error)),
          )
        },
      })
    }
    items.push(
      {
        label: 'Copiar URL',
        icon: Copy,
        onSelect: () => {
          copyText(menuCard.url).then(
            () => notify('URL copiada', 'info'),
            (error: unknown) => notify(errorMessage(error)),
          )
        },
      },
      { label: 'Eliminar', icon: Trash2, danger: true, onSelect: () => setConfirmRemove(menuCard) },
    )
    return items
  }, [menuCard, states, onEnter, notify])

  const removeLoaded = confirmRemove ? cardStatus(states.get(confirmRemove.id)).loaded : false

  return (
    <CanvasContext.Provider value={context}>
      <div
        ref={containerRef}
        className="canvas"
        tabIndex={0}
        aria-label={`Lienzo de ${mesa.name}`}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        onPointerDownCapture={event => {
          // El panel de React Flow no es enfocable: sin esto, pegar no llegaría al lienzo.
          const target = event.target as HTMLElement
          if (!isEditable(target) && !target.closest('button, .react-flow__node, .add-url')) {
            containerRef.current?.focus({ preventScroll: true })
          }
        }}
      >
        <ReactFlow<CardNodeType>
          nodes={nodes}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          onNodeDoubleClick={(_event, node) => onEnter(node.id)}
          onNodeContextMenu={(event, node) => {
            event.preventDefault()
            setAddField(null)
            setCardMenu({ cardId: node.id, anchor: { x: event.clientX, y: event.clientY } })
          }}
          onPaneContextMenu={event => {
            event.preventDefault()
            openAddFieldAt(event.clientX, event.clientY)
          }}
          onPaneClick={() => {
            setAddField(null)
            setCardMenu(null)
          }}
          onMoveStart={() => {
            // Están anclados a un punto de la pantalla: moverse los dejaría fuera de sitio.
            setAddField(null)
            setCardMenu(null)
          }}
          onMoveEnd={onMoveEnd}
          defaultViewport={mesa.viewport}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          panOnScroll
          zoomOnScroll={false}
          zoomOnDoubleClick={false}
          deleteKeyCode={null}
          disableKeyboardA11y
          ariaLabelConfig={ARIA_LABELS}
          // Arrastrar en vacío selecciona (como en Figma); el lienzo se mueve con
          // dos dedos, con la rueda o con Espacio + arrastrar.
          selectionOnDrag
          panOnDrag={[1]}
          selectionMode={SelectionMode.Partial}
          multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--color-canvas-dot)" />
          <Controls showInteractive={false} position="bottom-left" />
          <ViewportPortal>
            {guides.vertical !== null && (
              <div
                className="canvas-guide canvas-guide-vertical"
                style={{ transform: `translateX(${guides.vertical}px)`, width: 1 / zoom }}
                aria-hidden
              />
            )}
            {guides.horizontal !== null && (
              <div
                className="canvas-guide canvas-guide-horizontal"
                style={{ transform: `translateY(${guides.horizontal}px)`, height: 1 / zoom }}
                aria-hidden
              />
            )}
          </ViewportPortal>
        </ReactFlow>

        {selectedCount >= 2 && !enteredCardId && (
          <div className="selection-bar" role="toolbar" aria-label="Ordenar tarjetas seleccionadas">
            <span className="selection-bar-count tabular">{selectedCount} tarjetas</span>
            <button type="button" className="button button-small" onClick={() => arrangeSelection('grid')}>
              <LayoutGrid aria-hidden size={14} strokeWidth={1.75} />
              Ordenar en cuadrícula
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Alinear a la izquierda"
              title="Alinear a la izquierda"
              onClick={() => arrangeSelection('left')}
            >
              <AlignStartVertical aria-hidden size={15} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Alinear arriba"
              title="Alinear arriba"
              onClick={() => arrangeSelection('top')}
            >
              <AlignStartHorizontal aria-hidden size={15} strokeWidth={1.75} />
            </button>
          </div>
        )}

        {mesa.cards.length === 0 && !addField && (
          <div className="canvas-empty">
            <p className="canvas-empty-title">Mesa vacía</p>
            <p className="canvas-empty-text">
              Clic derecho en el lienzo para añadir una URL, o pégala con <kbd>{PASTE_KEY}</kbd>.
            </p>
            <button type="button" className="button button-primary" onClick={openCenteredAddField}>
              <Plus aria-hidden size={15} strokeWidth={1.75} />
              Añadir URL
            </button>
          </div>
        )}

        {addField && (
          <AddUrlField
            left={addField.left}
            top={addField.top}
            centered={addField.centered}
            onSubmit={submitAddField}
            onCancel={() => setAddField(null)}
          />
        )}
      </div>

      {cardMenu && menuCard && (
        <Menu
          anchor={cardMenu.anchor}
          align="end"
          label={`Acciones de ${menuCard.title ?? displayHost(menuCard.url)}`}
          items={menuItems}
          onClose={closeCardMenu}
        />
      )}

      {confirmRemove && (
        <ConfirmDialog
          title="Eliminar tarjeta"
          confirmLabel="Eliminar"
          description={
            <>
              <p>
                Se borrará «{confirmRemove.title ?? displayHost(confirmRemove.url)}» de esta mesa con su captura. La
                web original no cambia.
              </p>
              {removeLoaded && (
                <p className="dialog-note">
                  La web está cargada. Si avisa de cambios sin guardar, podrás quedarte en ella y la tarjeta se
                  conservará.
                </p>
              )}
            </>
          }
          onConfirm={async () => {
            const result = await onRemoveCard(confirmRemove.id)
            if (result === 'kept') {
              notify('La web avisó de cambios sin guardar; la tarjeta se conserva', 'info')
            }
          }}
          onClose={() => setConfirmRemove(null)}
        />
      )}
    </CanvasContext.Provider>
  )
}

/** Lienzo de una mesa: React Flow con tarjetas web (P-002). Montar con `key={mesa.id}`. */
export function MesaCanvas(props: MesaCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  )
}
