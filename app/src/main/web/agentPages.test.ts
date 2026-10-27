import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgentPages } from './agentPages'
import { navigationPolicy } from './navigationPolicy'
import { typeText } from './webDriver'

/** Lo justo de un `WebContents` para la web del agente, con un depurador falso que anota comandos. */
class FakeContents extends EventEmitter {
  loading = false
  url = 'http://localhost:5173/'
  destroyed = false
  readonly sent: string[] = []
  readonly debugger = Object.assign(new EventEmitter(), {
    attached: false,
    attach: () => {
      this.debugger.attached = true
    },
    detach: () => {
      this.debugger.attached = false
    },
    isAttached: () => this.debugger.attached,
    sendCommand: async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
      this.sent.push(method)
      if (method === 'Runtime.enable') {
        // Como Chromium: al activarlo, anuncia los contextos que ya existen.
        this.debugger.emit('message', {}, 'Runtime.executionContextCreated', {
          context: { id: 7, origin: new URL(this.url).origin, auxData: { isDefault: true, frameId: 'principal' } },
        })
      }
      if (method === 'Page.getFrameTree') {
        return { frameTree: { frame: { id: 'principal' } } }
      }
      if (method === 'Runtime.evaluate') {
        return { result: { type: 'number', value: params?.['contextId'] } }
      }
      return {}
    },
  })
  readonly mainFrame = { framesInSubtree: [{ url: this.url }] }
  isDestroyed(): boolean {
    return this.destroyed
  }
  isLoading(): boolean {
    return this.loading
  }
  getURL(): string {
    return this.url
  }
  getTitle(): string {
    return 'Prueba'
  }
  setBackgroundThrottling(): void {}
}

let contents: FakeContents

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  contents = new FakeContents()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function listeners(): Record<string, number> {
  return Object.fromEntries(['did-stop-loading', 'did-start-loading', 'destroyed'].map(name => [name, contents.listenerCount(name)]))
}

