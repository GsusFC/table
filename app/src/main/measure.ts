import { app, type BrowserWindow } from 'electron'
import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { recognizeService } from '../shared/services'
import { parseHttpUrl } from '../shared/validate'
import type { MesaStore } from './store/types'
import type { SurfaceManager } from './web/types'

/**
 * Medición de memoria del escenario B (T-002), sin intervención:
 *   TABLE_MEASURE=<archivo JSON con un array de URLs>  (fuera del repositorio)
 *   TABLE_MEASURE_COUNTS=1,3,6                        tarjetas por pasada
 *   TABLE_MAX_LOADED_WEBS=0                           sin límite de webs cargadas
 *
 * Por pasada: mesa temporal con N tarjetas; se entra en cada una (carga, 15 s
 * de asentamiento, salida) y la última queda abierta; 30 s de asentamiento y
 * 30 s de ventana estable; después se descarga todo y se borra la mesa.
 * Marcadores `[table-measure]` con hora para cruzarlos con `sample-memory.mjs`.
 */

const SETTLE_AFTER_LOAD_MS = 15_000
const SETTLE_MS = 30_000
const STABLE_WINDOW_MS = 30_000
const LOAD_TIMEOUT_MS = 60_000

function mark(phase: string, details: Record<string, unknown> = {}): void {
  console.log(`[table-measure] ${JSON.stringify({ ts: Date.now(), phase, ...details })}`)
}

export async function runMeasure(window: BrowserWindow, surface: SurfaceManager, store: MesaStore, urlsFile: string): Promise<void> {
  // Si una web pide un permiso, el diálogo queda sin responder: no cambia la medición.
  let exitCode = 0
  try {
    const urls = (JSON.parse(readFileSync(urlsFile, 'utf8')) as unknown[]).map(parseHttpUrl)
    const counts = (process.env['TABLE_MEASURE_COUNTS'] ?? '1,3,6').split(',').map(Number)
    app.focus({ steal: true })
    window.focus()
    mark('shell-idle')
    await delay(SETTLE_MS)
    for (const count of counts) {
      if (count > urls.length) {
        throw new Error(`Faltan URLs: ${count} pedidas, ${urls.length} disponibles`)
      }
      const mesa = await store.create(`Medición ${count}`)
      const cards = []
      for (const [index, url] of urls.slice(0, count).entries()) {
        cards.push(await store.addCard(mesa.id, { url, serviceId: recognizeService(url).id, position: { x: index * 360, y: 0 } }))
      }
      await surface.openMesa(mesa.id)
      mark('run-start', { count })
      for (const [index, card] of cards.entries()) {
        await surface.enter(mesa.id, card.id, card.url)
        const deadline = Date.now() + LOAD_TIMEOUT_MS
        while (surface.getStates().find(state => state.cardId === card.id)?.status !== 'ready' && Date.now() < deadline) {
          await delay(200)
        }
        await delay(SETTLE_AFTER_LOAD_MS)
        if (index < cards.length - 1) {
          await surface.exit()
        }
      }
      const loaded = surface.getStates().filter(state => state.status !== 'unloaded').length
      await delay(SETTLE_MS)
      mark('stable-start', { count, loaded })
      await delay(STABLE_WINDOW_MS)
      mark('stable-end', { count, loaded })
      await surface.openMesa(null)
      await store.remove(mesa.id)
      await delay(5_000)
    }
  } catch (error) {
    mark('failed', { message: error instanceof Error ? error.message : String(error) })
    exitCode = 1
  }
  mark('done', { exitCode })
  window.once('closed', () => app.exit(exitCode))
  window.close()
}
