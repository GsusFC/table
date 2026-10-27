import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeFileAtomic } from './files'

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
})
