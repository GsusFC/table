import { app, webContents, type BrowserWindow, type WebContents } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { Card, Mesa, Point, Size } from '../shared/model'
import type { SurfaceManager } from './web/types'

/**
 * Recorrido de T-002 y T-004 sobre la app real, con datos en una carpeta
 * temporal y páginas sintéticas locales. Usa la interfaz (clics, menú
 * contextual, campo «Añadir URL», notas y conexiones arrastradas) cuando el
 * criterio de aceptación es de interfaz, y la API del
 * preload para preparar datos. Si `TABLE_SMOKE_SHOTS` apunta a una carpeta,
 * guarda capturas de la interfaz local en cada paso.
 */

const FIXTURE_HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Página sintética</title>
<style>body{font:16px system-ui;margin:0;padding:32px;background:#fdf6e3}main{height:3000px}</style></head>
<body><main><h1>Página sintética de prueba</h1><p>Contenido local para T-002.</p></main></body></html>`

/** Página sintética que declara trabajo pendiente con `beforeunload`. */
const GUARDED_HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Con cambios</title></head>
<body><input autofocus><script>addEventListener('beforeunload', e => { e.preventDefault(); e.returnValue = '' })</script></body></html>`

const TOTAL_TIMEOUT_MS = 120_000

/** Decisión ante `beforeunload` que el smoke controla; la app la usa solo con TABLE_SMOKE=1. */
export const smokeHooks = {
  confirmDiscard: (_origin: string, _reason: 'quit' | 'unload'): boolean => false,
  /** Si algo no se pudo guardar al cerrar; el smoke cierra igualmente. */
  confirmCloseWithUnsaved: (): boolean => true,
  /** Servidor local con fichas sintéticas que sustituye a la API de Notion. */
  notionApiBase: undefined as string | undefined,
}

/** Chromium solo respeta `beforeunload` si la página recibió interacción del usuario. */
function activate(contents: WebContents): void {
  contents.sendInputEvent({ type: 'mouseDown', x: 10, y: 10, button: 'left', clickCount: 1 })
  contents.sendInputEvent({ type: 'mouseUp', x: 10, y: 10, button: 'left', clickCount: 1 })
  contents.sendInputEvent({ type: 'keyDown', keyCode: 'a' })
  contents.sendInputEvent({ type: 'char', keyCode: 'a' })
  contents.sendInputEvent({ type: 'keyUp', keyCode: 'a' })
}

function findContents(url: string): WebContents | undefined {
  return webContents.getAllWebContents().find(contents => !contents.isDestroyed() && contents.getURL() === url)
}

interface Check {
  readonly name: string
  readonly ok: boolean
  readonly detail?: unknown
}

async function waitFor<T>(probe: () => Promise<T> | T, accept: (value: T) => boolean, label: string, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await probe()
    if (accept(value)) {
      return value
    }
    if (Date.now() > deadline) {
      throw new Error(`Tiempo agotado: ${label}`)
    }
    await delay(100)
  }
}

async function startFixtureServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(request.url === '/guarded' ? GUARDED_HTML : FIXTURE_HTML)
  })
  const { promise, resolve } = Promise.withResolvers<void>()
  server.listen(0, '127.0.0.1', resolve)
  await promise
  const { port } = server.address() as AddressInfo
  return { server, url: `http://127.0.0.1:${port}/` }
}

const NOTION_TOKEN = `ntn_${'s'.repeat(40)}`
const NOTION_DATABASE = '11111111222243338444555555555555'
const NOTION_PROJECT = 'aaaaaaaabbbb4ccc8dddeeeeeeeeeeee'
const NOTION_OTHER = 'ffffffffbbbb4ccc8dddeeeeeeeeeeee'

