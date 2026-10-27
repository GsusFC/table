import { existsSync, readFileSync } from 'node:fs'
import { lstat, mkdir, realpath } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { MesaId } from '../../shared/model'
import { writeFileAtomic } from '../files'

/** Longitud máxima del nombre de la carpeta (sin el sufijo de desambiguación). */
const MAX_SEGMENT_LENGTH = 80

/**
 * Nombre de la mesa como un único segmento de ruta seguro: sin separadores,
 * caracteres de control ni nombres especiales. Vacío si no queda nada útil.
 */
export function sanitizeSegment(name: string): string {
  const cleaned = name
    .normalize('NFC')
    // `/` separa rutas, `:` es el separador del Finder y `\` confunde a otras herramientas.
    .replace(/[\u0000-\u001f\u007f/\\:]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    // Sin punto inicial (carpeta oculta, `.` o `..`).
    .replace(/^[.\s-]+/, '')
  // Se recorta por puntos de código para no partir caracteres compuestos por pares sustitutos.
  const limited = Array.from(cleaned).slice(0, MAX_SEGMENT_LENGTH).join('')
  return limited.replace(/[.\s]+$/, '')
}

interface WorkFoldersFile {
  readonly version: 1
  /** Carpeta (un segmento dentro de la raíz) asignada a cada mesa. */
  readonly folders: Readonly<Record<MesaId, string>>
}

export interface WorkFolders {
  /**
   * Carpeta de trabajo de la mesa (ruta absoluta), creada si no existe. La
   * primera vez se le asigna una carpeta que no pertenezca a otra mesa ni
   * exista ya en disco; después la conserva aunque la mesa cambie de nombre.
   */
  folderFor(mesaId: MesaId, mesaName: string): Promise<string>
  /** Olvida la asignación de una mesa borrada; la carpeta y sus archivos se quedan. */
  forget(mesaId: MesaId): Promise<void>
  /**
   * Lanza si `folder` no es una carpeta normal (no un enlace simbólico) de un
   * solo segmento cuya ruta real está dentro de la raíz. Antes de escribir
   * configuración en ella: una carpeta cambiada por un enlace a `~` haría que
   * Table editara la configuración global de un arnés.
   */
  verify(folder: string): Promise<void>
}

/** Lanza si `path` no es una carpeta normal directamente dentro de la ruta real de `root`. */
async function checkWorkFolder(path: string, root: string): Promise<void> {
  const refuse = (): never => {
    throw new Error('La carpeta de trabajo de la mesa no es una carpeta normal dentro de la carpeta de Table')
  }
  if (dirname(path) !== root) {
    refuse()
  }
  const stat = await lstat(path)
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    refuse()
  }
  const real = await realpath(path)
  const expected = join(await realpath(root), basename(path))
  // El disco de macOS no distingue mayúsculas: `realpath` puede devolver otra grafía del mismo nombre.
  if (process.platform === 'darwin' ? real.toLowerCase() !== expected.toLowerCase() : real !== expected) {
    refuse()
  }
}

/**
 * Asignación persistente mesa → carpeta en `file`; las carpetas viven en
 * `root` (`~/Table`). Las operaciones van en cola: dos mesas que arrancan a
 * la vez no pueden quedarse con la misma carpeta.
 */
export function createWorkFolders(file: string, root: string): WorkFolders {
  let folders = loadFolders(file)
  let queue: Promise<unknown> = Promise.resolve()

  function enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = queue.then(run)
    queue = next.catch(() => undefined)
    return next
  }

  async function save(next: Record<MesaId, string>): Promise<void> {
    const data: WorkFoldersFile = { version: 1, folders: next }
    await writeFileAtomic(file, `${JSON.stringify(data, null, 2)}\n`)
    folders = next
  }

  /** Sin distinguir mayúsculas, como el disco de macOS. */
  function isFree(segment: string, mesaId: MesaId): boolean {
    const key = segment.toLowerCase()
    const takenByOther = Object.entries(folders).some(([owner, folder]) => owner !== mesaId && folder.toLowerCase() === key)
    return !takenByOther && !existsSync(join(root, segment))
  }

  return {
    folderFor(mesaId, mesaName) {
      return enqueue(async () => {
        let segment = folders[mesaId]
        if (!segment) {
          const base = sanitizeSegment(mesaName) || mesaId
          const short = mesaId.slice(0, 8)
          const candidates = [base, `${base} (${short})`]
          for (let n = 2; !candidates.some(candidate => isFree(candidate, mesaId)); n += 1) {
            candidates.push(`${base} (${short}-${n})`)
          }
          segment = candidates.find(candidate => isFree(candidate, mesaId))!
          // Primero se guarda la asignación: si crear la carpeta falla, la mesa la conserva.
          await save({ ...folders, [mesaId]: segment })
        }
        const path = join(root, segment)
        await mkdir(path, { recursive: true })
        await checkWorkFolder(path, root)
        return path
      })
    },

    forget(mesaId) {
      return enqueue(async () => {
        if (folders[mesaId]) {
          const { [mesaId]: _removed, ...rest } = folders
          await save(rest)
        }
      })
    },

    verify(folder) {
      return checkWorkFolder(folder, root)
    },
  }
}

/** Archivo ausente o ilegible: sin asignaciones. Se descartan entradas que no sean un segmento seguro o repitan carpeta. */
function loadFolders(file: string): Record<MesaId, string> {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<WorkFoldersFile> | null
    if (parsed?.version !== 1 || typeof parsed.folders !== 'object' || parsed.folders === null) {
      return {}
    }
    const folders: Record<MesaId, string> = {}
    const seen = new Set<string>()
    for (const [mesaId, folder] of Object.entries(parsed.folders)) {
      if (typeof folder === 'string' && folder.length > 0 && !/[\u0000-\u001f\u007f/\\:]/.test(folder) && folder !== '.' && folder !== '..' && !seen.has(folder.toLowerCase())) {
        folders[mesaId] = folder
        seen.add(folder.toLowerCase())
      }
    }
    return folders
  } catch {
    return {}
  }
}
