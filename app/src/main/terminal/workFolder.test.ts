import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWorkFolders, sanitizeSegment } from './workFolder'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

let base: string
let root: string
let file: string

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'table-folders-'))
  root = join(base, 'Table')
  file = join(base, 'work-folders.json')
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('sanitizeSegment', () => {
  it('convierte el nombre en un único segmento de ruta', () => {
    expect(sanitizeSegment('Cliente / Campaña: 2026')).toBe('Cliente - Campaña- 2026')
    expect(sanitizeSegment('../../etc')).toBe('etc')
    expect(sanitizeSegment('a\\b\u0000c')).toBe('a-b-c')
  })

  it('no deja carpetas ocultas, especiales ni con punto final', () => {
    expect(sanitizeSegment('.oculta')).toBe('oculta')
    expect(sanitizeSegment('..')).toBe('')
    expect(sanitizeSegment('   ')).toBe('')
    expect(sanitizeSegment('final. ')).toBe('final')
  })

  it('limita la longitud sin partir emojis', () => {
    const long = sanitizeSegment('🙂'.repeat(100))
    expect(Array.from(long)).toHaveLength(80)
    expect(long.endsWith('🙂')).toBe(true)
  })
})

describe('carpetas de trabajo', () => {
  it('crea la carpeta con el nombre saneado o, si no queda nada, con el ID', async () => {
    const folders = createWorkFolders(file, root)
    const path = await folders.folderFor(A, 'Branding')
    expect(path).toBe(join(root, 'Branding'))
    expect(existsSync(path)).toBe(true)
    expect(await folders.folderFor(B, '...')).toBe(join(root, B))
  })

  it('nunca da la misma carpeta a dos mesas, aunque una se llame como el sufijo de otra', async () => {
    const folders = createWorkFolders(file, root)
    const [first, second] = await Promise.all([folders.folderFor(A, 'Proyecto'), folders.folderFor(B, 'proyecto')])
    expect(first).toBe(join(root, 'Proyecto'))
    expect(second).toBe(join(root, 'proyecto (22222222)'))
    const third = await folders.folderFor(C, 'Proyecto (22222222)')
    expect(new Set([first, second, third].map(path => path.toLowerCase())).size).toBe(3)
  })

  it('no reutiliza una carpeta que ya existe en disco', async () => {
    await mkdir(join(root, 'Proyecto'), { recursive: true })
    await writeFile(join(root, 'Proyecto', 'ajeno.txt'), 'x')
    expect(await createWorkFolders(file, root).folderFor(A, 'Proyecto')).toBe(join(root, 'Proyecto (11111111)'))
  })

  it('cada mesa conserva su carpeta al renombrarla, al reabrir Table y al borrar otra mesa', async () => {
    const folders = createWorkFolders(file, root)
    await folders.folderFor(A, 'Proyecto')
    const second = await folders.folderFor(B, 'Proyecto')
    expect(await folders.folderFor(A, 'Otro nombre')).toBe(join(root, 'Proyecto'))

    await folders.forget(A)
    const reopened = createWorkFolders(file, root)
    expect(await reopened.folderFor(B, 'Proyecto')).toBe(second)
    // La carpeta de la mesa borrada sigue en disco: una mesa nueva no la hereda.
    expect(await reopened.folderFor(C, 'Proyecto')).not.toBe(join(root, 'Proyecto'))
  })

  it('descarta asignaciones dañadas del archivo', async () => {
    await writeFile(file, JSON.stringify({ version: 1, folders: { [A]: '../fuera', [B]: 'Bueno', [C]: 'bueno' } }))
    const folders = createWorkFolders(file, root)
    expect(await folders.folderFor(B, 'x')).toBe(join(root, 'Bueno'))
    expect(await folders.folderFor(A, 'Fuera')).toBe(join(root, 'Fuera'))
    expect(await folders.folderFor(C, 'bueno')).toBe(join(root, 'bueno (33333333)'))
  })

  it('rechaza una carpeta de mesa cambiada por un enlace simbólico (p. ej. a la carpeta personal)', async () => {
    const folders = createWorkFolders(file, root)
    const path = await folders.folderFor(A, 'Proyecto')
    await expect(folders.verify(path)).resolves.toBeUndefined()
    const home = join(base, 'casa')
    await mkdir(join(home, '.gemini'), { recursive: true })
    await rm(path, { recursive: true })
    await symlink(home, path)
    await expect(folders.folderFor(A, 'Proyecto')).rejects.toThrow('no es una carpeta normal')
    await expect(folders.verify(path)).rejects.toThrow('no es una carpeta normal')
    await expect(folders.verify(join(home, '.gemini'))).rejects.toThrow('no es una carpeta normal')
  })
})
