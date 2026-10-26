import { app, BrowserWindow, type WebContents } from 'electron'
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

/** Página sintética que declara trabajo pendiente con `beforeunload`. */
const GUARDED_HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Fixture con cambios</title></head>
<body><input id="field" autofocus>
<script>addEventListener('beforeunload', e => { e.preventDefault(); e.returnValue = '' })</script>
</body></html>`

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

    const windowsBefore = BrowserWindow.getAllWindows().length
    const popupOpened = (await web.executeJavaScript(
      `window.open(${JSON.stringify(`${fixtureUrl}popup`)}) !== null`,
      true,
    )) as boolean
    await waitFor(() => BrowserWindow.getAllWindows().length > windowsBefore, 'ventana del popup', 3_000).catch(
      () => undefined,
    )
    const popup = BrowserWindow.getAllWindows().find(candidate => candidate !== window)
    record('popup: se abre como ventana hija con la misma sesión', popupOpened && popup?.getParentWindow() === window && popup.webContents.session === web.session, {
      lastPopup: surface.getState().lastPopup,
    })
    popup?.close()

    await waitFor(() => BrowserWindow.getAllWindows().length === windowsBefore, 'cierre del popup', 3_000).catch(
      () => undefined,
    )
    // Puede bloquearlo Chromium antes de llegar al handler; basta con que no se abra nada.
    const blockedPopup = (await web.executeJavaScript(`window.open('figma://file/sintetico') === null`, true)) as boolean
    await delay(300)
    record('popup: no abre esquemas no web', blockedPopup && BrowserWindow.getAllWindows().length === windowsBefore, {
      lastPopup: surface.getState().lastPopup,
    })

    // Incremento C: descarga, recarga y aviso de trabajo pendiente.
    const unloadResult = await inUi<string>('window.tableSpike.unload()')
    const afterUnload = surface.getState()
    record(
      'descarga: cierra la web y conserva URL y captura',
      unloadResult === 'unloaded' &&
        surface.getView() === null &&
        afterUnload.status === 'unloaded' &&
        afterUnload.url === fixtureUrl &&
        afterUnload.captureDataUrl !== null,
      { status: afterUnload.status },
    )
    await inUi(`window.tableSpike.open(${JSON.stringify(fixtureUrl)})`)
    await waitFor(() => surface.getState().status === 'ready', 'recarga')
    record('recarga: vuelve a cargar y mide la duración', typeof surface.getState().loadMs === 'number', {
      loadMs: surface.getState().loadMs,
    })

    await inUi(`window.tableSpike.open(${JSON.stringify(`${fixtureUrl}guarded`)})`)
    await waitFor(() => surface.getState().status === 'ready', 'carga de la página con cambios')
    const guarded = surface.getView()?.webContents
    if (!guarded) {
      throw new Error('No se creó la vista de la página con cambios')
    }
    await inUi('window.tableSpike.enter()')
    await waitFor(() => surface.getState().entered, 'entrar en la página con cambios')
    // Chromium solo respeta `beforeunload` si la página recibió interacción del usuario.
    guarded.sendInputEvent({ type: 'mouseDown', x: 20, y: 20, button: 'left', clickCount: 1 })
    guarded.sendInputEvent({ type: 'mouseUp', x: 20, y: 20, button: 'left', clickCount: 1 })
    sendKey(guarded, 'a')
    await delay(200)

    let prompts = 0
    surface.confirmDiscard = () => {
      prompts += 1
      return false
    }
    const kept = await inUi<string>('window.tableSpike.unload()')
    record(
      'aviso: si la página declara cambios y el usuario mantiene, no se descarga',
      kept === 'kept' && prompts === 1 && surface.getView()?.webContents.isDestroyed() === false,
      { kept, prompts },
    )
    surface.confirmDiscard = () => {
      prompts += 1
      return true
    }
    const discarded = await inUi<string>('window.tableSpike.unload()')
    record('aviso: si el usuario acepta descartar, se descarga', discarded === 'unloaded' && prompts === 2, {
      discarded,
      prompts,
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