/** API de Notion falsa: una base, una ficha con campos excluidos rellenos y una página suelta. */
async function startNotionServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    const reply = (status: number, body: unknown): void => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    }
    if (request.headers.authorization !== `Bearer ${NOTION_TOKEN}`) {
      reply(401, { object: 'error' })
    } else if (request.method === 'POST' && request.url === '/v1/search') {
      reply(200, { results: [{ object: 'database', id: NOTION_DATABASE, title: [{ plain_text: 'Proyectos de prueba' }] }], has_more: false })
    } else if (request.url === `/v1/pages/${NOTION_PROJECT}`) {
      reply(200, {
        object: 'page',
        id: NOTION_PROJECT,
        last_edited_time: '2026-10-25T09:30:00.000Z',
        parent: { type: 'database_id', database_id: NOTION_DATABASE },
        properties: {
          Title: { type: 'title', title: [{ plain_text: 'Proyecto sintético' }] },
          Status: { type: 'status', status: { name: 'In progress', color: 'orange' } },
          Services: { type: 'multi_select', multi_select: [{ name: 'Branding', color: 'blue' }] },
          'Start Date': { type: 'date', date: { start: '2026-10-01', end: null } },
          'Due Date': { type: 'date', date: null },
          'Remaining days': { type: 'formula', formula: { type: 'number', number: 34 } },
          Budget: { type: 'rich_text', rich_text: [{ plain_text: 'SECRETO-PRESUPUESTO' }] },
          Leaders: { type: 'people', people: [{ id: 'SECRETO-PERSONA' }] },
        },
      })
    } else if (request.url === `/v1/pages/${NOTION_OTHER}`) {
      reply(200, { object: 'page', id: NOTION_OTHER, parent: { type: 'page_id', page_id: NOTION_PROJECT }, properties: {} })
    } else {
      reply(404, { object: 'error' })
    }
  })
  const { promise, resolve } = Promise.withResolvers<void>()
  server.listen(0, '127.0.0.1', resolve)
  await promise
  const { port } = server.address() as AddressInfo
  return { server, url: `http://127.0.0.1:${port}` }
}

