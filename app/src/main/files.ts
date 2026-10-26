import { randomUUID } from 'node:crypto'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** Escribe en un temporal del mismo directorio y lo renombra: nunca deja un archivo a medias. */
export async function writeFileAtomic(path: string, data: string | Buffer): Promise<void> {
  const dir = dirname(path)
  await mkdir(dir, { recursive: true })
  const tmp = join(dir, `.${randomUUID()}.tmp`)
  try {
    await writeFile(tmp, data)
    await rename(tmp, path)
  } catch (error) {
    await unlink(tmp).catch(() => undefined)
    throw error
  }
}
