import { mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import type * as FileSystem from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeFileAtomic } from './files'

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof FileSystem>()
  return { ...actual, writeFile: vi.fn(actual.writeFile), rename: vi.fn(actual.rename) }
})

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'table-files-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('writeFileAtomic', () => {
  it('con `mode`, el archivo nuevo o sustituido queda con esos permisos, sin depender de la umask', async () => {
    const path = join(dir, 'config.json')
    await writeFileAtomic(path, '{}', { mode: 0o600 })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    await writeFile(path, 'antes', { mode: 0o644 })
    await writeFileAtomic(path, '{"a":1}', { mode: 0o400 })
    expect((await stat(path)).mode & 0o777).toBe(0o400)
    expect(await readFile(path, 'utf8')).toBe('{"a":1}')
  })

  it.each([false, true])('cancelar con el temporal escrito conserva el destino y limpia el temporal (destino previo: %s)', async existed => {
    const actual = await vi.importActual<typeof FileSystem>('node:fs/promises')
    const path = join(dir, 'config.json')
    if (existed) await writeFile(path, 'anterior')
    const written = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    vi.mocked(writeFile).mockImplementationOnce(async (...args) => {
      await actual.writeFile(...args)
      written.resolve()
      await release.promise
    })
    const controller = new AbortController()
    const pending = writeFileAtomic(path, 'nuevo', { mode: 0o600, signal: controller.signal })
    const rejected = expect(pending).rejects.toThrow('cancelada')
    await written.promise
    controller.abort(new Error('Escritura cancelada'))
    release.resolve()
    await rejected
    if (existed) {
      expect(await readFile(path, 'utf8')).toBe('anterior')
    } else {
      await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    }
    expect(await readdir(dir)).toEqual(existed ? ['config.json'] : [])
  })

  it('una cancelación posterior al rename no revierte una escritura confirmada', async () => {
    const actual = await vi.importActual<typeof FileSystem>('node:fs/promises')
    const path = join(dir, 'config.json')
    await writeFile(path, 'anterior')
    const committed = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    vi.mocked(rename).mockImplementationOnce(async (...args) => {
      await actual.rename(...args)
      committed.resolve()
      await release.promise
    })
    const controller = new AbortController()
    const pending = writeFileAtomic(path, 'confirmado', { signal: controller.signal })
    await committed.promise
    controller.abort()
    release.resolve()
    await pending
    expect(await readFile(path, 'utf8')).toBe('confirmado')
    expect(await readdir(dir)).toEqual(['config.json'])
  })
})
