import { randomUUID } from 'node:crypto'
import { chmod, mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Escribe en un temporal del mismo directorio y lo renombra: nunca deja un
 * archivo a medias. Con `mode`, el archivo queda con esos permisos (sin
 * depender de la umask), también al sustituir uno que ya existía. La cancelación
 * se admite hasta iniciar el rename, que es el punto de confirmación.
 */
export async function writeFileAtomic(path: string, data: string | Buffer, options?: { readonly mode?: number; readonly signal?: AbortSignal }): Promise<void> {
  options?.signal?.throwIfAborted()
  const dir = dirname(path)
  await mkdir(dir, { recursive: true })
  options?.signal?.throwIfAborted()
  const tmp = join(dir, `.${randomUUID()}.tmp`)
  try {
    await writeFile(tmp, data, options)
    options?.signal?.throwIfAborted()
    if (options?.mode !== undefined) {
      await chmod(tmp, options.mode)
    }
    options?.signal?.throwIfAborted()
    await rename(tmp, path)
  } catch (error) {
    await unlink(tmp).catch(() => undefined)
    throw error
  }
}
