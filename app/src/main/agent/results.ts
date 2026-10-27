import { constants, watch, type FSWatcher } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, type FileHandle } from 'node:fs/promises'
import { extname, join } from 'node:path'
import {
  DEFAULT_RESULT_SIZE,
  type Mesa,
  type MesaId,
  type Point,
  type Result,
  type ResultId,
  type ResultKind,
} from '../../shared/model'
import { parseResultFile } from '../../shared/validate'
import { log } from '../log'
import type { MesaStore } from '../store/types'
import { RESULTS_DIR } from './context'

/**
 * Resultados de los agentes (T-008): cada archivo nuevo en `resultados/` de la
 * carpeta de trabajo de la mesa abierta pasa a ser una tarjeta de resultado.
 * La tarjeta apunta al archivo por su nombre; Table nunca borra ni modifica
 * los archivos, y una tarjeta cuyo archivo desaparece se queda («no encontrado»).
 * Quitar una tarjeta descarta su archivo: no vuelve mientras siga en la carpeta.
 */

/** Tipo MIME de las imágenes que sirve el protocolo de resultados. */
export const IMAGE_MIME: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
}

const TEXT_EXTENSIONS: Readonly<Record<string, true>> = {
  '.md': true,
  '.markdown': true,
  '.txt': true,
  '.json': true,
  '.csv': true,
  '.html': true,
  '.htm': true,
}

export function resultKindOf(file: string): ResultKind {
  const extension = extname(file).toLowerCase()
  return Object.hasOwn(IMAGE_MIME, extension) ? 'image' : Object.hasOwn(TEXT_EXTENSIONS, extension) ? 'text' : 'file'
}

/** Nombres que escriben los programas mientras el archivo aún no está completo. */
const PARTIAL_NAME = /(\.(tmp|temp|part|partial|crdownload|download|swp)|~)$/i

/** Un archivo se importa si su nombre es un segmento válido, no es oculto ni temporal. */
export function isImportableName(name: string): boolean {
  try {
    parseResultFile(name)
  } catch {
    return false
  }
  return !PARTIAL_NAME.test(name) && !name.startsWith('~$')
}

const COLUMN_GAP = 80
const ROW_GAP = 24

/**
 * Posiciones de los resultados nuevos: una columna a la derecha de las
 * tarjetas y notas, debajo del último resultado de esa columna.
 */
export function placeNewResults(mesa: Mesa, count: number): Point[] {
  const others = [...mesa.cards, ...mesa.notes]
  const x = others.length === 0 ? 0 : Math.max(...others.map(item => item.position.x + item.size.width)) + COLUMN_GAP
  const top = others.length === 0 ? 0 : Math.min(...others.map(item => item.position.y))
  const inColumn = mesa.results.filter(result => result.position.x === x)
  let y = inColumn.length === 0 ? top : Math.max(...inColumn.map(result => result.position.y + result.size.height)) + ROW_GAP
  const points: Point[] = []
  for (let index = 0; index < count; index += 1) {
    points.push({ x, y })
    y += DEFAULT_RESULT_SIZE.height + ROW_GAP
  }
  return points
}

/** Clave de un nombre de archivo, sin distinguir mayúsculas como el disco de macOS. */
function fileKey(file: string): string {
  return file.normalize('NFC').toLowerCase()
}

/**
 * `resultados/` de una carpeta de trabajo, creada si falta, como ruta real.
 * Lanza si no es una carpeta normal dentro de la carpeta de trabajo (p. ej.
 * un enlace simbólico que lleva a otro sitio): entonces no se vigila ni se lee.
 */
export async function resultsDirIn(workFolder: string): Promise<string> {
  const dir = join(await realpath(workFolder), RESULTS_DIR)
  await mkdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') {
      throw error
    }
  })
  const info = await lstat(dir)
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error('«resultados» no es una carpeta de la mesa')
  }
  return dir
}

/** Archivo de un resultado comprobado con `lstat`: archivo normal (nunca un enlace) directamente en la carpeta. */
export interface ResultEntry {
  readonly path: string
  readonly dev: number
  readonly ino: number
  readonly mode: number
}

/** El archivo de un resultado, o null si falta o no es un archivo normal (enlaces simbólicos incluidos). */
export async function resultEntry(dir: string, file: string): Promise<ResultEntry | null> {
  try {
    const path = join(dir, parseResultFile(file))
    const info = await lstat(path)
    return info.isFile() ? { path, dev: info.dev, ino: info.ino, mode: info.mode } : null
  } catch {
    return null
  }
}

/**
 * Abre para leer el archivo ya comprobado sin seguir enlaces (`O_NOFOLLOW`) y
 * exige que el descriptor sea el mismo archivo (dispositivo e inodo): si se
 * cambió entre la comprobación y la apertura, null.
 */