export async function runSmoke(window: BrowserWindow, surface: SurfaceManager): Promise<void> {
  const checks: Check[] = []
  const record = (name: string, ok: boolean, detail?: unknown): void => {
    checks.push({ name, ok, detail })
    console.log(`[table-smoke] ${ok ? 'OK  ' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`)
  }
  const watchdog = setTimeout(() => {
    console.log('[table-smoke] FAIL tiempo total agotado')
    app.exit(2)
  }, TOTAL_TIMEOUT_MS)

  const ui = window.webContents
  const inUi = <T>(code: string): Promise<T> => ui.executeJavaScript(code, true) as Promise<T>
  const shotsDir = process.env['TABLE_SMOKE_SHOTS']
  if (shotsDir) {
    mkdirSync(shotsDir, { recursive: true })
  }
  const shot = async (name: string): Promise<void> => {
    if (!shotsDir) {
      return
    }
    await delay(300)
    const image = await ui.capturePage()
    writeFileSync(join(shotsDir, `${name}.png`), image.toPNG())
  }
  const nodeCount = (): Promise<number> => inUi(`document.querySelectorAll('.react-flow__node').length`)
  const edgeCount = (): Promise<number> => inUi(`document.querySelectorAll('.react-flow__edge').length`)
  /** Clic derecho en el lienzo vacío, en píxeles dentro del panel de React Flow. */
  const openPaneMenu = (x: number, y: number): Promise<unknown> =>
    inUi(`(() => {
      const pane = document.querySelector('.react-flow__pane')
      const r = pane.getBoundingClientRect()
      pane.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + ${x}, clientY: r.top + ${y}, button: 2 }))
    })()`)
  const clickMenuItem = async (label: string): Promise<void> => {
    await waitFor(() => inUi<boolean>(`!!document.querySelector('.menu')`), Boolean, `menú con «${label}»`)
    await inUi(`[...document.querySelectorAll('.menu [role="menuitem"]')].find(b => b.textContent.includes(${JSON.stringify(label)})).click()`)
  }
  /**
   * Clic real (eventos de entrada de Electron) en una zona vacía del lienzo
   * para quitar la selección: con `selectionOnDrag`, React Flow solo trata el
   * clic en el lienzo a partir de `pointerdown`/`pointerup` reales.
   */
  const clearSelection = async (): Promise<void> => {
    const point = await inUi<{ x: number; y: number }>(`(() => {
      const r = document.querySelector('.react-flow__pane').getBoundingClientRect()
      return { x: Math.round(r.left + r.width * 0.85), y: Math.round(r.top + r.height * 0.6) }
    })()`)
    ui.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    ui.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    await waitFor(
      () => inUi<number>(`document.querySelectorAll('.react-flow__node.selected, .react-flow__edge.selected').length`),
      count => count === 0,
      'sin selección',
    )
  }
  /**
   * Arrastra una conexión con eventos del ratón: desde el asa `side` del
   * elemento `fromId` hasta el centro del elemento `toId`.
   */
  const dragConnection = (fromId: string, side: 'left' | 'right', toId: string): Promise<unknown> =>
    inUi(`(async () => {
      const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()))
      const center = element => {
        const r = element.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      }
      const handle = document.querySelector(${JSON.stringify(`.react-flow__node[data-id="${fromId}"] .connection-handle[data-handlepos="${side}"]`)})
      const from = center(handle)
      const to = center(document.querySelector(${JSON.stringify(`.react-flow__node[data-id="${toId}"]`)}))
      handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: from.x, clientY: from.y, button: 0 }))
      for (const t of [0.3, 0.7, 1, 1]) {
        document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: from.x + (to.x - from.x) * t, clientY: from.y + (to.y - from.y) * t, buttons: 1 }))
        await frame()
      }
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: to.x, clientY: to.y, button: 0 }))
    })()`)
  const { server, url: fixtureUrl } = await startFixtureServer()

  let closingMesaId: string | null = null
  try {
    await waitFor(() => window.isVisible() && !ui.isLoading(), Boolean, 'interfaz lista')
    await waitFor(() => inUi<boolean>(`!!document.querySelector('.home')`), Boolean, 'inicio')
    record('aislamiento: la interfaz local no tiene Node', await inUi(`typeof require === 'undefined' && typeof process === 'undefined'`))
    // Chromium no pinta (ni captura) ventanas tapadas por otras en macOS.
    app.focus({ steal: true })
    window.focus()
    await shot('01-inicio-vacio')

    record(
      'ipc: rechaza una URL file:// al añadir tarjeta',
      await inUi(`window.table.mesas.create('Rechazo').then(m => window.table.cards.add(m.id, 'file:///etc/hosts', {x:0,y:0})).then(() => false, () => true)`),
    )
    const mesa = await inUi<Mesa>(`window.table.mesas.create('Mesa de prueba')`)
    const added = await inUi<Card[]>(`Promise.all([
      window.table.cards.add(${JSON.stringify(mesa.id)}, ${JSON.stringify(fixtureUrl)}, { x: 0, y: 0 }),
      window.table.cards.add(${JSON.stringify(mesa.id)}, 'https://www.figma.com/design/AbCdEf123/Prueba', { x: 380, y: 0 }),
      window.table.cards.add(${JSON.stringify(mesa.id)}, 'https://es.pinterest.com/usuario/tablero/', { x: 760, y: 0 }),
    ])`)
    record('servicios: reconoce web, Figma y Pinterest', added.map(card => card.serviceId).join(',') === 'web,figma,pinterest', added.map(card => card.serviceId))

    ui.reload()
    await waitFor(() => inUi<number>(`document.querySelectorAll('.mesa-row-open').length`), count => count === 2, 'lista de mesas')
    await shot('02-inicio')

    await inUi(`[...document.querySelectorAll('.mesa-row-open')].find(b => b.textContent.includes('Mesa de prueba')).click()`)
    await waitFor(nodeCount, count => count === 3, 'tarjetas en el lienzo')
    record('interfaz: abre la mesa con sus 3 tarjetas', true)
    await shot('03-lienzo')

    // «Añadir URL» desde el menú contextual del lienzo.
    await openPaneMenu(200, 420)
    await clickMenuItem('Añadir URL')
    await waitFor(() => inUi<boolean>(`!!document.querySelector('.add-url-input')`), Boolean, 'campo Añadir URL')
    await inUi(`(() => {
      const input = document.querySelector('.add-url-input')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'notion.so/espacio/Pagina-de-prueba-0123456789abcdef0123456789abcdef')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    await shot('04-anadir-url')
    await inUi(`document.querySelector('.add-url-input').closest('form').requestSubmit()`)
    await waitFor(nodeCount, count => count === 4, 'tarjeta añadida por menú contextual')
    const afterAdd = await inUi<Mesa>(`window.table.mesas.get(${JSON.stringify(mesa.id)})`)
    const notionCard = afterAdd.cards.find(card => card.serviceId === 'notion')
    record('interfaz: clic derecho → Añadir URL crea una tarjeta Notion con https', !!notionCard && notionCard.url.startsWith('https://'), notionCard?.url)

    // Opción B: entrar en la página sintética ocupa el panel.
    const fixtureCard = added[0]!
    await inUi(`window.table.surface.enter(${JSON.stringify(mesa.id)}, ${JSON.stringify(fixtureCard.id)})`)
    const entered = await waitFor(
      () => surface.getStates().find(state => state.cardId === fixtureCard.id),
      state => state?.status === 'ready' && state.entered,
      'web cargada y activa',
    )
    record('superficie: entra y carga la web', true, { loadMs: entered?.loadMs })
    record(
      'interfaz: muestra «Volver al lienzo» con la web abierta',
      await waitFor(() => inUi<boolean>(`document.body.innerText.includes('Volver al lienzo')`), Boolean, 'barra de web'),
    )
    await shot('05-web-abierta')

    await inUi('window.table.surface.exit()')
    // Chromium no captura si la pantalla está bloqueada o la ventana no se compone;
    // se registra el fallo y el recorrido sigue para comprobar el resto.
    const captured = await waitFor(
      () => inUi<Mesa>(`window.table.mesas.get(${JSON.stringify(mesa.id)})`),
      current => current.cards.find(card => card.id === fixtureCard.id)?.capturedAt != null,
      'captura guardada',
      5_000,
    ).catch(() => null)
    record('captura: se guarda al salir y queda en la tarjeta', captured !== null, captured ? undefined : 'sin captura: ¿pantalla bloqueada?')
    const afterExit = await inUi<Mesa>(`window.table.mesas.get(${JSON.stringify(mesa.id)})`)
    record('título: se guarda el título de la página', afterExit.cards.find(card => card.id === fixtureCard.id)?.title === 'Página sintética')
    if (captured) {
      await waitFor(
        () => inUi<boolean>(`[...document.images].some(img => img.src.startsWith('table-capture://') && img.complete && img.naturalWidth > 0)`),
        Boolean,
        'captura visible',
      )
      record('interfaz: la tarjeta muestra la captura', true)
      await shot('06-lienzo-con-captura')
    }

    record('superficie: descarga la web', (await inUi<string>(`window.table.surface.unload(${JSON.stringify(fixtureCard.id)})`)) === 'unloaded')

    // Persistencia: recargar y volver a abrir.
    ui.reload()
    await waitFor(() => inUi<number>(`document.querySelectorAll('.mesa-row-open').length`), count => count === 2, 'inicio tras recargar')
    await inUi(`[...document.querySelectorAll('.mesa-row-open')].find(b => b.textContent.includes('Mesa de prueba')).click()`)
    await waitFor(nodeCount, count => count === 4, 'tarjetas tras recargar')
    record('persistencia: la mesa conserva sus 4 tarjetas', true)
    record('memoria: al abrir la mesa no se carga ninguna web', surface.getStates().every(state => state.status === 'unloaded'))

    // Seleccionar todo (⌘A) y «Ordenar en cuadrícula».
    await inUi(`(() => {
      const canvas = document.querySelector('.canvas')
      canvas.focus()
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', metaKey: true, ctrlKey: true, bubbles: true }))
    })()`)
    await waitFor(() => inUi<boolean>(`!!document.querySelector('.selection-bar')`), Boolean, 'barra de selección')
    await shot('07-seleccion')
    await inUi(`[...document.querySelectorAll('.selection-bar button')].find(b => b.textContent.includes('Ordenar en cuadrícula')).click()`)
    const arranged = await waitFor(
      () => inUi<Mesa>(`window.table.mesas.get(${JSON.stringify(mesa.id)})`),
      current => current.cards.every(card => card.position.x % 24 === 0 && card.position.y % 24 === 0),
      'posiciones ordenadas guardadas',
    ).catch(() => null)
    const overlaps = (cards: readonly { readonly position: Point; readonly size: Size }[]): boolean =>
      cards.some((a, i) =>
        cards.some(
          (b, j) =>
            i < j &&
            a.position.x < b.position.x + b.size.width &&
            b.position.x < a.position.x + a.size.width &&
            a.position.y < b.position.y + b.size.height &&
            b.position.y < a.position.y + a.size.height,
        ),
      )
    record('ordenar: la selección queda en cuadrícula, sin solapes y guardada', arranged !== null && !overlaps(arranged.cards))
    await shot('08-ordenadas')

    // T-004: notas y conexiones. Primero se quita la selección de ⌘A.
    const getMesa = (): Promise<Mesa> => inUi<Mesa>(`window.table.mesas.get(${JSON.stringify(mesa.id)})`)
    await clearSelection()
    await openPaneMenu(900, 150)
    await clickMenuItem('Añadir nota')
    await waitFor(() => inUi<boolean>(`document.activeElement?.classList.contains('note-input') === true`), Boolean, 'nota en edición')
    const withNote = await getMesa()
    const note = withNote.notes[0]
    record('notas: clic derecho → Añadir nota crea una nota vacía y la abre para escribir', withNote.notes.length === 1 && note?.text === '')
    if (!note) {
      throw new Error('No se creó la nota')
    }
    const noteSelector = JSON.stringify(`.react-flow__node[data-id="${note.id}"]`)
    const noteText = 'Nota sintética\nsegunda línea'
    await inUi(`(() => {
      const input = document.activeElement
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(noteText)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', metaKey: true, ctrlKey: true, bubbles: true, cancelable: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }))
    })()`)
    record(
      'teclado: ⌘A y ⌫ en el texto de una nota no seleccionan ni borran elementos',
      await inUi<boolean>(
        `document.querySelectorAll('.react-flow__node.selected').length === 0 && document.querySelectorAll('.react-flow__node').length === 5 && document.activeElement?.classList.contains('note-input') === true`,
      ),
    )
    await shot('09-nota-en-edicion')
    await inUi(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`)
    const savedNote = await waitFor(getMesa, current => current.notes[0]?.text === noteText, 'texto de la nota guardado').catch(() => null)
    record('notas: Esc termina la edición y el texto queda guardado', savedNote !== null && (await inUi<boolean>(`!document.querySelector('.note-input')`)))

    // Conectar arrastrando desde el asa izquierda de la nota hasta la tarjeta sintética.
    await dragConnection(note.id, 'left', fixtureCard.id)
    const connected = await waitFor(getMesa, current => current.edges.length === 1, 'conexión guardada').catch(() => null)
    const edge = connected?.edges[0]
    record(
      'conexiones: arrastrar desde una nota hasta una tarjeta las conecta',
      !!edge && edge.source === note.id && edge.target === fixtureCard.id && (await waitFor(edgeCount, count => count === 1, 'línea de la conexión').then(() => true, () => false)),
      edge,
    )
    record(
      'conexiones: no se repite en sentido contrario ni se conecta un elemento consigo',
      await inUi<boolean>(`Promise.all([
        window.table.edges.add(${JSON.stringify(mesa.id)}, ${JSON.stringify(fixtureCard.id)}, ${JSON.stringify(note.id)}).then(() => false, () => true),
        window.table.edges.add(${JSON.stringify(mesa.id)}, ${JSON.stringify(note.id)}, ${JSON.stringify(note.id)}).then(() => false, () => true),
      ]).then(results => results.every(Boolean))`),
    )
    await shot('10-conexion')

    // ⌘A incluye la nota: «Alinear arriba» la mueve con las tarjetas.
    await inUi(`(() => {
      const canvas = document.querySelector('.canvas')
      canvas.focus()
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', metaKey: true, ctrlKey: true, bubbles: true }))
    })()`)
    await waitFor(() => inUi<boolean>(`!!document.querySelector('.selection-bar')`), Boolean, 'barra de selección con la nota')
    await inUi(`document.querySelector('.selection-bar [aria-label="Alinear arriba"]').click()`)
    const aligned = await waitFor(
      getMesa,
      current => [...current.cards, ...current.notes].every(item => item.position.y === 0),
      'alineados arriba',
    ).catch(() => null)
    record(
      'selección: ⌘A y «Alinear arriba» incluyen la nota',
      aligned !== null,
      aligned ? undefined : (await getMesa()).notes.concat().map(item => item.position).concat((await getMesa()).cards.map(item => item.position)),
    )

    // «Ordenar en cuadrícula» con la misma selección también coloca la nota.
    await inUi(`[...document.querySelectorAll('.selection-bar button')].find(b => b.textContent.includes('Ordenar en cuadrícula')).click()`)
    const regridded = await waitFor(
      getMesa,
      current => !overlaps([...current.cards, ...current.notes]),
      'tarjetas y nota ordenadas sin solapes',
    ).catch(() => null)
    record('ordenar: la cuadrícula incluye la nota, sin solapes', regridded !== null)

    // Conexión tarjeta↔tarjeta arrastrada; clic en la línea y ⌫ la borra sin tocar las tarjetas.
    await clearSelection()
    const figmaCard = added[1]!
    await dragConnection(fixtureCard.id, 'right', figmaCard.id)
    const twoEdges = await waitFor(getMesa, current => current.edges.length === 2, 'conexión entre tarjetas').catch(() => null)
    const cardEdge = twoEdges?.edges.find(item => item.source === fixtureCard.id && item.target === figmaCard.id)
    record('conexiones: arrastrar entre dos tarjetas las conecta', !!cardEdge)
    if (cardEdge) {
      await waitFor(edgeCount, count => count === 2, 'dos líneas')
      await inUi(`document.querySelector(${JSON.stringify(`.react-flow__edge[data-id="${cardEdge.id}"]`)}).dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
      await waitFor(() => inUi<number>(`document.querySelectorAll('.react-flow__edge.selected').length`), count => count === 1, 'línea seleccionada')
      await shot('11-conexion-seleccionada')
      await inUi(`(() => {
        const canvas = document.querySelector('.canvas')
        canvas.focus()
        canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }))
      })()`)
      const afterEdgeRemoval = await waitFor(getMesa, current => current.edges.length === 1, 'conexión borrada con ⌫').catch(() => null)
      record(
        'conexiones: seleccionar una línea y ⌫ la borra sin tocar los elementos',
        afterEdgeRemoval !== null && afterEdgeRemoval.cards.length === 4 && afterEdgeRemoval.notes.length === 1 && afterEdgeRemoval.edges[0]?.source === note.id,
      )
    }

    // Persistencia: recargar la interfaz y leer la mesa del disco.
    ui.reload()
    await waitFor(() => inUi<number>(`document.querySelectorAll('.mesa-row-open').length`), count => count === 2, 'inicio tras recargar')
    await inUi(`[...document.querySelectorAll('.mesa-row-open')].find(b => b.textContent.includes('Mesa de prueba')).click()`)
    await waitFor(nodeCount, count => count === 5, 'tarjetas y nota tras recargar')
    const shownText = await inUi<string>(`document.querySelector(${noteSelector} + ' .note-text')?.innerText ?? ''`)
    const reloaded = await getMesa()
    record(
      'persistencia: la nota conserva su texto y su conexión tras recargar',
      shownText === noteText &&
        reloaded.notes[0]?.text === noteText &&
        reloaded.edges.length === 1 &&
        (await waitFor(edgeCount, count => count === 1, 'conexión tras recargar').then(() => true, () => false)),
      { shownText },
    )

    // Borrar la nota desde su menú: se confirma (tiene texto) y se va con su conexión.
    await inUi(`(() => {
      const node = document.querySelector(${noteSelector})
      const r = node.getBoundingClientRect()
      node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 20, button: 2 }))
    })()`)
    await clickMenuItem('Eliminar')
    await waitFor(() => inUi<boolean>(`!!document.querySelector('dialog[open] .button-danger')`), Boolean, 'confirmar borrar nota')
    await inUi(`document.querySelector('dialog[open] .button-danger').click()`)
    const afterRemove = await waitFor(getMesa, current => current.notes.length === 0, 'nota borrada').catch(() => null)
    record(
      'borrar: eliminar la nota borra su conexión y no toca las tarjetas',
      afterRemove !== null &&
        afterRemove.edges.length === 0 &&
        afterRemove.cards.length === 4 &&
        (await waitFor(edgeCount, count => count === 0, 'sin líneas').then(() => true, () => false)),
    )

    // beforeunload en la web de una tarjeta.
    const guardedUrl = `${fixtureUrl}guarded`
    const guardedCard = await inUi<Card>(`window.table.cards.add(${JSON.stringify(mesa.id)}, ${JSON.stringify(guardedUrl)}, { x: 0, y: 700 })`)
    await inUi(`window.table.surface.enter(${JSON.stringify(mesa.id)}, ${JSON.stringify(guardedCard.id)})`)
    await waitFor(() => surface.getStates().find(state => state.cardId === guardedCard.id), state => state?.status === 'ready', 'página con cambios cargada')
    const guardedContents = await waitFor(() => findContents(guardedUrl), Boolean, 'webContents de la página con cambios')
    activate(guardedContents!)
    await delay(300)
    let prompts = 0
    smokeHooks.confirmDiscard = () => {
      prompts += 1
      return false
    }
    const keptCard = await inUi<string>(`window.table.surface.unload(${JSON.stringify(guardedCard.id)})`)
    record('beforeunload: si se mantiene, la web sigue cargada', keptCard === 'kept' && prompts === 1 && !guardedContents!.isDestroyed(), { keptCard, prompts })
    smokeHooks.confirmDiscard = () => {
      prompts += 1
      return true
    }
    const discardedCard = await inUi<string>(`window.table.surface.unload(${JSON.stringify(guardedCard.id)})`)
    record('beforeunload: si se descarta, se descarga', discardedCard === 'unloaded' && prompts === 2, { discardedCard, prompts })

    // beforeunload en un popup de la tarjeta.
    await inUi(`window.table.surface.enter(${JSON.stringify(mesa.id)}, ${JSON.stringify(fixtureCard.id)})`)
    await waitFor(() => surface.getStates().find(state => state.cardId === fixtureCard.id), state => state?.status === 'ready', 'página sintética cargada')
    const opener = await waitFor(() => findContents(fixtureUrl), Boolean, 'webContents de la página sintética')
    await opener!.executeJavaScript(`window.open('/guarded') !== null`, true)
    const popupContents = await waitFor(() => findContents(guardedUrl), Boolean, 'popup con cambios')
    await waitFor(() => popupContents!.isLoading(), loading => !loading, 'carga del popup')
    activate(popupContents!)
    await delay(300)
    prompts = 0
    smokeHooks.confirmDiscard = () => {
      prompts += 1
      return false
    }
    const keptPopup = await inUi<string>(`window.table.surface.unload(${JSON.stringify(fixtureCard.id)})`)
    record(
      'popup: si su web se mantiene, la tarjeta no se descarga',
      keptPopup === 'kept' && prompts === 1 && !popupContents!.isDestroyed() && !opener!.isDestroyed(),
      { keptPopup, prompts },
    )
    smokeHooks.confirmDiscard = () => {
      prompts += 1
      return true
    }
    const discardedPopup = await inUi<string>(`window.table.surface.unload(${JSON.stringify(fixtureCard.id)})`)
    record('popup: si se descarta, se cierran popup y tarjeta', discardedPopup === 'unloaded' && popupContents!.isDestroyed(), {
      discardedPopup,
      prompts,
    })
    smokeHooks.confirmDiscard = () => false

    // Descarga automática: como mucho 2 webs cargadas; se descarga la menos usada,
    // y una con cambios sin guardar se queda cargada sin preguntar.
    const extra = await inUi<Card[]>(`Promise.all([1, 2, 3].map(n =>
      window.table.cards.add(${JSON.stringify(mesa.id)}, ${JSON.stringify(fixtureUrl)} + '?p=' + n, { x: 1200, y: n * 300 })))`)
    const enterAndWait = async (cardId: string): Promise<void> => {
      await inUi(`window.table.surface.enter(${JSON.stringify(mesa.id)}, ${JSON.stringify(cardId)})`)
      await waitFor(() => surface.getStates().find(state => state.cardId === cardId), state => state?.status === 'ready', 'web cargada')
    }
    for (const card of extra) {
      await enterAndWait(card.id)
    }
    const loadedIds = (): string[] => surface.getStates().filter(state => state.status !== 'unloaded').map(state => state.cardId)
    record(
      'auto: con 3 webs abiertas se descarga la menos usada',
      loadedIds().length === 2 && !loadedIds().includes(extra[0]!.id),
      { loaded: loadedIds().length },
    )
    await enterAndWait(guardedCard.id)
    activate(await waitFor(() => findContents(guardedUrl), Boolean, 'página con cambios').then(contents => contents!))
    await delay(300)
    prompts = 0
    smokeHooks.confirmDiscard = () => {
      prompts += 1
      return true
    }
    await enterAndWait(extra[0]!.id)
    await enterAndWait(extra[1]!.id)
    record(
      'auto: una web con cambios sin guardar se queda cargada sin preguntar',
      loadedIds().includes(guardedCard.id) && prompts === 0,
      { prompts, loaded: loadedIds().length },
    )
    smokeHooks.confirmDiscard = () => true
    await inUi(`window.table.surface.exit()`)
    await inUi(`window.table.surface.unload(${JSON.stringify(guardedCard.id)})`)
    smokeHooks.confirmDiscard = () => false

    // Ajustes y ficha de Notion (T-003) contra una API falsa con datos sintéticos.
    const notionServer = await startNotionServer()
    smokeHooks.notionApiBase = notionServer.url
    try {
      const saved = await inUi<{ hasToken: boolean; tokenHint: string }>(`window.table.settings.setNotionToken(${JSON.stringify(NOTION_TOKEN)})`)
      const settingsFile = readFileSync(join(app.getPath('userData'), 'settings.json'), 'utf8')
      record(
        'ajustes: el token se guarda cifrado y no vuelve al renderer',
        saved.hasToken && !settingsFile.includes(NOTION_TOKEN) && !JSON.stringify(saved).includes(NOTION_TOKEN),
        { hint: saved.tokenHint },
      )
      const unlisted = await inUi<boolean>(
        `window.table.settings.setNotionDatabase(${JSON.stringify(NOTION_DATABASE)}).then(() => false, () => true)`,
      )
      const databases = await inUi<{ id: string }[]>(`window.table.settings.listNotionDatabases()`)
      await inUi(`window.table.settings.setNotionDatabase(${JSON.stringify(NOTION_DATABASE)})`)
      record('ajustes: solo se elige una base de la lista de Notion', unlisted && databases.length === 1, { databases: databases.length })

      const notionMesa = await inUi<Mesa>(`window.table.mesas.create('Mesa de Notion')`)
      const [projectCard, otherCard] = await inUi<Card[]>(`Promise.all([
        window.table.cards.add(${JSON.stringify(notionMesa.id)}, 'https://www.notion.so/equipo/Proyecto-${NOTION_PROJECT}', { x: 0, y: 0 }),
        window.table.cards.add(${JSON.stringify(notionMesa.id)}, 'https://www.notion.so/equipo/Pagina-${NOTION_OTHER}', { x: 380, y: 0 }),
      ])`)
      const refresh = (card: Card): Promise<{ status: string; snapshot?: { fields: { name: string }[] }; cached?: { fetchedAt: string } | null }> =>
        inUi(`window.table.notion.refreshProject(${JSON.stringify(notionMesa.id)}, ${JSON.stringify(card!.id)})`)
      const ready = await refresh(projectCard!)
      record(
        'notion: la ficha trae solo los campos permitidos',
        ready.status === 'ready' &&
          ready.snapshot?.fields.map(field => field.name).join() === 'Status,Services,Start Date,Due Date,Remaining days' &&
          !JSON.stringify(ready).includes('SECRETO'),
        { status: ready.status },
      )
      record('notion: una página que no es ficha queda como tarjeta web', (await refresh(otherCard!)).status === 'not-project')

      ui.reload()
      await waitFor(() => inUi<boolean>(`[...document.querySelectorAll('.mesa-row-open')].some(b => b.textContent.includes('Mesa de Notion'))`), Boolean, 'mesa de Notion en el inicio')
      await inUi(`[...document.querySelectorAll('.mesa-row-open')].find(b => b.textContent.includes('Mesa de Notion')).click()`)
      const face = await waitFor(
        () => inUi<string>(`document.querySelector('.project-face')?.textContent ?? ''`),
        text => text.includes('In progress'),
        'ficha en el lienzo',
      )
      record('notion: la tarjeta muestra la ficha en el lienzo', face.includes('Branding') && !face.includes('SECRETO'))
      await shot('12-ficha-notion')

      smokeHooks.notionApiBase = 'http://127.0.0.1:9'
      const offline = await refresh(projectCard!)
      record('notion: sin conexión devuelve la caché con su fecha', offline.status === 'error' && typeof offline.cached?.fetchedAt === 'string', {
        status: offline.status,
      })

      await inUi(`window.table.settings.clearNotionToken()`)
      record('ajustes: sin token la tarjeta vuelve a ser web', (await refresh(projectCard!)).status === 'not-configured')
      await inUi(`window.table.mesas.remove(${JSON.stringify(notionMesa.id)})`)
    } finally {
      smokeHooks.notionApiBase = undefined
      notionServer.server.close()
    }

    await inUi(`window.table.surface.openMesa(null)`)
    await inUi(`window.table.mesas.remove(${JSON.stringify(mesa.id)})`)
    const listing = await inUi<{ mesas: { name: string }[] }>('window.table.mesas.list()')
    record('mesas: borrar elimina la mesa', listing.mesas.every(item => item.name !== 'Mesa de prueba'))

    // Cierre coordinado: mover el lienzo y cerrar antes del retardo de guardado.
    const closingMesa = await inUi<Mesa>(`window.table.mesas.create('Mesa de cierre')`)
    closingMesaId = closingMesa.id
    ui.reload()
    await waitFor(() => inUi<boolean>(`[...document.querySelectorAll('.mesa-row-open')].some(b => b.textContent.includes('Mesa de cierre'))`), Boolean, 'mesa de cierre en el inicio')
    await inUi(`[...document.querySelectorAll('.mesa-row-open')].find(b => b.textContent.includes('Mesa de cierre')).click()`)
    await waitFor(() => inUi<boolean>(`!!document.querySelector('.react-flow__pane')`), Boolean, 'lienzo de cierre')
    await inUi(`(() => {
      const pane = document.querySelector('.react-flow__pane')
      const r = pane.getBoundingClientRect()
      for (let i = 0; i < 5; i += 1) {
        pane.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120, clientX: r.left + 300, clientY: r.top + 300 }))
      }
    })()`)
    await delay(250)
  } catch (error) {
    record('ejecución', false, error instanceof Error ? error.message : String(error))
  } finally {
    server.close()
  }

  window.once('closed', () => {
    if (closingMesaId) {
      try {
        const saved = JSON.parse(readFileSync(join(app.getPath('userData'), 'mesas', `${closingMesaId}.json`), 'utf8')) as Mesa
        record('cierre: guarda la vista pendiente del lienzo', saved.viewport.y !== 0 || saved.viewport.x !== 0, saved.viewport)
      } catch (error) {
        record('cierre: guarda la vista pendiente del lienzo', false, error instanceof Error ? error.message : String(error))
      }
    }
    const failed = checks.filter(check => !check.ok).length
    console.log(`[table-smoke] ${checks.length - failed}/${checks.length} comprobaciones correctas`)
    clearTimeout(watchdog)
    app.exit(failed === 0 ? 0 : 1)
  })
  window.close()
}
