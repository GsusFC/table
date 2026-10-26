import { app, webContents, type BrowserWindow, type WebContents } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { Card, Mesa, Point, Size } from '../shared/model'
import type { HarnessProfile, SessionInfo } from '../shared/terminal'
import {
  FIXTURE_OTHER_SOURCE,
  FIXTURE_PROJECT_PROPERTIES,
  FIXTURE_PROJECT_SCHEMA,
  FIXTURE_PROJECTS_SOURCE,
  fixtureDataSourceResponse,
  fixturePageResponse,
  fixtureSearchResponse,
} from './notion/fixtures'
import type { SettingsStore } from './settings/settingsStore'
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

const TOTAL_TIMEOUT_MS = 180_000

/** Decisión ante `beforeunload` que el smoke controla; la app la usa solo con TABLE_SMOKE=1. */
export const smokeHooks = {
  confirmDiscard: (_origin: string, _reason: 'quit' | 'unload'): boolean => false,
  /** Si algo no se pudo guardar al cerrar; el smoke cierra igualmente. */
  confirmCloseWithUnsaved: (): boolean => true,
  /** Servidor MCP local con fichas sintéticas que sustituye al MCP de Notion. */
  notionMcpUrl: undefined as string | undefined,
  /** API de Figma falsa en local, con archivos y miniaturas sintéticos. */
  figmaApiBase: undefined as string | undefined,
  /** Cierre con sesiones de terminal en marcha: el smoke anota cuántas y cierra. */
  confirmTerminateSessions: (running: number): boolean => {
    smokeHooks.terminateConfirmations.push(running)
    return true
  },
  terminateConfirmations: [] as number[],
  /** PID del proceso de una sesión; no se expone por IPC. */
  terminalPid: (_sessionId: string): number | null => null,
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
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

const NOTION_PROJECT = 'aaaaaaaabbbb4ccc8dddeeeeeeeeeeee'
const NOTION_OTHER = 'ffffffffbbbb4ccc8dddeeeeeeeeeeee'

/**
 * MCP de Notion falso (sin OAuth, sin estado): una ficha con campos excluidos
 * rellenos en una base de proyectos y una página de otra base.
 */
async function startNotionMcpServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    const mcp = new McpServer({ name: 'notion-falso', version: '0.0.0' }, { capabilities: { tools: {} } })
    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: ['notion-fetch', 'notion-search'].map(name => ({ name, inputSchema: { type: 'object' as const } })),
    }))
    mcp.setRequestHandler(CallToolRequestSchema, async call => {
      if (call.params.name === 'notion-search') {
        // Una ficha de la base de proyectos y una página de otra base con el mismo nombre.
        return {
          content: [
            {
              type: 'text' as const,
              text: fixtureSearchResponse([
                { id: NOTION_PROJECT, title: 'Proyecto sintético', dataSourceUrl: FIXTURE_PROJECTS_SOURCE },
                { id: NOTION_OTHER, title: 'Proyecto sintético (notas)', dataSourceUrl: FIXTURE_OTHER_SOURCE },
              ]),
            },
          ],
        }
      }
      const id = String(call.params.arguments?.['id'] ?? '')
      const text =
        id === NOTION_PROJECT
          ? fixturePageResponse(`https://www.notion.so/${id}`, FIXTURE_PROJECTS_SOURCE, FIXTURE_PROJECT_PROPERTIES)
          : id === NOTION_OTHER
            ? fixturePageResponse(`https://www.notion.so/${id}`, FIXTURE_OTHER_SOURCE, { Name: 'Página suelta' })
            : id === FIXTURE_PROJECTS_SOURCE
              ? fixtureDataSourceResponse(id, FIXTURE_PROJECT_SCHEMA)
              : id === FIXTURE_OTHER_SOURCE
                ? fixtureDataSourceResponse(id, { Name: { type: 'title' } })
                : null
      return text === null
        ? { isError: true, content: [{ type: 'text' as const, text: '{"code":"object_not_found"}' }] }
        : { content: [{ type: 'text' as const, text }] }
    })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    response.on('close', () => {
      void transport.close()
      void mcp.close()
    })
    void mcp.connect(transport).then(() => transport.handleRequest(request, response))
  })
  const { promise, resolve } = Promise.withResolvers<void>()
  server.listen(0, '127.0.0.1', resolve)
  await promise
  const { port } = server.address() as AddressInfo
  return { server, url: `http://127.0.0.1:${port}/mcp` }
}

const FIGMA_TOKEN = `figd_${'s'.repeat(40)}`
const FIGMA_FILE = 'FAKEKEY00003'
/** PNG de 1×1 px: basta para comprobar que la miniatura se guarda y se ve. */
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

/** API de Figma falsa: un archivo con una página, dos frames y un texto suelto, y sus imágenes. */
async function startFigmaServer(): Promise<{ server: Server; url: string }> {
  let base = ''
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', base)
    const reply = (status: number, body: unknown): void => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    }
    if (url.pathname.startsWith('/render/')) {
      response.writeHead(200, { 'content-type': 'image/png' })
      response.end(TINY_PNG)
    } else if (request.headers['x-figma-token'] !== FIGMA_TOKEN) {
      reply(403, { status: 403, err: 'Invalid token' })
    } else if (url.pathname === '/v1/me') {
      reply(200, { handle: 'persona-sintetica' })
    } else if (url.pathname === `/v1/files/${FIGMA_FILE}`) {
      reply(200, {
        name: 'Archivo sintético',
        document: {
          children: [
            {
              id: '0:1',
              name: 'Página 1',
              type: 'CANVAS',
              children: [
                { id: '1:2', name: 'Portada', type: 'FRAME' },
                { id: '1:3', name: 'Detalle', type: 'FRAME' },
                { id: '1:4', name: 'Texto suelto', type: 'TEXT' },
              ],
            },
          ],
        },
      })
    } else if (url.pathname === `/v1/images/${FIGMA_FILE}`) {
      const ids = (url.searchParams.get('ids') ?? '').split(',')
      reply(200, { err: null, images: Object.fromEntries(ids.map(id => [id, `${base}/render/${id.replace(':', '-')}.png`])) })
    } else {
      reply(404, { status: 404, err: 'Not found' })
    }
  })
  const { promise, resolve } = Promise.withResolvers<void>()
  server.listen(0, '127.0.0.1', resolve)
  await promise
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { server, url: base }
}