export async function openEntry(entry: ResultEntry): Promise<{ handle: FileHandle; size: number } | null> {
  let handle: FileHandle
  try {
    handle = await open(entry.path, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch {
    return null
  }
  const info = await handle.stat()
  if (!info.isFile() || info.dev !== entry.dev || info.ino !== entry.ino) {
    await handle.close()
    return null
  }
  return { handle, size: info.size }
}

export interface ResultsWatcherOptions {
  readonly store: Pick<MesaStore, 'get' | 'reconcileResults'>
  /** Carpeta de trabajo de la mesa (absoluta, ya creada). */
  workFolder(mesaId: MesaId): Promise<string>
  /** Cambió la lista de resultados, el contenido de alguno o algún archivo desapareció o volvió. */
  onChanged(mesaId: MesaId): void
  /** Espera tras un aviso del disco antes de revisar la carpeta. */
  readonly debounceMs?: number
  /** Un archivo cuenta como escrito cuando su tamaño y fecha no cambian durante este tiempo. */
  readonly stableMs?: number
}

export interface ResultsWatcher {
  /** Vigila `resultados/` de la mesa abierta (creándola) y la revisa ya; null deja de vigilar. */
  watch(mesaId: MesaId | null): Promise<void>
  /** Resultado y su archivo comprobado, o null si falta. Lanza si el resultado no es de la mesa. */
  resolve(mesaId: MesaId, resultId: ResultId): Promise<{ result: Result; entry: ResultEntry } | null>
  /** Resultado y su archivo abierto para leer (el llamador lo cierra), o null si falta. */
  open(mesaId: MesaId, resultId: ResultId): Promise<{ result: Result; handle: FileHandle; size: number } | null>
  /** IDs de los resultados cuyo archivo no está. */
  missing(mesaId: MesaId): Promise<ResultId[]>
  close(): void
}

interface Watched {
  readonly mesaId: MesaId
  readonly dir: string
  watcher: FSWatcher | null
  timer: NodeJS.Timeout | null
  running: Promise<void> | null
  again: boolean
  closed: boolean
  /** Tamaño y fecha de cada archivo candidato y desde cuándo no cambian. */
  readonly observed: Map<string, { signature: string; since: number }>
  /** Resultados sin archivo en la última revisión (para avisar solo si cambia). */
  missing: string
}

export function createResultsWatcher(options: ResultsWatcherOptions): ResultsWatcher {
  const debounceMs = options.debounceMs ?? 250
  const stableMs = options.stableMs ?? 600
  let current: Watched | null = null
  /** Sube con cada `watch` y cada parada: una preparación que ya no es la última no instala nada. */
  let generation = 0

  async function resultsDir(mesaId: MesaId): Promise<string> {
    return resultsDirIn(await options.workFolder(mesaId))
  }

  function schedule(state: Watched, delayMs: number): void {
    if (state.closed) {
      return
    }
    clearTimeout(state.timer ?? undefined)
    state.timer = setTimeout(() => {
      state.timer = null
      void reconcile(state)
    }, delayMs)
  }

  /** Una revisión a la vez; un aviso durante la revisión pide otra al terminar. */
  function reconcile(state: Watched): Promise<void> {
    if (state.running) {
      state.again = true
      return state.running
    }
    state.running = scan(state)
      .catch((error: unknown) => {
        log('results-scan-failed', { message: error instanceof Error ? error.message : String(error) })
      })
      .finally(() => {
        state.running = null
        if (state.again && !state.closed) {
          state.again = false
          void reconcile(state)
        }
      })
    return state.running
  }

  async function scan(state: Watched): Promise<void> {
    if (state.closed) {
      return
    }
    const entries = await readdir(state.dir, { withFileTypes: true })
    const now = Date.now()
    /** Archivos importables presentes (clave → nombre en disco), escritos del todo o no. */
    const present = new Map<string, string>()
    /** Escritos del todo: sin cambios durante `stableMs`, con su fecha de modificación. */
    const stable = new Map<string, { name: string; mtimeMs: number }>()
    let pending = false
    for (const entry of entries) {
      // Solo archivos normales: ni carpetas ni enlaces simbólicos se importan.
      if (!entry.isFile() || !isImportableName(entry.name)) {
        continue
      }
      const info = await lstat(join(state.dir, entry.name)).catch(() => null)
      if (!info?.isFile()) {
        continue
      }
      present.set(fileKey(entry.name), entry.name)
      const signature = `${info.size}:${info.mtimeMs}`
      const seen = state.observed.get(entry.name)
      if (seen?.signature !== signature) {
        state.observed.set(entry.name, { signature, since: now })
        pending = true
      } else if (now - seen.since >= stableMs) {
        stable.set(fileKey(entry.name), { name: entry.name, mtimeMs: info.mtimeMs })
      } else {
        pending = true
      }
    }
    for (const name of state.observed.keys()) {
      if (!present.has(fileKey(name))) {
        state.observed.delete(name)
      }
    }
    if (pending) {
      // Aún se está escribiendo o se acaba de ver: se vuelve a mirar cuando haya pasado el intervalo.
      schedule(state, stableMs)
    }

    const mesa = await options.store.get(state.mesaId)
    if (state.closed) {
      return
    }
    const known = new Set([...mesa.results.map(result => result.file), ...mesa.dismissedResults].map(fileKey))
    const fresh = [...stable.entries()]
      .filter(([key]) => !known.has(key))
      .map(([, file]) => file.name)
      .sort((a, b) => a.localeCompare(b, 'es'))
    // El archivo cambió después de la última actualización de su tarjeta: la vista previa se renueva.
    const touch = mesa.results
      .filter(result => (stable.get(fileKey(result.file))?.mtimeMs ?? 0) > Date.parse(result.updatedAt))
      .map(result => result.id)
    // Un descarte dura mientras el archivo siga ahí: si desaparece, un archivo nuevo con ese nombre vuelve a la mesa.
    const undismiss = mesa.dismissedResults.filter(file => !present.has(fileKey(file)))
    let changed = false
    if (fresh.length > 0 || touch.length > 0 || undismiss.length > 0) {
      const positions = placeNewResults(mesa, fresh.length)
      const { added, touched } = await options.store.reconcileResults(state.mesaId, {
        add: fresh.map((file, index) => ({ file, kind: resultKindOf(file), position: positions[index]! })),
        touch,
        undismiss,
      })
      if (added.length > 0 || touched.length > 0) {
        changed = true
        log('results-reconciled', { added: added.length, touched: touched.length })
      }
    }
    const missing = mesa.results
      .filter(result => !present.has(fileKey(result.file)))
      .map(result => result.id)
      .join()
    if (missing !== state.missing) {
      state.missing = missing
      changed = true
    }
    if (changed && !state.closed) {
      options.onChanged(state.mesaId)
    }
  }

  function stop(): void {
    generation += 1
    if (!current) {
      return
    }
    current.closed = true
    current.watcher?.close()
    clearTimeout(current.timer ?? undefined)
    current = null
  }

  async function findResult(mesaId: MesaId, resultId: ResultId): Promise<Result> {
    const mesa = await options.store.get(mesaId)
    const result = mesa.results.find(candidate => candidate.id === resultId)
    if (!result) {
      throw new Error('El resultado no existe')
    }
    return result
  }

  return {
    async watch(mesaId) {
      if (current && current.mesaId === mesaId) {
        await reconcile(current)
        return
      }
      stop()
      const ticket = generation
      if (mesaId === null) {
        return
      }
      const dir = await resultsDir(mesaId)
      // Mientras se preparaba la carpeta se pidió otra mesa o dejar de vigilar.
      if (ticket !== generation) {
        return
      }
      const state: Watched = {
        mesaId,
        dir,
        watcher: null,
        timer: null,
        running: null,
        again: false,
        closed: false,
        observed: new Map(),
        missing: '',
      }
      current = state
      try {
        state.watcher = watch(dir, { persistent: false }, () => schedule(state, debounceMs))
        state.watcher.on('error', error => {
          log('results-watch-failed', { message: error.message })
          state.watcher?.close()
          state.watcher = null
        })
      } catch (error) {
        log('results-watch-failed', { message: error instanceof Error ? error.message : String(error) })
      }
      await reconcile(state)
    },

    async resolve(mesaId, resultId) {
      const result = await findResult(mesaId, resultId)
      const entry = await resultEntry(await resultsDir(mesaId), result.file)
      return entry ? { result, entry } : null
    },

    async open(mesaId, resultId) {
      const result = await findResult(mesaId, resultId)
      const entry = await resultEntry(await resultsDir(mesaId), result.file)
      const opened = entry ? await openEntry(entry) : null
      return opened ? { result, ...opened } : null
    },

    async missing(mesaId) {
      const mesa = await options.store.get(mesaId)
      if (mesa.results.length === 0) {
        return []
      }
      const dir = await resultsDir(mesaId)
      const entries = await Promise.all(mesa.results.map(result => resultEntry(dir, result.file)))
      return mesa.results.filter((_result, index) => entries[index] === null).map(result => result.id)
    },

    close: stop,
  }
}
