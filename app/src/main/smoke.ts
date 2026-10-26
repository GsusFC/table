import { app, type BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { Card, Mesa } from '../shared/model'
import type { SurfaceManager } from './web/types'

/**
 * Recorrido de T-002 sobre la app real, con datos en una carpeta temporal y
 * páginas sintéticas locales. Usa la interfaz (clics, menú contextual, campo
 * «Añadir URL») cuando el criterio de aceptación es de interfaz, y la API del
 * preload para preparar datos. Si `TABLE_SMOKE_SHOTS` apunta a una carpeta,
 * guarda capturas de la interfaz local en cada paso.
 */

const FIXTURE_HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Página sintética</title>
<style>body{font:16px system-ui;margin:0;padding:32px;background:#fdf6e3}main{height:3000px}</style></head>
<body><main><h1>Página sintética de prueba</h1><p>Contenido local para T-002.</p></main></body></html>`

const TOTAL_TIMEOUT_MS = 90_000

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
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(FIXTURE_HTML)
  })
  const { promise, resolve } = Promise.withResolvers<void>()
  server.listen(0, '127.0.0.1', resolve)
  await promise
  const { port } = server.address() as AddressInfo
  return { server, url: `http://127.0.0.1:${port}/` }
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
  const { server, url: fixtureUrl } = await startFixtureServer()

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
    await inUi(`(() => {
      const pane = document.querySelector('.react-flow__pane')
      const r = pane.getBoundingClientRect()
      pane.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 200, clientY: r.top + 420, button: 2 }))
    })()`)
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

    await inUi(`window.table.surface.openMesa(null)`)
    await inUi(`window.table.mesas.remove(${JSON.stringify(mesa.id)})`)
    const remaining = await inUi<{ name: string }[]>('window.table.mesas.list()')
    record('mesas: borrar elimina la mesa', remaining.every(item => item.name !== 'Mesa de prueba'))
  } catch (error) {
    record('ejecución', false, error instanceof Error ? error.message : String(error))
  } finally {
    server.close()
  }

  const failed = checks.filter(check => !check.ok).length
  console.log(`[table-smoke] ${checks.length - failed}/${checks.length} comprobaciones correctas`)
  window.once('closed', () => {
    clearTimeout(watchdog)
    app.exit(failed === 0 ? 0 : 1)
  })
  window.close()
}
