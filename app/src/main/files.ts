import { randomUUID } from 'node:crypto'
import { chmod, mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Escribe en un temporal del mismo directorio y lo renombra: nunca deja un
 * archivo a medias. Con `mode`, el archivo queda con esos permisos (sin
 * depender de la umask), también al sustituir uno que ya existía.
 */
export async function writeFileAtomic(path: string, data: string | Buffer, options?: { readonly mode?: number }): Promise<void> {
  const dir = dirname(path)
  await mkdir(dir, { recursive: true })
  const tmp = join(dir, `.${randomUUID()}.tmp`)
  try {
    await writeFile(tmp, data, options?.mode === undefined ? undefined : { mode: options.mode })
    if (options?.mode !== undefined) {
      await chmod(tmp, options.mode)
    }
    await rename(tmp, path)
  } catch (error) {
    await unlink(tmp).catch(() => undefined)
    throw error
  }
}
