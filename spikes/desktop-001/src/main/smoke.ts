import { app, type BrowserWindow, type WebContents } from 'electron'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import type { SurfaceBounds } from '../shared/ipc'
import type { WebSurface } from './webSurface'

/** Página sintética: contenido largo, campo de texto y registro de teclas. */
const FIXTURE_HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Fixture T-001</title>
<style>body{font:16px system-ui;margin:0;padding:24px}main{height:4000px}</style></head>
<body><main><h1>Página sintética de prueba</h1><input id="field" autofocus></main>
<script>
window.__keys = [];
addEventListener('keydown', e => __keys.push({ key: e.key, meta: e.metaKey, shift: e.shiftKey, ctrl: e.ctrlKey }), true);
</script></body></html>`

const TOTAL_TIMEOUT_MS = 60_000
const BOUNDS_TOLERANCE_PX = 1

interface Check {
  readonly name: string
  readonly ok: boolean
  readonly detail?: unknown
}

interface KeyRecord {
  readonly key: string
  readonly meta: boolean
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`Tiempo agotado: ${label}`)
    }
    await delay(50)
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

function sendKey(web: WebContents, keyCode: string, modifiers: Array<'shift' | 'meta' | 'control'> = []): void {
  web.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
  if (keyCode.length === 1) {
    web.sendInputEvent({ type: 'char', keyCode, modifiers })
  }
  web.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
}

function boundsMatch(a: SurfaceBounds, b: SurfaceBounds): boolean {
  return (
    Math.abs(a.x - b.x) <= BOUNDS_TOLERANCE_PX &&
    Math.abs(a.y - b.y) <= BOUNDS_TOLERANCE_PX &&
    Math.abs(a.width - b.width) <= BOUNDS_TOLERANCE_PX &&
    Math.abs(a.height - b.height) <= BOUNDS_TOLERANCE_PX
  )
}

/**
 * Recorre el incremento A de T-001 sin intervención: carga una página local,
 * entra y sale, envía teclado y rueda, cambia el tamaño y el zoom, y cierra.
 * Las entradas sintéticas no sustituyen la prueba manual con teclado real.
 */
export async function runSmoke(window: BrowserWindow, surface: WebSurface): Promise<void> {
  const checks: Check[] = []
  const record = (name: string, ok: boolean, detail?: unknown): void => {
    checks.push({ name, ok, detail })
    console.log(`[t001-smoke] ${ok ? 'OK  ' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`)
  }
  const watchdog = setTimeout(() => {
    console.log('[t001-smoke] FAIL tiempo total agotado')
    app.exit(2)
  }, TOTAL_TIMEOUT_MS)

  const { server, url: fixtureUrl } = await startFixtureServer()
  const ui = window.webContents
  const inUi = <T>(code: string): Promise<T> => ui.executeJavaScript(code, true) as Promise<T>
  const cardRect = (): Promise<SurfaceBounds> =>
    inUi(`(() => { const r = document.querySelector('[data-surface]').getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) } })()`)
  const modifier = process.platform === 'darwin' ? 'meta' : 'control'

  try {
    await waitFor(() => window.isVisible() && !ui.isLoading() && surface.getBounds().width > 0, 'interfaz lista')
    app.focus({ steal: true })
    window.focus()

    record(
      'aislamiento: la interfaz local no tiene Node',
      await inUi(`typeof require === 'undefined' && typeof process === 'undefined'`),
    )
    record(
      'ipc: rechaza una URL file://',
      await inUi(`window.tableSpike.open('file:///etc/hosts').then(() => false, () => true)`),
    )

    await inUi(`window.tableSpike.open(${JSON.stringify(fixtureUrl)})`)
    await waitFor(() => surface.getState().status === 'ready', 'carga de la página sintética')
    const view = surface.getView()
    if (!view) {
      throw new Error('No se creó la vista web')
    }
    const web = view.webContents
    record('carga: la página sintética se abre en WebContentsView', true)
    record(
      'aislamiento: el contenido remoto no tiene Node',
      await web.executeJavaScript(`typeof require === 'undefined' && typeof process === 'undefined'`),
    )

    await inUi('window.tableSpike.enter()')
    await waitFor(() => surface.getState().entered, 'entrar')
    const rect = await cardRect()
    record('geometría: la vista coincide con la tarjeta', boundsMatch(view.getBounds(), rect), {
      view: view.getBounds(),
      card: rect,
    })
    await delay(200)
    record('foco: la web recibe el foco al entrar', web.isFocused(), {
      windowFocused: window.isFocused(),
      pageHasFocus: await web.executeJavaScript('document.hasFocus()'),
      activeElement: await web.executeJavaScript('document.activeElement?.id ?? null'),
    })

    sendKey(web, 'a')
    sendKey(web, 'Escape')
    await delay(200)
    const keys = (await web.executeJavaScript('window.__keys')) as KeyRecord[]
    record('teclado: la web recibe las teclas', keys.some(k => k.key === 'a'), keys)
    record(
      'teclado: Esc llega a la web y no saca de la tarjeta',
      keys.some(k => k.key === 'Escape' && !k.meta) && surface.getState().entered,
    )

    sendKey(web, 'Escape', [modifier, 'shift'])
    await waitFor(() => !surface.getState().entered, 'salida con el atajo', 3_000).catch(() => undefined)
    const keysAfterShortcut = (await web.executeJavaScript('window.__keys.length')) as number
    record('atajo: vuelve a Table', !surface.getState().entered)
    record('atajo: no llega a la web', keysAfterShortcut === keys.length, { before: keys.length, after: keysAfterShortcut })
    record('captura: se genera al salir', typeof surface.getState().captureDataUrl === 'string')
    record('foco: vuelve a la interfaz local', ui.isFocused())

    await inUi('window.tableSpike.enter()')
    await waitFor(() => surface.getState().entered, 'volver a entrar')
    window.setContentSize(1000, 680)
    await delay(500)
    const resizedRect = await cardRect()
    record('redimensionado: la vista sigue a la tarjeta', boundsMatch(view.getBounds(), resizedRect), {
      view: view.getBounds(),
      card: resizedRect,
    })

    web.sendInputEvent({ type: 'mouseMove', x: 200, y: 200 })
    web.sendInputEvent({ type: 'mouseWheel', x: 200, y: 200, deltaX: 0, deltaY: -800 })
    await delay(500)
    const scrollY = (await web.executeJavaScript('window.scrollY')) as number
    record('scroll: la rueda desplaza la web', scrollY > 0, { scrollY })

    await inUi('window.tableSpike.setZoom(1.5)')
    record('zoom: se aplica a la web', Math.abs(web.getZoomFactor() - 1.5) < 0.01, { web: web.getZoomFactor() })
    record('zoom: la interfaz local sigue al 100 %', ui.getZoomFactor() === 1, { ui: ui.getZoomFactor() })
    record(
      'ipc: rechaza un zoom fuera de rango',
      await inUi('window.tableSpike.setZoom(10).then(() => false, () => true)'),
    )

    const popupDenied = (await web.executeJavaScript(`window.open('https://example.org/popup') === null`, true)) as boolean
    record('popup: se deniega y se registra su origen', popupDenied && surface.getState().lastBlockedPopup === 'https://example.org', {
      lastBlockedPopup: surface.getState().lastBlockedPopup,
    })
  } catch (error) {
    record('ejecución', false, error instanceof Error ? error.message : String(error))
  } finally {
    server.close()
  }

  const failed = checks.filter(check => !check.ok).length
  console.log(`[t001-smoke] ${checks.length - failed}/${checks.length} comprobaciones correctas`)
  window.once('closed', () => {
    clearTimeout(watchdog)
    app.exit(failed === 0 ? 0 : 1)
  })
  window.close()
}
