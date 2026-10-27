import { EventEmitter } from 'node:events'
import type { BrowserWindow, WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSurfaceManager } from './surfaceManager'
import type { SurfaceManager } from './types'

vi.mock('electron', () => ({
  dialog: { showMessageBoxSync: vi.fn(() => 0) },
  WebContentsView: class {
    constructor() {
      const view = new FakeView()
      views.push(view)
      return view
    }
  },
}))
vi.mock('./guards', () => ({
  configureSurfaceSession: vi.fn(),
  guardNavigation: vi.fn(),
  attachContextMenu: vi.fn(),
  SURFACE_PARTITION: 'partición-sintética',
}))

class FakeContents extends EventEmitter {
  destroyed = false
  url = ''
  readonly focus = vi.fn()
  readonly capturePage = vi.fn(async () => ({ isEmpty: (): boolean => true }))
  readonly loadURL = vi.fn(async (url: string) => {
    this.url = url
    this.emit('did-start-navigation', { isMainFrame: true })
    this.emit('did-navigate', {}, url)
    this.emit('did-stop-loading')
  })
  isDestroyed(): boolean {
    return this.destroyed
  }
  isCrashed(): boolean {
    return false
  }
  getURL(): string {
    return this.url
  }
  close(): void {
    this.destroyed = true
    this.emit('destroyed')
  }
}

class FakeView {
  readonly webContents = new FakeContents()
  readonly setBackgroundColor = vi.fn()
  readonly setVisible = vi.fn()
  readonly setBounds = vi.fn()
}

const views: FakeView[] = []
const MESA = 'mesa-sintética'
const FIGMA = 'https://www.figma.com/design/SharedFile/'

function fixture(): SurfaceManager {
  const window = {
    isDestroyed: () => false,
    webContents: { focus: vi.fn() },
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
  } as unknown as BrowserWindow
  return createSurfaceManager(window, {
    onState: vi.fn(),
    onCapture: vi.fn(),
    onTitle: vi.fn(),
    shareKey: url => url.startsWith(FIGMA) ? 'SharedFile' : null,
  })
}

beforeEach(() => {
  views.length = 0
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('carga revocable del agente', () => {
  it('cancelar detrás de una captura rechaza sin esperar y no crea ni navega cuando llega su turno', async () => {
    const manager = fixture()
    await manager.openMesa(MESA)
    await manager.enter(MESA, 'visible', 'https://example.com/visible')
    const capturing = Promise.withResolvers<void>()
    const captured = Promise.withResolvers<{ isEmpty: () => boolean }>()
    views[0]!.webContents.capturePage.mockImplementationOnce(async () => {
      capturing.resolve()
      return captured.promise
    })
    const leaving = manager.exit()
    await capturing.promise
    const cancel = new AbortController()
    const pending = manager.loadForAgent(MESA, 'cancelada', 'https://example.com/cancelada', cancel.signal)
    const next = manager.loadForAgent(MESA, 'vigente', 'https://example.com/vigente', new AbortController().signal)
    cancel.abort(new Error('Sesión cerrada'))
    await expect(pending).rejects.toThrow('Sesión cerrada')
    expect(views).toHaveLength(1)
    expect(views[0]!.webContents.loadURL).toHaveBeenCalledTimes(1)
    captured.resolve({ isEmpty: () => true })
    await leaving
    await next
    expect(manager.loadedContents('cancelada')).toBeNull()
    expect(manager.loadedContents('vigente')).not.toBeNull()
    expect(views.flatMap(view => view.webContents.loadURL.mock.calls.map(([url]) => url))).toEqual([
      'https://example.com/visible', 'https://example.com/vigente',
    ])
    await manager.closeAll()
  })

  it('una señal ya cancelada ni siquiera crea una vista', async () => {
    const manager = fixture()
    await manager.openMesa(MESA)
    const cancel = new AbortController()
    cancel.abort(new Error('Petición revocada'))
    await expect(manager.loadForAgent(MESA, 'cancelada', 'https://example.com/', cancel.signal)).rejects.toThrow('revocada')
    expect(views).toEqual([])
  })

  it('una cesión esperando navegación no cambia de dueña tras la cancelación ni crea una vista alternativa', async () => {
    const manager = fixture()
    await manager.openMesa(MESA)
    const donor = await manager.loadForAgent(MESA, 'donante', `${FIGMA}A`, new AbortController().signal)
    const contents = donor as unknown as FakeContents
    const navigating = Promise.withResolvers<void>()
    const navigated = Promise.withResolvers<void>()
    contents.loadURL.mockImplementationOnce(async () => {
      navigating.resolve()
      await navigated.promise
    })
    const cancel = new AbortController()
    manager.pin('destino')
    const pending = manager.loadForAgent(MESA, 'destino', `${FIGMA}B`, cancel.signal)
    await navigating.promise
    cancel.abort(new Error('Modo revocado'))
    await expect(pending).rejects.toThrow('Modo revocado')
    contents.emit('did-start-navigation', { isMainFrame: true })
    navigated.resolve()
    expect(manager.loadedContents('donante')).toBe(donor)
    expect(manager.loadedContents('destino')).toBeNull()
    expect(views).toHaveLength(1)
    // La cola vuelve a servir una petición vigente; no se hereda la cesión cancelada.
    const fresh = await manager.loadForAgent(MESA, 'destino', `${FIGMA}B`, new AbortController().signal)
    expect(fresh).toBe(donor)
    expect(manager.loadedContents('donante')).toBeNull()
    expect(manager.loadedContents('destino')).toBe(contents as unknown as WebContents)
    await manager.closeAll()
  })
})
