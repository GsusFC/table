import { app, type BrowserWindow } from 'electron'
import { setTimeout as delay } from 'node:timers/promises'
import type { WebSurface } from './webSurface'

/** Secuencia fija del escenario A (docs/memory-validation.md). */
const LOAD_TIMEOUT_MS = 60_000
const CONSERVED_MS = 5_000
const OBSERVATION_MS = 30_000

export interface CycleOptions {
  readonly cycles: number
  /** Tiempo con la web activa en cada ciclo; la comparación con Figma de escritorio usa 60 s. */
  readonly activeMs: number
}

function mark(phase: string, details: Record<string, unknown> = {}): void {
  console.log(`[t001-cycle] ${JSON.stringify({ ts: Date.now(), phase, ...details })}`)
}

async function waitForReady(surface: WebSurface): Promise<void> {
  const deadline = Date.now() + LOAD_TIMEOUT_MS
  while (surface.getState().status !== 'ready') {
    if (surface.getState().status === 'failed' || Date.now() > deadline) {
      throw new Error(`La carga no terminó: ${surface.getState().error ?? 'tiempo agotado'}`)
    }
    await delay(100)
  }
}

/**
 * Ciclos de carga, uso, conservación y descarga para medir memoria desde fuera
 * con `scripts/sample-memory.mjs`. Los marcadores llevan la hora para cruzarlos
 * con las muestras. Termina la aplicación al acabar.
 */
export async function runCycles(
  window: BrowserWindow,
  surface: WebSurface,
  url: string,
  options: CycleOptions,
): Promise<void> {
  let exitCode = 0
  // Sin intervención: los permisos se deniegan y quedan en el registro; el cierre con cambios se mantiene.
  surface.askPermission = async () => false
  surface.confirmDiscard = () => false
  try {
    mark('shell-idle')
    await delay(OBSERVATION_MS)
    for (let cycle = 1; cycle <= options.cycles; cycle += 1) {
      mark('load-start', { cycle })
      await surface.open(url)
      await waitForReady(surface)
      mark('loaded', { cycle, loadMs: surface.getState().loadMs })

      surface.enter()
      await delay(options.activeMs)
      mark('active-end', { cycle })

      await surface.exit()
      await delay(CONSERVED_MS)
      mark('conserved-end', { cycle })

      if ((await surface.unload()) === 'kept') {
        mark('aborted', { cycle, reason: 'la web declaró cambios sin guardar' })
        exitCode = 1
        break
      }
      mark('unloaded', { cycle })
      await delay(OBSERVATION_MS)
      mark('observed', { cycle })
    }
  } catch (error) {
    mark('failed', { message: error instanceof Error ? error.message : String(error) })
    exitCode = 1
  }
  mark('done', { exitCode })
  window.once('closed', () => app.exit(exitCode))
  window.close()
}
