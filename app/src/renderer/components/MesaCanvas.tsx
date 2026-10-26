import {
  applyEdgeChanges,
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
  type Connection,
  type EdgeChange,
  type EdgeTypes,
  type NodeChange,
  type NodePositionChange,
  type NodeProps,
  type NodeTypes,
  type OnNodeDrag,
  type ResizeParams,
  type Viewport,
} from '@xyflow/react'
import {
  AlignStartHorizontal,
  AlignStartVertical,
  Copy,
  Download,
  LayoutGrid,
  Link,
  LogIn,
  PencilLine,
  Plus,
  StickyNote,
  Trash2,
} from 'lucide-react'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react'
import {
  DEFAULT_CARD_SIZE,
  DEFAULT_NOTE_SIZE,
  edgeKey,
  type Card,
  type CardId,
  type CardPatch,
  type Edge,
  type EdgeId,
  type Mesa,
  type Note,
  type NoteId,
  type NotePatch,
  type Point,
} from '../../shared/model'
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
import { ConnectionEdge, ConnectionHandles, type ConnectionEdgeType } from './Connections'
import { ConfirmDialog } from './Dialog'
import { Menu, type MenuItem } from './Menu'
import { NoteNode, type NoteNodeType } from './NoteNode'

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
  readonly onAddNote: (position: Point) => Promise<Note>
  readonly onUpdateNote: (noteId: NoteId, patch: NotePatch) => void
  readonly onRemoveNote: (noteId: NoteId) => Promise<void>
  readonly onAddEdge: (source: CardId | NoteId, target: CardId | NoteId) => Promise<Edge>
  readonly onRemoveEdge: (edgeId: EdgeId) => Promise<void>
  readonly onSaveViewport: (viewport: Viewport) => void
  readonly onEnter: (cardId: CardId) => void
  readonly notify: Notify
  /** Registra un guardado inmediato de lo pendiente (antes de cerrar); devuelve la baja. */
  readonly registerFlush: (flush: () => void) => () => void
}

type MesaNode = CardNodeType | NoteNodeType

/** Tarjeta web con asas de conexión; `CardNode` solo dibuja la tarjeta. */
const ConnectableCardNode = memo(function ConnectableCardNode(props: NodeProps<CardNodeType>) {
  return (
    <>
      <CardNode {...props} />
      <ConnectionHandles />
    </>
  )
})

/** Margen alrededor de un elemento, en px del lienzo, que también acepta soltar una conexión (sus asas sobresalen). */
const CONNECT_DROP_MARGIN = 16

const NODE_TYPES: NodeTypes = { card: ConnectableCardNode, note: NoteNode }
const EDGE_TYPES: EdgeTypes = { connection: ConnectionEdge }
const VIEWPORT_SAVE_DELAY_MS = 400
/** Retardo del guardado del texto de una nota mientras se escribe. */
const NOTE_TEXT_SAVE_DELAY_MS = 500
const PASTE_OFFSET = 24
const MIN_ZOOM = 0.1
const MAX_ZOOM = 4
const PASTE_KEY = window.table.platform === 'darwin' ? '⌘V' : 'Ctrl+V'
const ARIA_LABELS = {
  'controls.ariaLabel': 'Controles del lienzo',
  'controls.zoomIn.ariaLabel': 'Acercar',
  'controls.zoomOut.ariaLabel': 'Alejar',
  'controls.fitView.ariaLabel': 'Ver todo',
  'node.a11yDescription.default': 'Enter para entrar en la web o editar la nota.',
  'node.a11yDescription.keyboardDisabled': 'Enter para entrar en la web o editar la nota.',
  'edge.a11yDescription.default': 'Conexión. ⌫ para borrarla.',
}

function cardNode(card: Card): CardNodeType {
  return {
    id: card.id,
    type: 'card',
    position: card.position,
    width: card.size.width,
    height: card.size.height,
    data: { card },
  }
}

function noteNode(note: Note): NoteNodeType {
  return {
    id: note.id,
    type: 'note',
    position: note.position,
    width: note.size.width,
    height: note.size.height,
    data: { note },
  }
}

function initialNodes(mesa: Mesa): MesaNode[] {
  return [...mesa.cards.map(cardNode), ...mesa.notes.map(noteNode)]
}