export async function runSmoke(window: BrowserWindow, surface: SurfaceManager, settings: SettingsStore): Promise<void> {
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
   * elemento `fromId` hasta el elemento `toId`, en su centro o justo fuera de
   * su borde izquierdo (donde está su asa).
   */
  const dragConnection = (fromId: string, side: 'left' | 'right', toId: string, drop: 'center' | 'left-handle' = 'center'): Promise<unknown> =>
    inUi(`(async () => {
      const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()))
      const center = element => {
        const r = element.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      }
      const handle = document.querySelector(${JSON.stringify(`.react-flow__node[data-id="${fromId}"] .connection-handle[data-handlepos="${side}"]`)})
      const from = center(handle)
      const targetRect = document.querySelector(${JSON.stringify(`.react-flow__node[data-id="${toId}"]`)}).getBoundingClientRect()
      const to = ${JSON.stringify(drop)} === 'center'
        ? { x: targetRect.left + targetRect.width / 2, y: targetRect.top + targetRect.height / 2 }
        : { x: targetRect.left - 4, y: targetRect.top + targetRect.height / 2 }
      handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: from.x, clientY: from.y, button: 0 }))
      for (const t of [0.3, 0.7, 1, 1]) {
        document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: from.x + (to.x - from.x) * t, clientY: from.y + (to.y - from.y) * t, buttons: 1 }))
        await frame()
      }
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: to.x, clientY: to.y, button: 0 }))
    })()`)
  const { server, url: fixtureUrl } = await startFixtureServer()

  let closingMesaId: string | null = null
  /** Sesión de terminal que sigue en marcha al cerrar Table. */
  let quitSessionPid: number | null = null
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

    // Conexión tarjeta↔tarjeta soltada sobre el asa de la otra (fuera del centro, en su borde);
    // clic en la línea y ⌫ la borra sin tocar las tarjetas.
    await clearSelection()
    const figmaCard = added[1]!
    await dragConnection(fixtureCard.id, 'right', figmaCard.id, 'left-handle')
    const twoEdges = await waitFor(getMesa, current => current.edges.length === 2, 'conexión entre tarjetas').catch(() => null)
    const cardEdge = twoEdges?.edges.find(item => item.source === fixtureCard.id && item.target === figmaCard.id)
    record('conexiones: soltar sobre el asa de otra tarjeta las conecta', !!cardEdge)
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

    // T-005: las tarjetas del mismo archivo de Figma comparten un único editor.
    const figmaOrigin = fixtureUrl.slice(0, -1)
    const figmaMesa = await inUi<Mesa>(`window.table.mesas.create('Mesa de Figma')`)
    const [fileCard, frameCard, otherFileCard] = await inUi<Card[]>(`Promise.all([
      window.table.cards.add(${JSON.stringify(figmaMesa.id)}, ${JSON.stringify(`${figmaOrigin}/design/FAKEKEY00001/Archivo`)}, { x: 0, y: 0 }),
      window.table.cards.add(${JSON.stringify(figmaMesa.id)}, ${JSON.stringify(`${figmaOrigin}/design/FAKEKEY00001/Archivo?node-id=1-2`)}, { x: 380, y: 0 }),
      window.table.cards.add(${JSON.stringify(figmaMesa.id)}, ${JSON.stringify(`${figmaOrigin}/design/FAKEKEY00002/Otro`)}, { x: 760, y: 0 }),
    ])`)
    await inUi(`window.table.surface.openMesa(${JSON.stringify(figmaMesa.id)})`)
    // Último estado emitido de cada tarjeta, visto desde la interfaz.
    await inUi(`(() => {
      window.__figmaStates = {}
      window.__stopFigmaStates = window.table.surface.onState(state => { window.__figmaStates[state.cardId] = state })
    })()`)
    const enterFigma = async (cardId: string): Promise<void> => {
      await inUi(`window.table.surface.enter(${JSON.stringify(figmaMesa.id)}, ${JSON.stringify(cardId)})`)
      await waitFor(() => surface.getStates().find(state => state.cardId === cardId), state => state?.status === 'ready' && state.entered, 'web de Figma cargada')
    }
    const contentsWith = (text: string): WebContents[] =>
      webContents.getAllWebContents().filter(contents => !contents.isDestroyed() && contents.getURL().includes(text))
    await enterFigma(fileCard!.id)
    const fileContents = contentsWith('FAKEKEY00001')[0]
    await inUi('window.table.surface.exit()')
    await enterFigma(frameCard!.id)
    const frameState = surface.getStates().find(state => state.cardId === frameCard!.id)
    const fileEmitted = await inUi<{ status: string; entered: boolean } | undefined>(`window.__figmaStates[${JSON.stringify(fileCard!.id)}]`)
    const shared = contentsWith('FAKEKEY00001')
    record(
      'figma: entrar en un frame reutiliza el editor cargado del archivo y lo lleva al frame',
      !!frameState?.currentUrl?.includes('node-id=1-2') &&
        fileEmitted?.status === 'unloaded' &&
        fileEmitted.entered === false &&
        !surface.getStates().some(state => state.cardId === fileCard!.id) &&
        shared.length === 1 &&
        shared[0] === fileContents,
      { currentUrl: frameState?.currentUrl, file: fileEmitted?.status, editors: shared.length },
    )
    await enterFigma(otherFileCard!.id)
    const otherContents = contentsWith('FAKEKEY00002')
    record(
      'figma: otro archivo carga su propio editor',
      otherContents.length === 1 && !otherContents.includes(fileContents!) && contentsWith('FAKEKEY00001').length === 1,
      { loaded: surface.getStates().filter(state => state.status !== 'unloaded').length },
    )
    // Si el editor frena la navegación con `beforeunload`, no se cede ni se descarta
    // nada sin preguntar: la tarjeta que lo tiene sigue siendo la dueña y se muestra ella.
    await enterFigma(frameCard!.id)
    const guardedEditor = contentsWith('FAKEKEY00001')[0]!
    await guardedEditor.executeJavaScript(`void (window.onbeforeunload = e => { e.preventDefault(); e.returnValue = '' })`, true)
    activate(guardedEditor)
    await delay(300)
    prompts = 0
    smokeHooks.confirmDiscard = () => {
      prompts += 1
      return true
    }
    await inUi(`window.table.surface.enter(${JSON.stringify(figmaMesa.id)}, ${JSON.stringify(fileCard!.id)})`)
    const keptOwner = surface.getStates().find(state => state.cardId === frameCard!.id)
    record(
      'figma: si el editor avisa de cambios, sigue en su frame con su tarjeta y sin preguntar',
      prompts === 0 &&
        keptOwner?.entered === true &&
        keptOwner.status === 'ready' &&
        !!keptOwner.currentUrl?.includes('node-id=1-2') &&
        guardedEditor.getURL().includes('node-id=1-2') &&
        !surface.getStates().some(state => state.cardId === fileCard!.id),
      { prompts, owner: keptOwner?.status, url: keptOwner?.currentUrl },
    )
    smokeHooks.confirmDiscard = () => false
    await guardedEditor.executeJavaScript(`void (window.onbeforeunload = null)`, true)
    await enterFigma(fileCard!.id)
    const retried = surface.getStates().find(state => state.cardId === fileCard!.id)
    record(
      'figma: volver a entrar reintenta y cede el editor',
      !retried?.currentUrl?.includes('node-id') &&
        !surface.getStates().some(state => state.cardId === frameCard!.id) &&
        contentsWith('FAKEKEY00001').length === 1 &&
        contentsWith('FAKEKEY00001')[0] === guardedEditor,
      { url: retried?.currentUrl },
    )
    await inUi(`window.__stopFigmaStates()`)
    await inUi(`window.table.surface.exit()`)
    for (const card of [fileCard!, frameCard!, otherFileCard!]) {
      await inUi(`window.table.surface.unload(${JSON.stringify(card.id)})`)
    }
    await inUi(`window.table.mesas.remove(${JSON.stringify(figmaMesa.id)})`)

    // Conexión y ficha de Notion (T-003) contra un MCP falso con datos sintéticos. La
    // autorización en el navegador no se puede automatizar: se guarda una conexión falsa.
    const notionServer = await startNotionMcpServer()
    smokeHooks.notionMcpUrl = notionServer.url
    try {
      const fakeSecret = 'credencial-sintetica-de-smoke'
      await settings.connectNotion(
        { client: { client_id: 'smoke', redirect_uris: ['http://127.0.0.1/callback'] }, tokens: { access_token: fakeSecret, token_type: 'Bearer' } },
        { workspaceName: 'Estudio de prueba', userName: 'Persona de prueba' },
      )
      const view = await inUi<{ connected: boolean }>(`window.table.settings.notion()`)
      const settingsFile = readFileSync(join(app.getPath('userData'), 'settings.json'), 'utf8')
      record(
        'ajustes: la conexión se guarda cifrada y no llega al renderer',
        view.connected && !settingsFile.includes(fakeSecret) && !JSON.stringify(view).includes(fakeSecret),
      )

      const notionMesa = await inUi<Mesa>(`window.table.mesas.create('Mesa de Notion')`)
      const otherCard = await inUi<Card>(
        `window.table.cards.add(${JSON.stringify(notionMesa.id)}, 'https://www.notion.so/equipo/Pagina-${NOTION_OTHER}', { x: 380, y: 0 })`,
      )
      const found = await inUi<{ pageId: string }[]>(`window.table.notion.searchProjects('Proyecto')`)
      record(
        'vincular: la búsqueda solo devuelve fichas de proyecto, sin extractos',
        found.length === 1 && found[0]!.pageId === NOTION_PROJECT && !JSON.stringify(found).includes('SECRETO'),
        { found: found.length },
      )

      // «Vincular proyecto de Notion» desde el menú del lienzo: buscar, elegir y ver la ficha.
      ui.reload()
      await waitFor(() => inUi<boolean>(`[...document.querySelectorAll('.mesa-row-open')].some(b => b.textContent.includes('Mesa de Notion'))`), Boolean, 'mesa de Notion en el inicio')
      await inUi(`[...document.querySelectorAll('.mesa-row-open')].find(b => b.textContent.includes('Mesa de Notion')).click()`)
      await waitFor(() => inUi<boolean>(`!!document.querySelector('.react-flow__pane')`), Boolean, 'lienzo de Notion')
      await openPaneMenu(60, 60)
      await clickMenuItem('Vincular proyecto de Notion')
      await waitFor(() => inUi<boolean>(`!!document.querySelector('dialog input[aria-label="Nombre del proyecto"]')`), Boolean, 'diálogo de vincular')
      await inUi(`(() => {
        const input = document.querySelector('dialog input[aria-label="Nombre del proyecto"]')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Proyecto')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })()`)
      await waitFor(() => inUi<number>(`document.querySelectorAll('.link-result').length`), count => count > 0, 'resultados de la búsqueda')
      await shot('13-vincular-proyecto')
      await inUi(`document.querySelector('.link-result').click()`)
      const linked = await waitFor(
        () => inUi<Mesa>(`window.table.mesas.get(${JSON.stringify(notionMesa.id)})`),
        current => current.cards.length === 2,
        'tarjeta vinculada',
      )
      const projectCard = linked.cards.find(card => card.url.includes(NOTION_PROJECT))
      const face = await waitFor(
        () => inUi<string>(`document.querySelector('.project-face')?.textContent ?? ''`),
        text => text.includes('In progress'),
        'ficha en el lienzo',
      )
      record(
        'vincular: elegir un proyecto crea su tarjeta con la ficha',
        !!projectCard && projectCard.serviceId === 'notion' && face.includes('Branding') && !face.includes('SECRETO'),
      )
      await shot('12-ficha-notion')

      const refresh = (card: Card): Promise<{ status: string; snapshot?: { fields: { name: string }[] }; cached?: { fetchedAt: string } | null }> =>
        inUi(`window.table.notion.refreshProject(${JSON.stringify(notionMesa.id)}, ${JSON.stringify(card!.id)})`)
      const ready = await refresh(projectCard!)
      record(
        'notion: la ficha trae solo los campos permitidos',
        ready.status === 'ready' &&
          ready.snapshot?.fields.map(field => field.name).join() === 'Status,Services,Start Date,Due Date' &&
          !JSON.stringify(ready).includes('SECRETO'),
        { status: ready.status },
      )
      record('notion: una página de otra base queda como tarjeta web', (await refresh(otherCard)).status === 'not-project')

      notionServer.server.close()
      notionServer.server.closeAllConnections()
      const offline = await refresh(projectCard!)
      record('notion: sin conexión devuelve la caché con su fecha', offline.status === 'error' && typeof offline.cached?.fetchedAt === 'string', {
        status: offline.status,
      })

      await inUi(`window.table.settings.disconnectNotion()`)
      const afterDisconnect = await refresh(projectCard!)
      const cacheLeft = await inUi<unknown>(`window.table.notion.cachedProject(${JSON.stringify(notionMesa.id)}, ${JSON.stringify(projectCard!.id)})`)
      record('ajustes: al desconectar la tarjeta vuelve a ser web y se borra la caché', afterDisconnect.status === 'not-configured' && cacheLeft === null)
      await inUi(`window.table.mesas.remove(${JSON.stringify(notionMesa.id)})`)
    } finally {
      smokeHooks.notionMcpUrl = undefined
      notionServer.server.close()
    }

    // Token de Figma y frames con miniatura (T-005) contra una API falsa.
    const figmaServer = await startFigmaServer()
    smokeHooks.figmaApiBase = figmaServer.url
    try {
      const rejected = await inUi<boolean>(`window.table.settings.connectFigma('figd_${'x'.repeat(40)}').then(() => false, () => true)`)
      const figmaView = await inUi<{ connected: boolean; handle: string | null }>(`window.table.settings.connectFigma(${JSON.stringify(FIGMA_TOKEN)})`)
      const settingsFile = readFileSync(join(app.getPath('userData'), 'settings.json'), 'utf8')
      record(
        'figma: el token se comprueba, se guarda cifrado y no vuelve al renderer',
        rejected && figmaView.connected && figmaView.handle === 'persona-sintetica' && !settingsFile.includes(FIGMA_TOKEN),
      )

      const figmaMesa = await inUi<Mesa>(`window.table.mesas.create('Mesa de Figma')`)
      const fileCard = await inUi<Card>(
        `window.table.cards.add(${JSON.stringify(figmaMesa.id)}, 'https://www.figma.com/design/${FIGMA_FILE}/Archivo', { x: 0, y: 0 })`,
      )
      ui.reload()
      await waitFor(() => inUi<boolean>(`[...document.querySelectorAll('.mesa-row-open')].some(b => b.textContent.includes('Mesa de Figma'))`), Boolean, 'mesa de Figma en el inicio')
      await inUi(`[...document.querySelectorAll('.mesa-row-open')].find(b => b.textContent.includes('Mesa de Figma')).click()`)
      await waitFor(() => inUi<boolean>(`!!document.querySelector(${JSON.stringify(`.react-flow__node[data-id="${fileCard.id}"]`)})`), Boolean, 'tarjeta del archivo')
      await inUi(`(() => {
        const node = document.querySelector(${JSON.stringify(`.react-flow__node[data-id="${fileCard.id}"]`)})
        const r = node.getBoundingClientRect()
        node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + 40, button: 2 }))
      })()`)
      await clickMenuItem('Añadir frames')
      const listed = await waitFor(
        () => inUi<string[]>(`[...document.querySelectorAll('.frames-item-name')].map(item => item.textContent)`),
        names => names.length > 0,
        'frames del archivo',
      )
      await inUi(`document.querySelectorAll('.frames-item input').forEach(input => input.click())`)
      await shot('14-anadir-frames')
      await inUi(`document.querySelector('dialog button[type="submit"]').click()`)
      const withFrames = await waitFor(
        () => inUi<Mesa>(`window.table.mesas.get(${JSON.stringify(figmaMesa.id)})`),
        current => current.cards.length === 3,
        'tarjetas de frame',
      )
      const thumbnails = await waitFor(
        () => inUi<number>(`document.querySelectorAll('img.card-thumbnail').length`),
        count => count === 2,
        'miniaturas de frame',
      ).catch(() => 0)
      const loaded = await inUi<boolean>(`[...document.querySelectorAll('img.card-thumbnail')].every(img => img.complete && img.naturalWidth > 0)`)
      record(
        'figma: «Añadir frames» lista los frames, crea sus tarjetas y muestra la miniatura',
        listed.join() === 'Portada,Detalle' &&
          withFrames.cards.filter(card => card.url.includes('node-id=1-2') || card.url.includes('node-id=1-3')).length === 2 &&
          thumbnails === 2 &&
          loaded,
        { listed, thumbnails },
      )
      await shot('15-frames')

      const frameCard = withFrames.cards.find(card => card.url.includes('node-id=1-2'))!
      await inUi(`window.table.settings.disconnectFigma()`)
      const afterDisconnect = await inUi<unknown>(`window.table.figma.thumbnail(${JSON.stringify(figmaMesa.id)}, ${JSON.stringify(frameCard.id)})`)
      record('figma: al quitar el token se borran las miniaturas', afterDisconnect === null)
      await inUi(`window.table.mesas.remove(${JSON.stringify(figmaMesa.id)})`)
    } finally {
      smokeHooks.figmaApiBase = undefined
      figmaServer.server.close()
    }

    // T-007: interfaz del panel de agentes: pestañas, terminal xterm, desacoplar y volver, cerrar con confirmación.
    {
      const agentsMesa = await inUi<Mesa>(`window.table.mesas.create('Mesa de agentes')`)
      const agentsArg = JSON.stringify(agentsMesa.id)
      const goHome = async (): Promise<void> => {
        await inUi(`document.querySelector('.rail [aria-label="Inicio"]').click()`)
        await waitFor(() => inUi<boolean>(`!!document.querySelector('.home')`), Boolean, 'inicio')
      }
      await goHome()
      await waitFor(
        () => inUi<boolean>(`[...document.querySelectorAll('.mesa-row-open')].some(b => b.textContent.includes('Mesa de agentes'))`),
        Boolean,
        'mesa de agentes en el inicio',
      )
      await inUi(`[...document.querySelectorAll('.mesa-row-open')].find(b => b.textContent.includes('Mesa de agentes')).click()`)
      await waitFor(() => inUi<boolean>(`!!document.querySelector('.react-flow__pane')`), Boolean, 'lienzo de agentes')
      const panelWidth = (): Promise<number> => inUi(`document.querySelector('main.panel').getBoundingClientRect().width`)
      const widthWithout = await panelWidth()
      await inUi(`document.querySelector('.topbar [aria-label="Agentes"]').click()`)
      await waitFor(() => inUi<number>(`document.querySelectorAll('.agents-profile').length`), count => count > 0, 'perfiles en el panel vacío')
      // La web entra en el panel principal: no debe solaparse con el de agentes.
      const layout = await inUi<{ panelRight: number; agentsLeft: number }>(`({
        panelRight: document.querySelector('main.panel').getBoundingClientRect().right,
        agentsLeft: document.querySelector('.agents').getBoundingClientRect().left,
      })`)
      record(
        'agentes: el panel se abre a la derecha y estrecha el panel principal (donde va la web)',
        layout.panelRight <= layout.agentsLeft && (await panelWidth()) < widthWithout,
        layout,
      )
      const widthBefore = await inUi<number>(`document.querySelector('.agents').getBoundingClientRect().width`)
      await inUi(`(() => {
        const handle = document.querySelector('.agents-resize')
        handle.focus()
        for (let i = 0; i < 3; i += 1) {
          handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }))
        }
      })()`)
      const widthAfter = await waitFor(
        () => inUi<number>(`document.querySelector('.agents').getBoundingClientRect().width`),
        width => width > widthBefore,
        'panel más ancho',
      ).catch(() => widthBefore)
      record('agentes: el borde del panel cambia su ancho', widthAfter > widthBefore, { widthBefore, widthAfter })
      await shot('16-agentes-vacio')

      // Nueva sesión desde «+» con la terminal normal.
      const shellName = (await inUi<HarnessProfile[]>(`window.table.terminal.profiles()`)).find(profile => profile.id === 'shell')!.name
      await inUi(`document.querySelector('.agents [aria-label="Nueva sesión"]').click()`)
      await waitFor(() => inUi<boolean>(`!!document.querySelector('.menu')`), Boolean, 'menú de perfiles')
      await inUi(
        `[...document.querySelectorAll('.menu [role="menuitem"]')].find(b => b.querySelector('.menu-item-label').textContent === ${JSON.stringify(shellName)}).click()`,
      )
      const [uiSession] = await waitFor(
        () => inUi<SessionInfo[]>(`window.table.terminal.sessions(${agentsArg})`),
        list => list.length === 1,
        'sesión abierta desde el panel',
      )
      const rowsText = (selector: string): Promise<string> =>
        inUi(`document.querySelector(${JSON.stringify(`${selector} .xterm-rows`)})?.textContent ?? ''`)
      await waitFor(() => rowsText('.agents-terminal'), text => text.trim().length > 0, 'prompt en el terminal del panel', 20_000)
      await delay(500)
      /** Teclea en el terminal enfocado con eventos de entrada reales y pulsa Enter. */
      const typeLine = async (selector: string, line: string): Promise<void> => {
        await inUi(`document.querySelector(${JSON.stringify(`${selector} .xterm-helper-textarea`)}).focus()`)
        for (const character of line) {
          ui.sendInputEvent({ type: 'char', keyCode: character })
        }
        ui.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
        ui.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
      }
      await typeLine('.agents-terminal', 'echo ui-$((1+1))')
      const typed = await waitFor(() => rowsText('.agents-terminal'), text => text.includes('ui-2'), 'salida tecleada en el panel', 20_000).then(
        () => true,
        () => false,
      )
      record(
        'agentes: «+» abre una terminal en una pestaña; lo tecleado llega y se ve su salida',
        typed && uiSession?.status === 'running' && (await inUi<number>(`document.querySelectorAll('.agents-tab').length`)) === 1,
      )
      await shot('17-agentes-terminal')

      // Desacoplar: el mismo terminal pasa a una tarjeta del lienzo, sin guardarse en la mesa.
      await inUi(`[...document.querySelectorAll('.agents-session-bar button')].find(b => b.textContent.includes('Desacoplar')).click()`)
      await waitFor(() => rowsText('.react-flow__node-terminal'), text => text.includes('ui-2'), 'tarjeta de terminal con la salida')
      const cardId = await inUi<string | null>(`document.querySelector('.react-flow__node-terminal')?.dataset.id ?? null`)
      await typeLine('.react-flow__node-terminal', 'echo card-$((2+3))')
      const typedInCard = await waitFor(() => rowsText('.react-flow__node-terminal'), text => text.includes('card-5'), 'salida tecleada en la tarjeta', 20_000).then(
        () => true,
        () => false,
      )
      const afterDetach = await inUi<SessionInfo[]>(`window.table.terminal.sessions(${agentsArg})`)
      const savedMesa = await inUi<Mesa>(`window.table.mesas.get(${agentsArg})`)
      record(
        'agentes: desacoplar lleva la misma sesión a una tarjeta del lienzo que no se guarda en la mesa',
        cardId === uiSession?.id &&
          typedInCard &&
          afterDetach.length === 1 &&
          afterDetach[0]?.id === uiSession.id &&
          afterDetach[0].status === 'running' &&
          !(await inUi<boolean>(`!!document.querySelector('.agents-terminal')`)) &&
          savedMesa.cards.length === 0 &&
          savedMesa.notes.length === 0,
      )
      await shot('18-agentes-tarjeta')

      // Con zoom, el terminal de la tarjeta sigue 1:1 con la pantalla: doble clic selecciona la palabra bajo el ratón.
      // Con el panel plegado la tarjeta ampliada cabe en el lienzo; «Volver al panel» lo vuelve a abrir.
      await inUi(`document.querySelector('.agents [aria-label="Plegar agentes"]').click()`)
      // Zoom con gesto de pellizco (rueda + Ctrl) junto a la esquina de la tarjeta, para que siga a la vista.
      const pinch = (deltaY: number): Promise<unknown> =>
        inUi(`(() => {
          const card = document.querySelector('.react-flow__node-terminal').getBoundingClientRect()
          document.querySelector('.react-flow__pane').dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: ${deltaY}, clientX: card.left - 8, clientY: card.top - 8 }))
        })()`)
      await pinch(-40)
      await delay(400)
      await typeLine('.react-flow__node-terminal', 'echo xx zzmark')
      const markRow = `[...document.querySelectorAll('.react-flow__node-terminal .xterm-rows > div')].find(row => row.textContent.replace(/\\u00a0/g, ' ').trimEnd() === 'xx zzmark')`
      await waitFor(() => inUi<boolean>(`!!${markRow}`), Boolean, 'línea marcada en la tarjeta', 20_000)
      const target = await inUi<{ zoom: number; screenScale: number; x: number; y: number; left: number; width: number }>(`(() => {
        const row = ${markRow}
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
        let node
        while ((node = walker.nextNode()) && !node.textContent.includes('zzmark')) {}
        const range = document.createRange()
        const start = node.textContent.indexOf('zzmark')
        range.setStart(node, start)
        range.setEnd(node, start + 6)
        const r = range.getBoundingClientRect()
        const screen = document.querySelector('.react-flow__node-terminal .xterm-screen')
        const viewport = document.querySelector('.react-flow__viewport').style.transform
        return {
          zoom: Number(/scale\\(([\\d.]+)\\)/.exec(viewport)?.[1] ?? 1),
          screenScale: screen.getBoundingClientRect().width / screen.offsetWidth,
          x: Math.round(r.left + r.width / 2),
          y: Math.round(r.top + r.height / 2),
          left: r.left,
          width: r.width,
        }
      })()`)
      for (const clickCount of [1, 2]) {
        ui.sendInputEvent({ type: 'mouseDown', x: target.x, y: target.y, button: 'left', clickCount })
        ui.sendInputEvent({ type: 'mouseUp', x: target.x, y: target.y, button: 'left', clickCount })
      }
      const selection = await waitFor(
        () =>
          inUi<{ left: number; width: number }[]>(
            `[...document.querySelectorAll('.react-flow__node-terminal .xterm-selection div')].map(d => { const r = d.getBoundingClientRect(); return { left: r.left, width: r.width } }).filter(r => r.width > 0)`,
          ),
        rects => rects.length > 0,
        'selección en la tarjeta',
      ).catch(() => [])
      const cell = target.width / 6
      record(
        'agentes: con zoom, el terminal de la tarjeta queda 1:1 y el doble clic selecciona la palabra bajo el ratón',
        target.zoom > 1.5 &&
          Math.abs(target.screenScale - 1) < 0.01 &&
          selection.some(rect => Math.abs(rect.left - target.left) < cell / 2 && Math.abs(rect.width - target.width) < cell / 2),
        { zoom: target.zoom, screenScale: target.screenScale, target: { left: target.left, width: target.width }, selection },
      )
      await shot('19-agentes-tarjeta-zoom')
      await pinch(40)

      // Volver al panel: la misma salida, sin reiniciar.
      await inUi(`[...document.querySelectorAll('.terminal-card-header button')].find(b => b.textContent.includes('Volver al panel')).click()`)
      const back = await waitFor(
        () => rowsText('.agents-terminal'),
        text => text.includes('ui-2') && text.includes('card-5'),
        'terminal de vuelta en el panel',
      ).then(
        () => true,
        () => false,
      )
      const afterAttach = await inUi<SessionInfo[]>(`window.table.terminal.sessions(${agentsArg})`)
      record(
        'agentes: volver al panel conserva la sesión y su salida',
        back && !(await inUi<boolean>(`!!document.querySelector('.react-flow__node-terminal')`)) && afterAttach[0]?.id === uiSession?.id,
      )

      // Cerrar una sesión en marcha pide confirmación.
      await inUi(`document.querySelector('.agents-tab-close').click()`)
      await waitFor(() => inUi<boolean>(`!!document.querySelector('dialog[open]')`), Boolean, 'confirmación de cierre')
      const confirmText = await inUi<string>(`document.querySelector('dialog[open]').textContent`)
      await inUi(`document.querySelector('dialog[open] button[type="submit"]').click()`)
      const closed = await waitFor(
        () => inUi<SessionInfo[]>(`window.table.terminal.sessions(${agentsArg})`),
        list => list.length === 0,
        'sesión cerrada',
      ).then(
        () => true,
        () => false,
      )
      // La pestaña desaparece cuando el renderer recibe la respuesta del cierre.
      const emptyPanel = await waitFor(
        () => inUi<boolean>(`document.querySelectorAll('.agents-tab').length === 0 && !!document.querySelector('.agents-profiles')`),
        Boolean,
        'panel sin sesiones',
      ).catch(() => false)
      record(
        'agentes: cerrar una sesión en marcha pide confirmación y termina el proceso',
        confirmText.includes('El agente sigue en marcha') && closed && emptyPanel,
        { confirm: confirmText.includes('El agente sigue en marcha'), closed, emptyPanel },
      )

      await inUi(`document.querySelector('.agents [aria-label="Plegar agentes"]').click()`)
      record('agentes: plegar el panel devuelve el ancho al panel principal', (await waitFor(panelWidth, width => width === widthWithout, 'panel plegado').catch(() => 0)) === widthWithout)
      await goHome()
      await inUi(`window.table.mesas.remove(${agentsArg})`)
    }
    // fin T-007 interfaz

    // T-007: sesiones de terminal por la API del preload (proceso principal), con el shell real del usuario.
    {
      const termMesa = await inUi<Mesa>(`window.table.mesas.create('Agentes/../prueba')`)
      const mesaArg = JSON.stringify(termMesa.id)
      await inUi(`(() => {
        window.__smokeTerm = { out: {}, sessions: [] }
        window.table.terminal.onData((id, data) => { window.__smokeTerm.out[id] = (window.__smokeTerm.out[id] ?? '') + data })
        window.table.terminal.onSession(session => { window.__smokeTerm.sessions.push(session) })
      })()`)
      const output = (id: string): Promise<string> => inUi(`window.__smokeTerm.out[${JSON.stringify(id)}] ?? ''`)
      const waitOutput = (id: string, text: string, label: string): Promise<string> =>
        waitFor(() => output(id), value => value.includes(text), label, 20_000)

      const profiles = await inUi<HarnessProfile[]>(`window.table.terminal.profiles()`)
      record(
        'terminal: el catálogo ofrece la terminal normal y los arneses conocidos',
        profiles.some(profile => profile.id === 'shell' && profile.available && profile.command === null) &&
          ['claude', 'codex', 'gemini', 'opencode', 'omp', 'pi'].every(id => profiles.some(profile => profile.id === id && profile.source === 'builtin')),
        { available: profiles.filter(profile => profile.available).map(profile => profile.id) },
      )

      const shellSession = await inUi<SessionInfo>(`window.table.terminal.start(${mesaArg}, 'shell', { cols: 80, rows: 24 })`)
      const shellArg = JSON.stringify(shellSession.id)
      const workFolder = join(app.getPath('userData'), 'Table', 'Agentes-..-prueba')
      record(
        'terminal: la sesión trabaja en la carpeta de la mesa, con nombre saneado',
        shellSession.cwd === workFolder && existsSync(workFolder) && shellSession.title === 'Terminal' && shellSession.status === 'running',
        { cwd: shellSession.cwd.slice(app.getPath('userData').length), title: shellSession.title },
      )
      // Se espera al primer texto (el prompt) antes de escribir.
      await waitFor(() => output(shellSession.id), value => value.length > 0, 'prompt del shell', 20_000)
      await delay(500)
      await inUi(`window.table.terminal.write(${shellArg}, 'echo marca-$((40+2))\\r')`)
      await waitOutput(shellSession.id, 'marca-42', 'salida de echo')
      record('terminal: escribir en la sesión ejecuta el comando y llega su salida', true)

      await inUi(`window.table.terminal.resize(${shellArg}, { cols: 100, rows: 30 })`)
      await inUi(`window.table.terminal.write(${shellArg}, 'stty size\\r')`)
      const resized = await waitOutput(shellSession.id, '30 100', 'tamaño nuevo').then(
        () => true,
        () => false,
      )
      record('terminal: redimensionar cambia el tamaño que ve el proceso', resized)

      const replay = await inUi<string>(`window.table.terminal.replay(${shellArg})`)
      record('terminal: la salida guardada permite volver a pintar la sesión', replay.includes('marca-42') && replay.includes('30 100'))

      // Un hijo en segundo plano (otro grupo de procesos) también debe terminar al cerrar.
      // `!` tecleado activaría la expansión del historial del shell interactivo: se genera con printf y eval.
      const backgroundJob = `sleep 300 & eval "echo hijo-\\$$(printf '\\041')-fin"\r`
      await inUi(`window.table.terminal.write(${shellArg}, ${JSON.stringify(backgroundJob)})`)
      // Solo cuenta la línea con el PID ya expandido, no el eco de lo tecleado.
      const childText = await waitFor(() => output(shellSession.id), value => /hijo-\d+-fin/.test(value), 'PID del hijo', 20_000)
      const childPid = Number(/hijo-(\d+)-fin/.exec(childText)?.[1])
      const shellPid = smokeHooks.terminalPid(shellSession.id)
      await inUi(`window.table.terminal.close(${shellArg})`)
      const listedAfterClose = await inUi<SessionInfo[]>(`window.table.terminal.sessions(${mesaArg})`)
      record(
        'terminal: cerrar termina el proceso y sus hijos y olvida la sesión',
        shellPid !== null && !processAlive(shellPid) && childPid > 0 && !processAlive(childPid) && listedAfterClose.length === 0,
        { shellPid: shellPid !== null, childPid: childPid > 0 },
      )

      const invalidRejected = await inUi<boolean>(
        `window.table.terminal.saveCustomProfile({ name: 'Mal', command: 'echo a\\necho b' }).then(() => false, () => true)`,
      )
      const withCustom = await inUi<HarnessProfile[]>(
        `window.table.terminal.saveCustomProfile({ name: 'Perfil de prueba', command: 'printf custom-ok; sleep 30' })`,
      )
      const withExit = await inUi<HarnessProfile[]>(`window.table.terminal.saveCustomProfile({ name: 'Sale con 3', command: 'printf adios; exit 3' })`)
      const custom = withCustom.find(profile => profile.name === 'Perfil de prueba')
      const exiting = withExit.find(profile => profile.name === 'Sale con 3')
      record(
        'terminal: los perfiles propios se validan y se guardan',
        invalidRejected &&
          custom?.source === 'custom' &&
          custom.id.startsWith('custom:') &&
          readFileSync(join(app.getPath('userData'), 'settings.json'), 'utf8').includes('printf custom-ok; sleep 30'),
      )

      const customSession = await inUi<SessionInfo>(`window.table.terminal.start(${mesaArg}, ${JSON.stringify(custom!.id)}, { cols: 80, rows: 24 })`)
      await waitOutput(customSession.id, 'custom-ok', 'salida del perfil propio')
      record('terminal: un perfil propio abre una sesión con su comando', customSession.title === 'Perfil de prueba')

      const exitSession = await inUi<SessionInfo>(`window.table.terminal.start(${mesaArg}, ${JSON.stringify(exiting!.id)}, { cols: 80, rows: 24 })`)
      const exited = await waitFor(
        () => inUi<SessionInfo | null>(`window.__smokeTerm.sessions.find(s => s.id === ${JSON.stringify(exitSession.id)} && s.status === 'exited') ?? null`),
        session => session !== null,
        'salida con código',
        20_000,
      )
      record('terminal: una sesión que termina informa de su código de salida', exited?.exitCode === 3 && (await output(exitSession.id)).includes('adios'))

      const customPid = smokeHooks.terminalPid(customSession.id)
      await inUi(`window.table.mesas.remove(${mesaArg})`)
      const listedAfterRemove = await inUi<SessionInfo[]>(`window.table.terminal.sessions(${mesaArg})`)
      record(
        'terminal: borrar la mesa termina sus sesiones',
        customPid !== null && !processAlive(customPid) && listedAfterRemove.length === 0,
      )

      await inUi(`window.table.terminal.removeCustomProfile(${JSON.stringify(custom!.id)})`)
      const remaining = await inUi<HarnessProfile[]>(`window.table.terminal.removeCustomProfile(${JSON.stringify(exiting!.id)})`)
      record('terminal: quitar perfiles propios', remaining.every(profile => profile.source === 'builtin'))
    }

    await inUi(`window.table.surface.openMesa(null)`)
    await inUi(`window.table.mesas.remove(${JSON.stringify(mesa.id)})`)
    const listing = await inUi<{ mesas: { name: string }[] }>('window.table.mesas.list()')
    record('mesas: borrar elimina la mesa', listing.mesas.every(item => item.name !== 'Mesa de prueba'))

    // Cierre coordinado: mover el lienzo y cerrar antes del retardo de guardado.
    const closingMesa = await inUi<Mesa>(`window.table.mesas.create('Mesa de cierre')`)
    closingMesaId = closingMesa.id
    const quitSession = await inUi<SessionInfo>(`window.table.terminal.start(${JSON.stringify(closingMesa.id)}, 'shell', { cols: 80, rows: 24 })`)
    quitSessionPid = smokeHooks.terminalPid(quitSession.id)
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
    if (quitSessionPid !== null) {
      record(
        'cierre: avisa de las sesiones en marcha y termina sus procesos',
        smokeHooks.terminateConfirmations.length === 1 && smokeHooks.terminateConfirmations[0]! >= 1 && !processAlive(quitSessionPid),
        { confirmations: smokeHooks.terminateConfirmations },
      )
    }
    const failed = checks.filter(check => !check.ok).length
    console.log(`[table-smoke] ${checks.length - failed}/${checks.length} comprobaciones correctas`)
    clearTimeout(watchdog)
    app.exit(failed === 0 ? 0 : 1)
  })
  window.close()
}