describe('web del agente', () => {
  it('las esperas retiran todas sus escuchas al terminar (carga, tiempo agotado, cancelación)', async () => {
    const pages = createAgentPages()
    const page = pages.page(contents as unknown as WebContents, new AbortController().signal)
    const before = listeners()

    contents.loading = true
    const loaded = page.waitForLoad(5_000, new AbortController().signal)
    contents.emit('did-stop-loading')
    await loaded
    expect(listeners()).toEqual(before)

    const timedOut = page.waitForLoad(5_000, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(5_000)
    await timedOut
    expect(listeners()).toEqual(before)

    contents.loading = false
    const settled = page.settle(new AbortController().signal)
    await vi.advanceTimersByTimeAsync(1_000)
    await settled
    expect(listeners()).toEqual(before)

    const cancel = new AbortController()
    contents.loading = true
    const cancelled = page.waitForLoad(5_000, cancel.signal)
    cancel.abort()
    await cancelled
    expect(listeners()).toEqual(before)
  })

  it('con la operación cancelada no envía comandos ni vuelve a enganchar el depurador', async () => {
    const pages = createAgentPages()
    const operation = new AbortController()
    const page = pages.page(contents as unknown as WebContents, operation.signal)
    await page.send('DOM.enable')
    pages.release(contents as unknown as WebContents)
    expect(contents.debugger.attached).toBe(false)
    operation.abort()
    await expect(page.send('DOM.enable')).rejects.toThrow()
    expect(contents.debugger.attached).toBe(false)
    expect(contents.sent.filter(method => method === 'DOM.enable')).toHaveLength(1)
  })

  it('JavaScript en el contexto del documento local, por su ID; si el documento ya no es local, no se ejecuta', async () => {
    const pages = createAgentPages()
    const page = pages.page(contents as unknown as WebContents, new AbortController().signal)
    // La función devuelve aquí el ID de contexto con el que se ejecutó.
    expect(await page.evaluateLocal('() => 1')).toBe(7)
    // La web navega a otro origen: su contexto desaparece y llega uno remoto.
    contents.debugger.emit('message', {}, 'Runtime.executionContextDestroyed', { executionContextId: 7 })
    contents.debugger.emit('message', {}, 'Runtime.executionContextCreated', {
      context: { id: 8, origin: 'https://example.com', auxData: { isDefault: true, frameId: 'principal' } },
    })
    await expect(page.evaluateLocal('() => 1')).rejects.toThrow('ya no es local')
    expect(contents.sent.filter(method => method === 'Runtime.evaluate')).toHaveLength(1)
  })

  it('la política del agente se fija en la web y se quita al soltarla', () => {
    const pages = createAgentPages()
    const page = pages.page(contents as unknown as WebContents, new AbortController().signal)
    page.restrict(url => url.includes('notion.so'))
    expect(navigationPolicy(contents as unknown as WebContents).blocked?.('https://www.notion.so/x')).toBe(true)
    pages.release(contents as unknown as WebContents)
    expect(navigationPolicy(contents as unknown as WebContents).blocked).toBeNull()
  })

  it('dos handles de la misma web no intercalan foco, selección, escritura ni envío; otras webs siguen libres', async () => {
    const first = createAgentPages().page(contents as unknown as WebContents, new AbortController().signal)
    const second = createAgentPages().page(contents as unknown as WebContents, new AbortController().signal)
    const focused = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    const commands: string[] = []
    const values = new Map<number, string>()
    let focus = 0
    const send = contents.debugger.sendCommand
    vi.spyOn(contents.debugger, 'sendCommand').mockImplementation(async (method, params) => {
      const result = await send(method, params)
      if (method === 'DOM.focus') {
        focus = params?.['backendNodeId'] as number
        commands.push(`foco:${focus}`)
        if (focus === 1) {
          focused.resolve()
          await resume.promise
        }
      } else if (method === 'Input.dispatchKeyEvent' && params?.['commands']) {
        commands.push(`selección:${focus}`)
        values.set(focus, '')
      } else if (method === 'Input.insertText') {
        commands.push(`texto:${focus}`)
        values.set(focus, (values.get(focus) ?? '') + String(params?.['text']))
      } else if (method === 'Input.dispatchKeyEvent' && params?.['key'] === 'Enter') {
        commands.push(`envío:${focus}:${params['type']}`)
      } else if (method === 'Accessibility.getFullAXTree') {
        commands.push('lectura')
      }
      return result
    })
    const one = first.exclusive(() => typeText(first, 'e1', 'uno', true))
    await focused.promise
    const two = second.exclusive(() => typeText(second, 'e2', 'dos', true))
    const read = second.exclusive(() => second.send('Accessibility.getFullAXTree'))
    const other = createAgentPages().page(new FakeContents() as unknown as WebContents, new AbortController().signal)
    await other.exclusive(() => other.send('DOM.enable'))
    expect(commands).toEqual(['foco:1'])
    resume.resolve()
    await Promise.all([one, two, read])
    expect(values).toEqual(new Map([[1, 'uno'], [2, 'dos']]))
    expect(commands).toEqual([
      'foco:1', 'selección:1', 'texto:1', 'envío:1:keyDown', 'envío:1:keyUp',
      'foco:2', 'selección:2', 'texto:2', 'envío:2:keyDown', 'envío:2:keyUp', 'lectura',
    ])
  })

  it('cancelar un turno pendiente lo rechaza ya, sin adelantar los demás ni ejecutar su cuerpo', async () => {
    const pages = createAgentPages()
    const first = pages.page(contents as unknown as WebContents, new AbortController().signal)
    const cancel = new AbortController()
    const second = pages.page(contents as unknown as WebContents, cancel.signal)
    const entered = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    const one = first.exclusive(async () => {
      entered.resolve()
      await resume.promise
    })
    await entered.promise
    const skipped = vi.fn(async () => undefined)
    const two = second.exclusive(skipped)
    const third = vi.fn(async () => undefined)
    const three = first.exclusive(third)
    cancel.abort(new Error('Turno cancelado'))
    await expect(two).rejects.toThrow('Turno cancelado')
    expect(skipped).not.toHaveBeenCalled()
    expect(third).not.toHaveBeenCalled()
    resume.resolve()
    await Promise.all([one, three])
    expect(skipped).not.toHaveBeenCalled()
    expect(third).toHaveBeenCalledOnce()
  })

  it('cancelar responde ya, pero un comando atrasado conserva el turno hasta terminar sin permitir más escritura revocada', async () => {
    const pages = createAgentPages()
    const cancel = new AbortController()
    const first = pages.page(contents as unknown as WebContents, cancel.signal)
    const second = pages.page(contents as unknown as WebContents, new AbortController().signal)
    const focused = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    const send = contents.debugger.sendCommand
    const spy = vi.spyOn(contents.debugger, 'sendCommand').mockImplementation(async (method, params) => {
      if (method === 'DOM.focus' && params?.['backendNodeId'] === 1) {
        focused.resolve()
        await resume.promise
      }
      return send(method, params)
    })
    const one = first.exclusive(() => typeText(first, 'e1', 'revocado', true))
    await focused.promise
    cancel.abort(new Error('Operación revocada'))
    await expect(one).rejects.toThrow('Operación revocada')
    const nextRun = vi.fn(() => typeText(second, 'e2', 'vigente', false))
    const two = second.exclusive(nextRun)
    await Promise.resolve()
    expect(nextRun).not.toHaveBeenCalled()
    expect(spy.mock.calls.filter(([method]) => method === 'Input.insertText')).toEqual([])
    resume.resolve()
    await two
    expect(nextRun).toHaveBeenCalledOnce()
    expect(spy.mock.calls.filter(([method]) => method === 'DOM.focus').map(([, params]) => params?.['backendNodeId'])).toEqual([1, 2])
    expect(spy.mock.calls.filter(([method]) => method === 'Input.insertText').map(([, params]) => params?.['text'])).toEqual(['vigente'])
  })

  it('cancelar durante la espera de carga termina la operación real y deja avanzar al siguiente turno', async () => {
    const pages = createAgentPages()
    const cancel = new AbortController()
    const first = pages.page(contents as unknown as WebContents, cancel.signal)
    const second = pages.page(contents as unknown as WebContents, new AbortController().signal)
    const entered = Promise.withResolvers<void>()
    contents.loading = true
    const one = first.exclusive(async () => {
      entered.resolve()
      await first.waitForLoad(5_000, cancel.signal)
      cancel.signal.throwIfAborted()
    })
    await entered.promise
    const two = second.exclusive(() => second.send('DOM.enable'))
    cancel.abort(new Error('Carga revocada'))
    await expect(one).rejects.toThrow('Carga revocada')
    await two
    expect(contents.sent.filter(method => method === 'DOM.enable')).toHaveLength(1)
    expect(contents.listenerCount('did-stop-loading')).toBe(0)
  })

  it('cancelar una navegación responde ya pero conserva el turno aunque su inicio llegue tarde', async () => {
    const cancel = new AbortController()
    const loading = Promise.withResolvers<void>()
    const requested = Promise.withResolvers<void>()
    const loadURL = vi.fn(async () => {
      requested.resolve()
      await loading.promise
    })
    Object.assign(contents, { loadURL })
    const pages = createAgentPages()
    const first = pages.page(contents as unknown as WebContents, cancel.signal)
    const second = pages.page(contents as unknown as WebContents, new AbortController().signal)
    const pending = first.exclusive(() => first.navigate({ url: 'https://example.com/' }))
    await requested.promise
    cancel.abort(new Error('Navegación revocada'))
    await expect(pending).rejects.toThrow('Navegación revocada')
    const nextRun = vi.fn(() => second.send('DOM.enable'))
    const next = second.exclusive(nextRun)
    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    await Promise.resolve()
    await Promise.resolve()
    expect(nextRun).not.toHaveBeenCalled()
    loading.resolve()
    await next
    expect(nextRun).toHaveBeenCalledOnce()
    expect(contents.listenerCount('did-start-navigation')).toBe(0)
    expect(contents.listenerCount('will-prevent-unload')).toBe(0)
    await expect(first.navigate({ url: 'https://example.org/' })).rejects.toThrow('Navegación revocada')
    expect(loadURL).toHaveBeenCalledOnce()
  })
})