/** Mantiene la geometría local (el usuario puede estar arrastrando) y toma el resto del disco. */
function mergeNodes(previous: readonly MesaNode[], cards: readonly Card[], notes: readonly Note[]): MesaNode[] {
  const byId = new Map(previous.map(node => [node.id, node]))
  const mergedCards = cards.map((card): MesaNode => {
    const existing = byId.get(card.id)
    if (existing?.type !== 'card') {
      return cardNode(card)
    }
    return existing.data.card === card ? existing : { ...existing, data: { card } }
  })
  const mergedNotes = notes.map((note): MesaNode => {
    const existing = byId.get(note.id)
    if (existing?.type !== 'note') {
      return noteNode(note)
    }
    return existing.data.note === note ? existing : { ...existing, data: { note } }
  })
  return [...mergedCards, ...mergedNotes]
}

function connectionEdge(edge: Edge, selected = false): ConnectionEdgeType {
  return { id: edge.id, type: 'connection', source: edge.source, target: edge.target, selected, ariaLabel: 'Conexión' }
}

const roundPoint = (point: Point): Point => ({ x: Math.round(point.x), y: Math.round(point.y) })

/** Distancia en píxeles de pantalla a la que el imán atrae un elemento. */
const MAGNET_SCREEN_PX = 8

function rectOf(node: MesaNode): Rect {
  const fallback = node.type === 'note' ? DEFAULT_NOTE_SIZE : DEFAULT_CARD_SIZE
  return {
    id: node.id,
    x: node.position.x,
    y: node.position.y,
    width: node.measured?.width ?? node.width ?? fallback.width,
    height: node.measured?.height ?? node.height ?? fallback.height,
  }
}

