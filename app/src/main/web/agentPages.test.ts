import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgentPages } from './agentPages'
import { navigationPolicy } from './navigationPolicy'

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
})