function isDragPosition(change: NodeChange<MesaNode>): change is NodePositionChange & { position: Point } {
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

/** Menú de un elemento (tarjeta o nota), anclado en coordenadas de la ventana. */
interface ItemMenuState {
  readonly id: CardId | NoteId
  readonly anchor: Point
}

type RemovalState = { readonly kind: 'card'; readonly card: Card } | { readonly kind: 'note'; readonly note: Note }

function CanvasInner({
  mesa,
  states,
  enteredCardId,
  addUrlRequest,
  onAddCard,
  onUpdateCard,
  onRemoveCard,
  onAddNote,
  onUpdateNote,
  onRemoveNote,
  onAddEdge,
  onRemoveEdge,
  onSaveViewport,
  onEnter,
  notify,
  registerFlush,
}: MesaCanvasProps) {
  const flow = useReactFlow<MesaNode, ConnectionEdgeType>()
  const containerRef = useRef<HTMLDivElement>(null)
  const [nodes, setNodes] = useState<MesaNode[]>(() => initialNodes(mesa))
  const [edges, setEdges] = useState<ConnectionEdgeType[]>(() => mesa.edges.map(edge => connectionEdge(edge)))
  const [addField, setAddField] = useState<AddFieldState | null>(null)
  /** Menú contextual del lienzo vacío («Añadir URL», «Añadir nota»), en coordenadas de la ventana. */
  const [paneMenu, setPaneMenu] = useState<Point | null>(null)
  const [itemMenu, setItemMenu] = useState<ItemMenuState | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<RemovalState | null>(null)
  const [editingNoteId, setEditingNoteId] = useState<NoteId | null>(null)
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
    setNodes(previous => mergeNodes(previous, mesa.cards, mesa.notes))
  }, [mesa.cards, mesa.notes])

  // Las conexiones vienen del disco; solo la selección es local.
  useEffect(() => {
    setEdges(previous => {
      const selected = new Set(previous.filter(edge => edge.selected).map(edge => edge.id))
      return mesa.edges.map(edge => connectionEdge(edge, selected.has(edge.id)))
    })
  }, [mesa.edges])

  const closeOverlays = useCallback(() => {
    setAddField(null)
    setPaneMenu(null)
    setItemMenu(null)
  }, [])

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

  // Texto de las notas guardado con retardo mientras se escribe; igual que la vista,
  // lo pendiente se guarda al terminar de editar, al salir de la mesa o al cerrar Table.
  const pendingTexts = useRef(new Map<NoteId, string>())
  const textTimer = useRef<number | undefined>(undefined)
  const updateNoteRef = useRef(onUpdateNote)
  useEffect(() => {
    updateNoteRef.current = onUpdateNote
  })
  const flushNoteTexts = useCallback(() => {
    window.clearTimeout(textTimer.current)
    const pending = [...pendingTexts.current]
    pendingTexts.current.clear()
    for (const [noteId, text] of pending) {
      updateNoteRef.current(noteId, { text })
    }
  }, [])
  const changeNoteText = useCallback(
    (noteId: NoteId, text: string) => {
      pendingTexts.current.set(noteId, text)
      window.clearTimeout(textTimer.current)
      textTimer.current = window.setTimeout(flushNoteTexts, NOTE_TEXT_SAVE_DELAY_MS)
    },
    [flushNoteTexts],
  )
  const stopEditingNote = useCallback(
    (noteId: NoteId) => {
      flushNoteTexts()
      setEditingNoteId(current => (current === noteId ? null : current))
    },
    [flushNoteTexts],
  )

  const flushPending = useCallback(() => {
    flushViewport()
    flushNoteTexts()
  }, [flushViewport, flushNoteTexts])
  useEffect(() => flushPending, [flushPending])
  useEffect(() => registerFlush(flushPending), [registerFlush, flushPending])

  // Opción B: con una web en el panel no queda nada del lienzo abierto debajo.
  // Al salir, el foco vuelve a la tarjeta de la que se salió.
  const lastEntered = useRef<CardId | null>(null)
  useEffect(() => {
    if (enteredCardId) {
      lastEntered.current = enteredCardId
      closeOverlays()
      setConfirmRemove(null)
      flushNoteTexts()
      setEditingNoteId(null)
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
  }, [enteredCardId, closeOverlays, flushNoteTexts])

  const onMoveEnd = useCallback(
    (_event: unknown, viewport: Viewport) => {
      pendingViewport.current = viewport
      window.clearTimeout(viewportTimer.current)
      viewportTimer.current = window.setTimeout(flushViewport, VIEWPORT_SAVE_DELAY_MS)
    },
    [flushViewport],
  )

  /**
   * Imán al arrastrar: un elemento solo se alinea con bordes o centros de los
   * demás y, si no hay ninguno cerca, con la rejilla; un grupo se mueve a la
   * rejilla conservando las distancias entre sus elementos.
   */
  const onNodesChange = useCallback(
    (changes: NodeChange<MesaNode>[]) => {
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

  const onEdgesChange = useCallback((changes: EdgeChange<ConnectionEdgeType>[]) => {
    setEdges(previous => applyEdgeChanges(changes, previous))
  }, [])

  const cardsById = useMemo(() => new Map(mesa.cards.map(card => [card.id, card])), [mesa.cards])
  const notesById = useMemo(() => new Map(mesa.notes.map(note => [note.id, note])), [mesa.notes])

  /** Guarda las posiciones que cambiaron respecto a lo guardado. */
  const savePositions = useCallback(
    (positions: Iterable<readonly [CardId | NoteId, Point]>) => {
      for (const [id, raw] of positions) {
        const position = roundPoint(raw)
        const card = cardsById.get(id)
        const saved = (card ?? notesById.get(id))?.position
        if (saved && saved.x === position.x && saved.y === position.y) {
          continue
        }
        if (card) {
          onUpdateCard(id, { position })
        } else if (notesById.has(id)) {
          onUpdateNote(id, { position })
        }
      }
    },
    [cardsById, notesById, onUpdateCard, onUpdateNote],
  )

  const onNodeDragStop = useCallback<OnNodeDrag<MesaNode>>(
    (_event, _node, dragged) => {
      setGuides(NO_GUIDES)
      savePositions(dragged.map(node => [node.id, node.position] as const))
    },
    [savePositions],
  )

  const selectedCount = nodes.filter(node => node.selected).length

  /** Ordena o alinea los elementos seleccionados y guarda sus posiciones. */
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
      setItemMenu(null)
      setAddField({
        left: clientX - rect.left,
        top: clientY - rect.top,
        centered: false,
        flow: roundPoint(flow.screenToFlowPosition({ x: clientX, y: clientY })),
      })
    },
    [flow],
  )

  /** Crea una nota con su esquina en el punto de la ventana y empieza a editarla. */
  const addNoteAt = useCallback(
    (clientX: number, clientY: number) => {
      const position = roundPoint(flow.screenToFlowPosition({ x: clientX, y: clientY }))
      onAddNote(position).then(
        note => setEditingNoteId(note.id),
        (error: unknown) => notify(errorMessage(error)),
      )
    },
    [flow, onAddNote, notify],
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
      setItemMenu(null)
      setPaneMenu(null)
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

  // Conexiones: sin autoconexiones ni duplicados en cualquier sentido (el almacén lo vuelve a comprobar).
  const edgeKeys = useMemo(() => new Set(mesa.edges.map(edge => edgeKey(edge.source, edge.target))), [mesa.edges])
  const isValidConnection = useCallback(
    (connection: ConnectionEdgeType | Connection) =>
      connection.source !== connection.target && !edgeKeys.has(edgeKey(connection.source, connection.target)),
    [edgeKeys],
  )
  const onConnect = useCallback(
    (connection: Connection) => {
      if (isValidConnection(connection)) {
        onAddEdge(connection.source, connection.target).catch((error: unknown) => notify(errorMessage(error)))
      }
    },
    [isValidConnection, onAddEdge, notify],
  )

  /*
   * Soltar una conexión en cualquier punto de otro elemento, incluidas sus asas y
   * un pequeño margen alrededor. React Flow solo la acepta si el puntero cae
   * justo sobre una zona de destino; esto cubre el resto y marca el destino.
   */
  const connectFrom = useRef<string | null>(null)
  const connectTarget = useRef<string | null>(null)
  const targetAt = useCallback(
    (clientX: number, clientY: number, fromId: string): string | null => {
      const point = flow.screenToFlowPosition({ x: clientX, y: clientY })
      let best: { id: string; area: number } | null = null
      for (const node of flow.getNodes()) {
        const width = node.measured?.width ?? node.width ?? 0
        const height = node.measured?.height ?? node.height ?? 0
        const { x, y } = node.position
        const inside =
          point.x >= x - CONNECT_DROP_MARGIN &&
          point.x <= x + width + CONNECT_DROP_MARGIN &&
          point.y >= y - CONNECT_DROP_MARGIN &&
          point.y <= y + height + CONNECT_DROP_MARGIN
        // Si hay solapes, gana el elemento más pequeño: el que se ve encima del otro casi siempre.
        if (node.id !== fromId && inside && (!best || width * height < best.area)) {
          best = { id: node.id, area: width * height }
        }
      }
      return best && isValidConnection({ source: fromId, target: best.id, sourceHandle: null, targetHandle: null }) ? best.id : null
    },
    [flow, isValidConnection],
  )
  const markConnectTarget = useCallback((id: string | null) => {
    if (connectTarget.current === id) {
      return
    }
    const previous = connectTarget.current
    connectTarget.current = id
    setNodes(current =>
      current.map(node =>
        node.id === id
          ? { ...node, className: 'connection-target' }
          : node.id === previous
            ? { ...node, className: undefined }
            : node,
      ),
    )
  }, [])
  const trackConnectTarget = useCallback(
    (event: PointerEvent) => {
      const from = connectFrom.current
      markConnectTarget(from ? targetAt(event.clientX, event.clientY, from) : null)
    },
    [targetAt, markConnectTarget],
  )
  const onConnectStart = useCallback(
    (_event: unknown, params: { nodeId: string | null }) => {
      connectFrom.current = params.nodeId
      window.addEventListener('pointermove', trackConnectTarget)
    },
    [trackConnectTarget],
  )
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: { isValid: boolean | null }) => {
      window.removeEventListener('pointermove', trackConnectTarget)
      const from = connectFrom.current
      connectFrom.current = null
      markConnectTarget(null)
      // Si React Flow ya la aceptó, `onConnect` la ha creado.
      if (state.isValid || !from) {
        return
      }
      const point = 'changedTouches' in event ? event.changedTouches[0] : event
      const target = point ? targetAt(point.clientX, point.clientY, from) : null
      if (target) {
        onConnect({ source: from, target, sourceHandle: null, targetHandle: null })
      }
    },
    [trackConnectTarget, markConnectTarget, targetAt, onConnect],
  )

  const removeNote = useCallback(
    (noteId: NoteId) => {
      pendingTexts.current.delete(noteId)
      setEditingNoteId(current => (current === noteId ? null : current))
      onRemoveNote(noteId).catch((error: unknown) => notify(errorMessage(error)))
    },
    [onRemoveNote, notify],
  )

  /** Una nota vacía se borra sin preguntar; con texto, se confirma. */
  const requestRemoveNote = useCallback(
    (note: Note) => {
      const text = pendingTexts.current.get(note.id) ?? note.text
      if (text.trim().length === 0) {
        removeNote(note.id)
      } else {
        setConfirmRemove({ kind: 'note', note })
      }
    },
    [removeNote],
  )

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && (addField || itemMenu || paneMenu)) {
      event.preventDefault()
      closeOverlays()
      return
    }
    const target = event.target
    if (isEditable(target)) {
      return
    }
    // ⌘A / Ctrl+A selecciona todos los elementos.
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      setNodes(previous => previous.map(node => (node.selected ? node : { ...node, selected: true })))
      return
    }
    // ⌫ borra las conexiones seleccionadas (sin elementos seleccionados: borrar
    // elementos tiene su propia acción).
    if (event.key === 'Backspace' || event.key === 'Delete') {
      const selectedEdges = edges.filter(edge => edge.selected)
      if (selectedEdges.length > 0 && !nodes.some(node => node.selected)) {
        event.preventDefault()
        for (const edge of selectedEdges) {
          onRemoveEdge(edge.id).catch((error: unknown) => notify(errorMessage(error)))
        }
      }
      return
    }
    if (event.key === 'Enter' && target instanceof HTMLElement && target.classList.contains('react-flow__node')) {
      const id = target.dataset['id']
      if (id && notesById.has(id)) {
        event.preventDefault()
        setEditingNoteId(id)
      } else if (id) {
        event.preventDefault()
        onEnter(id)
      }
    }
  }

  const closeMenus = useCallback(() => {
    setItemMenu(null)
    setPaneMenu(null)
  }, [])

  const resizeEnd = useCallback(
    (id: CardId | NoteId, params: ResizeParams) => {
      const patch = {
        position: roundPoint(params),
        size: { width: Math.round(params.width), height: Math.round(params.height) },
      }
      if (flow.getNode(id)?.type === 'note') {
        onUpdateNote(id, patch)
      } else {
        onUpdateCard(id, patch)
      }
    },
    [flow, onUpdateCard, onUpdateNote],
  )

  const menuCard = itemMenu ? cardsById.get(itemMenu.id) : undefined
  const menuNote = itemMenu ? notesById.get(itemMenu.id) : undefined

  const context = useMemo<CanvasContextValue>(
    () => ({
      mesaId: mesa.id,
      states,
      menuCardId: menuCard?.id ?? null,
      editingNoteId,
      enter: onEnter,
      openMenu: (cardId, anchor) => {
        setAddField(null)
        setPaneMenu(null)
        setItemMenu(current => (current?.id === cardId ? null : { id: cardId, anchor }))
      },
      resizeEnd,
      changeNoteText,
      stopEditingNote,
    }),
    [mesa.id, states, menuCard?.id, editingNoteId, onEnter, resizeEnd, changeNoteText, stopEditingNote],
  )

  const menuItems = useMemo((): MenuItem[] => {
    if (menuNote) {
      return [
        { label: 'Editar texto', icon: PencilLine, onSelect: () => setEditingNoteId(menuNote.id) },
        { label: 'Eliminar', icon: Trash2, danger: true, onSelect: () => requestRemoveNote(menuNote) },
      ]
    }
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
      { label: 'Eliminar', icon: Trash2, danger: true, onSelect: () => setConfirmRemove({ kind: 'card', card: menuCard }) },
    )
    return items
  }, [menuCard, menuNote, states, onEnter, notify, requestRemoveNote])

  const paneMenuItems = useMemo((): MenuItem[] => {
    if (!paneMenu) {
      return []
    }
    return [
      { label: 'Añadir URL', icon: Link, onSelect: () => openAddFieldAt(paneMenu.x, paneMenu.y) },
      { label: 'Añadir nota', icon: StickyNote, onSelect: () => addNoteAt(paneMenu.x, paneMenu.y) },
    ]
  }, [paneMenu, openAddFieldAt, addNoteAt])

  const removedId = confirmRemove?.kind === 'card' ? confirmRemove.card.id : confirmRemove?.note.id
  const removedEdgeCount = removedId
    ? mesa.edges.filter(edge => edge.source === removedId || edge.target === removedId).length
    : 0
  const edgesNotice =
    removedEdgeCount === 0
      ? null
      : removedEdgeCount === 1
        ? 'También se borrará su conexión.'
        : `También se borrarán sus ${removedEdgeCount} conexiones.`
  const removeLoaded = confirmRemove?.kind === 'card' ? cardStatus(states.get(confirmRemove.card.id)).loaded : false
  const isEmpty = mesa.cards.length === 0 && mesa.notes.length === 0

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
        <ReactFlow<MesaNode, ConnectionEdgeType>
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          isValidConnection={isValidConnection}
          onNodeDragStop={onNodeDragStop}
          onNodeDoubleClick={(_event, node) => {
            if (node.type === 'note') {
              setEditingNoteId(node.id)
            } else {
              onEnter(node.id)
            }
          }}
          onNodeContextMenu={(event, node) => {
            event.preventDefault()
            setAddField(null)
            setPaneMenu(null)
            setItemMenu({ id: node.id, anchor: { x: event.clientX, y: event.clientY } })
          }}
          onPaneContextMenu={event => {
            event.preventDefault()
            setAddField(null)
            setItemMenu(null)
            setPaneMenu({ x: event.clientX, y: event.clientY })
          }}
          onPaneClick={closeOverlays}
          onMoveStart={() => {
            // Están anclados a un punto de la pantalla: moverse los dejaría fuera de sitio.
            closeOverlays()
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
          <div className="selection-bar" role="toolbar" aria-label="Ordenar la selección">
            <span className="selection-bar-count tabular">{selectedCount} seleccionados</span>
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

        {isEmpty && !addField && !paneMenu && (
          <div className="canvas-empty">
            <p className="canvas-empty-title">Mesa vacía</p>
            <p className="canvas-empty-text">
              Clic derecho en el lienzo para añadir una URL o una nota, o pega una URL con <kbd>{PASTE_KEY}</kbd>.
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

      {paneMenu && (
        <Menu anchor={paneMenu} label="Añadir al lienzo" items={paneMenuItems} onClose={closeMenus} />
      )}

      {itemMenu && (menuCard || menuNote) && (
        <Menu
          anchor={itemMenu.anchor}
          align="end"
          label={menuCard ? `Acciones de ${menuCard.title ?? displayHost(menuCard.url)}` : 'Acciones de la nota'}
          items={menuItems}
          onClose={closeMenus}
        />
      )}

      {confirmRemove?.kind === 'card' && (
        <ConfirmDialog
          title="Eliminar tarjeta"
          confirmLabel="Eliminar"
          description={
            <>
              <p>
                Se borrará «{confirmRemove.card.title ?? displayHost(confirmRemove.card.url)}» de esta mesa con su
                captura. La web original no cambia.{edgesNotice && ` ${edgesNotice}`}
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
            const result = await onRemoveCard(confirmRemove.card.id)
            if (result === 'kept') {
              notify('La web avisó de cambios sin guardar; la tarjeta se conserva', 'info')
            }
          }}
          onClose={() => setConfirmRemove(null)}
        />
      )}

      {confirmRemove?.kind === 'note' && (
        <ConfirmDialog
          title="Eliminar nota"
          confirmLabel="Eliminar"
          description={<p>Se borrará la nota con su texto.{edgesNotice && ` ${edgesNotice}`}</p>}
          onConfirm={async () => {
            pendingTexts.current.delete(confirmRemove.note.id)
            setEditingNoteId(current => (current === confirmRemove.note.id ? null : current))
            await onRemoveNote(confirmRemove.note.id)
          }}
          onClose={() => setConfirmRemove(null)}
        />
      )}
    </CanvasContext.Provider>
  )
}

/** Lienzo de una mesa: React Flow con tarjetas web, notas y conexiones. Montar con `key={mesa.id}`. */
export function MesaCanvas(props: MesaCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  )
}
