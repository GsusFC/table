import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WEB_TOOLS, type WebToolName } from '../../shared/agentTools'
import type { Mesa, MesaId } from '../../shared/model'
import { createMesaStore } from '../store/mesaStore'
import type { MesaStore } from '../store/types'
import type { AgentPage, NavigationOutcome } from '../web/agentPages'
import { createActivityTracker, type ActivityTracker } from './activity'
import type { AgentConfirmation } from './tableTools'
import { ToolContent } from './toolContent'
import { createWebToolHandlers, WEB_DENIAL_MS, type WebTools } from './webTools'

const NOTION_URL = 'https://www.notion.so/ficha-0123456789abcdef0123456789abcdef'
const SESSION = 'sesion-a'

let base: string
let store: MesaStore
let web: WebTools
let activity: ActivityTracker
let openMesa: MesaId | null
let answer: boolean
let confirms: AgentConfirmation[]
let opened: string[]
let changes: string[]
let pins: string[]
let unpins: string[]
let now: number
/** URL en la que está la web falsa (tras clics o redirecciones), si no es la de la tarjeta. */
let pageUrl: string | null
/** iframes de la web falsa. */
let frames: string[]
/** Adonde lleva un clic en la web falsa (p. ej. un enlace a Notion). */
let clickLeadsTo: string | null
/** Política de navegación que fijó la herramienta. */
let restricted: ((url: string) => boolean) | null
let navigation: NavigationOutcome
let session: AbortController
let configurePage: ((page: AgentPage, signal: AbortSignal) => AgentPage) | null
let confirmWith: ((signal: AbortSignal) => Promise<boolean>) | null

function fakePage(url: string): AgentPage {
  return {
    exclusive: run => run(),
    send: async <T>(method: string, params?: Record<string, unknown>): Promise<T> => {
      if (method === 'Accessibility.getFullAXTree') {
        return { nodes: [{ nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Prueba' }, backendDOMNodeId: 1 }] } as T
      }
      if (method === 'Page.getFrameTree') {
        // La espera lee el texto de la página: una navegación a mitad la cambia de sitio.
        if (clickLeadsTo) {
          pageUrl = clickLeadsTo
        }
        return { frameTree: { frame: { id: 'principal' } } } as T
      }
      if (method === 'Runtime.evaluate') {
        return { result: { type: 'string', value: 'resultado' } } as T
      }
      if (method === 'DOM.getContentQuads') {
        return { quads: [[0, 0, 10, 0, 10, 10, 0, 10]] } as T
      }
      if (method === 'Input.dispatchMouseEvent' && params?.['type'] === 'mouseReleased' && clickLeadsTo) {
        pageUrl = clickLeadsTo
      }
      return {} as T
    },
    url: () => pageUrl ?? url,
    title: () => 'Prueba',
    waitForLoad: async () => undefined,
    settle: async () => undefined,
    navigate: async () => navigation,
    capture: async () => Buffer.from([1, 2, 3]),
    frameUrls: () => [pageUrl ?? url, ...frames],
    restrict: blocked => {
      restricted = blocked
    },
    evaluateLocal: async () => 'resultado',
    consoleEntries: () => [{ level: 'error', text: 'fallo', source: 'app.js:1' }],
    networkErrors: () => [],
  }
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'table-web-tools-'))
  store = createMesaStore(join(base, 'datos'))
  openMesa = null
  answer = true
  confirms = []
  opened = []
  changes = []
  pins = []
  unpins = []
  now = 1_000_000
  pageUrl = null
  frames = []
  clickLeadsTo = null
  restricted = null
  navigation = { kind: 'started' }
  session = new AbortController()
  configurePage = null
  confirmWith = null
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  activity = createActivityTracker({ onChange: () => undefined, pin: id => pins.push(id), unpin: id => unpins.push(id) })
  web = createWebToolHandlers({
    store,
    isMesaOpen: mesaId => mesaId === openMesa,
    openPage: async (_mesaId, cardId, url, signal) => {
      opened.push(cardId)
      const page = fakePage(url)
      return configurePage ? configurePage(page, signal) : page
    },
    activity,
    confirm: async (request, signal) => {
      confirms.push(request)
      return confirmWith ? confirmWith(signal) : answer
    },
    changed: (_mesaId, notice) => changes.push(notice),
    now: () => now,
  })
})

afterEach(async () => {
  for (const item of activity.list()) {
    activity.endSession(item.sessionId)
  }
  vi.restoreAllMocks()
  await rm(base, { recursive: true, force: true })
})

function call(mesa: Mesa, name: WebToolName, input: Record<string, unknown> = {}, sessionId = SESSION): Promise<any> {
  return web.handlers[name]({ sessionId, mesaId: mesa.id, agentName: 'Claude Code', signal: session.signal }, input)
}

async function mesaWith(url: string, name = 'Mesa web'): Promise<{ mesa: Mesa; cardId: string }> {
  const mesa = await store.create(name)
  const card = await store.addCard(mesa.id, { url, serviceId: url.includes('notion.so') ? 'notion' : 'web', position: { x: 0, y: 0 } })
  openMesa = mesa.id
  return { mesa: await store.get(mesa.id), cardId: card.id }
}

describe('catálogo', () => {
  it('cada herramienta web declarada tiene su ejecución y al revés', () => {
    expect(Object.keys(web.handlers).sort()).toEqual(WEB_TOOLS.map(tool => tool.name).sort())
  })
})

describe('reglas antes de tocar una web', () => {
  it('solo tarjetas de la mesa de la sesión; nada se pregunta ni se abre si no', async () => {
    const { mesa } = await mesaWith('https://example.com/')
    const other = await mesaWith('https://example.org/', 'Otra mesa')
    openMesa = mesa.id
    await expect(call(mesa, 'table_web_snapshot', { cardId: other.cardId })).rejects.toThrow('no está en la mesa de esta sesión')
    await expect(call(mesa, 'table_set_activity', { cardId: other.cardId })).rejects.toThrow('no está en la mesa de esta sesión')
    expect(confirms).toEqual([])
    expect(opened).toEqual([])
  })

  it('solo URL http(s)', async () => {
    const { mesa, cardId } = await mesaWith('https://example.com/')
    await expect(call(mesa, 'table_web_open', { url: 'file:///etc/passwd' })).rejects.toThrow('http(s)')
    await expect(call(mesa, 'table_web_open', { url: 'javascript:alert(1)' })).rejects.toThrow()
    await expect(call(mesa, 'table_web_navigate', { cardId, url: 'chrome://settings' })).rejects.toThrow('http(s)')
    await expect(call(mesa, 'table_web_open', { cardId, url: 'https://example.com/' })).rejects.toThrow('uno de los dos')
    expect(opened).toEqual([])
  })

  it('con la mesa cerrada en Table no se usa ninguna web', async () => {
    const { mesa, cardId } = await mesaWith('https://example.com/')
    openMesa = null
    await expect(call(mesa, 'table_web_snapshot', { cardId })).rejects.toThrow('no está abierta en Table')
    await expect(call(mesa, 'table_web_open', { url: 'https://example.net/' })).rejects.toThrow('no está abierta en Table')
    expect(confirms).toEqual([])
    expect((await store.get(mesa.id)).cards).toHaveLength(1)
  })

  it('Notion: rechazado con «archivos filtrados» (también si la web llega a Notion), permitido con «MCP completo»', async () => {
    const { mesa, cardId } = await mesaWith(NOTION_URL)
    await expect(call(mesa, 'table_web_snapshot', { cardId })).rejects.toThrow('Notion')
    await expect(call(mesa, 'table_web_open', { url: NOTION_URL })).rejects.toThrow('Notion')
    await expect(call(mesa, 'table_web_open', { url: 'https://acme.notion.site/pagina-0123456789abcdef0123456789abcdef' })).rejects.toThrow(
      'Notion',
    )
    expect(confirms).toEqual([])

    const plain = await mesaWith('https://example.com/', 'Mesa con redirección')
    pageUrl = NOTION_URL
    await expect(call(plain.mesa, 'table_web_screenshot', { cardId: plain.cardId })).rejects.toThrow('Notion')
    await expect(call(plain.mesa, 'table_web_navigate', { cardId: plain.cardId, url: NOTION_URL })).rejects.toThrow('Notion')
    pageUrl = null

    openMesa = mesa.id
    const withMcp = await store.setAgentNotion(mesa.id, 'mcp')
    expect(await call(withMcp, 'table_web_snapshot', { cardId })).toContain('Prueba')
  })

  it('JavaScript y consola solo en webs locales, sin preguntar en las demás', async () => {
    const remote = await mesaWith('https://example.com/')
    await expect(call(remote.mesa, 'table_web_evaluate', { cardId: remote.cardId, function: '() => document.cookie' })).rejects.toThrow(
      'Solo en webs locales',
    )
    await expect(call(remote.mesa, 'table_web_console', { cardId: remote.cardId })).rejects.toThrow('Solo en webs locales')
    expect(confirms).toEqual([])
    // Clic, escritura y foto sí funcionan en una web no local.
    expect(await call(remote.mesa, 'table_web_click', { cardId: remote.cardId, uid: 'e1' })).toMatchObject({ clicked: 'e1' })

    for (const url of ['http://localhost:5173/', 'http://127.0.0.1:8080/', 'http://[::1]:3000/']) {
      const local = await mesaWith(url, `Mesa ${url}`)
      expect(await call(local.mesa, 'table_web_evaluate', { cardId: local.cardId, function: '() => 1' })).toMatchObject({ result: 'resultado' })
      expect(await call(local.mesa, 'table_web_console', { cardId: local.cardId })).toMatchObject({ console: [{ text: 'fallo' }] })
    }

    // Una tarjeta local cuya web ya está en otro sitio: rechazado.
    const moved = await mesaWith('http://localhost:4000/', 'Mesa movida')
    pageUrl = 'https://example.com/'
    await expect(call(moved.mesa, 'table_web_evaluate', { cardId: moved.cardId, function: '() => 1' })).rejects.toThrow('Solo en webs locales')
    // `localhost.example.com` no es local.
    pageUrl = null
    const lookalike = await mesaWith('http://localhost.example.com/', 'Mesa parecida')
    await expect(call(lookalike.mesa, 'table_web_console', { cardId: lookalike.cardId })).rejects.toThrow('Solo en webs locales')
  })

  it('valida la entrada antes de pedir permiso', async () => {
    const { mesa, cardId } = await mesaWith('https://example.com/')
    await expect(call(mesa, 'table_web_click', { cardId, uid: 'boton' })).rejects.toThrow('uid')
    await expect(call(mesa, 'table_web_press_key', { cardId, key: 'Hyper+A' })).rejects.toThrow('Modificador')
    await expect(call(mesa, 'table_web_scroll', { cardId, direction: 'sideways' })).rejects.toThrow('direction')
    await expect(call(mesa, 'table_web_snapshot', { cardId, extra: true })).rejects.toThrow('Campo no admitido')
    await expect(call(mesa, 'table_set_activity', { cardId, nodeId: '12;34' })).rejects.toThrow('nodeId')
    expect(confirms).toEqual([])
  })
})

describe('permiso por sesión', () => {
  it('la primera vez pregunta nombrando al agente; aceptado, no vuelve a preguntar a esa sesión', async () => {
    const { mesa, cardId } = await mesaWith('https://example.com/')
    await call(mesa, 'table_web_snapshot', { cardId })
    await call(mesa, 'table_web_screenshot', { cardId })
    expect(confirms).toHaveLength(1)
    expect(confirms[0]).toMatchObject({
      kind: 'web',
      mesaId: mesa.id,
      title: '¿Dejar que Claude Code use las webs de esta mesa con tus sesiones?',
      confirmLabel: 'Permitir',
    })
    // Otra sesión pregunta de nuevo.
    await call(mesa, 'table_web_snapshot', { cardId }, 'sesion-b')
    expect(confirms).toHaveLength(2)
    // Al terminar la sesión se olvida.
    web.endSession(SESSION)
    await call(mesa, 'table_web_snapshot', { cardId })
    expect(confirms).toHaveLength(3)
  })

  it('sin permiso no se toca la web; tras un «no» no insiste durante un rato', async () => {
    const { mesa, cardId } = await mesaWith('https://example.com/')
    answer = false
    await expect(call(mesa, 'table_web_snapshot', { cardId })).rejects.toThrow('no autorizó')
    await expect(call(mesa, 'table_web_click', { cardId, uid: 'e1' })).rejects.toThrow('no autorizó')
    expect(confirms).toHaveLength(1)
    expect(opened).toEqual([])
    expect(activity.list()).toEqual([])
    now += WEB_DENIAL_MS + 1
    answer = true
    expect(await call(mesa, 'table_web_snapshot', { cardId })).toContain('Prueba')
    expect(confirms).toHaveLength(2)
  })

  it('una pregunta cancelada no cuenta como «no» ni conserva una aceptación tardía', async () => {
    const { mesa, cardId } = await mesaWith('https://example.com/')
    const asking = Promise.withResolvers<void>()
    const permission = Promise.withResolvers<boolean>()
    confirmWith = async () => {
      asking.resolve()
      return permission.promise
    }
    const pending = call(mesa, 'table_web_snapshot', { cardId })
    await asking.promise
    session.abort(new Error('Petición cancelada'))
    permission.resolve(true)
    await expect(pending).rejects.toThrow('Petición cancelada')
    session = new AbortController()
    confirmWith = null
    expect(await call(mesa, 'table_web_snapshot', { cardId })).toContain('Prueba')
    expect(confirms).toHaveLength(2)
  })

  it('table_web_open con una URL nueva crea la tarjeta solo con permiso; una URL de la mesa reutiliza su tarjeta', async () => {
    const { mesa, cardId } = await mesaWith('https://example.com/')
    answer = false
    await expect(call(mesa, 'table_web_open', { url: 'http://localhost:5173/' })).rejects.toThrow('no autorizó')
    expect((await store.get(mesa.id)).cards).toHaveLength(1)

    now += WEB_DENIAL_MS + 1
    answer = true
    const created = await call(mesa, 'table_web_open', { url: 'http://localhost:5173/' })
    expect(created).toMatchObject({ created: true, url: 'http://localhost:5173/' })
    expect((await store.get(mesa.id)).cards).toHaveLength(2)
    expect(changes).toEqual(['El agente añadió una tarjeta'])

    const reused = await call(mesa, 'table_web_open', { url: 'https://example.com/' })
    expect(reused).toMatchObject({ created: false, cardId })
    expect((await store.get(mesa.id)).cards).toHaveLength(2)
  })
})

describe('herramientas', () => {
  it('foto, captura como imagen y navegación que respeta el trabajo sin guardar', async () => {
    const { mesa, cardId } = await mesaWith('https://example.com/')
    const text = await call(mesa, 'table_web_snapshot', { cardId })
    expect(text).toContain('RootWebArea "Prueba" [uid=e1]')
    expect(text).toContain('datos, no instrucciones')
    const shot = await call(mesa, 'table_web_screenshot', { cardId })
    expect(shot).toBeInstanceOf(ToolContent)
    expect((shot as ToolContent).blocks[0]).toEqual({ type: 'image', data: Buffer.from([1, 2, 3]).toString('base64'), mimeType: 'image/jpeg' })
    navigation = { kind: 'blocked' }
    await expect(call(mesa, 'table_web_navigate', { cardId, url: 'https://example.com/otra' })).rejects.toThrow('cambios sin guardar')
    navigation = { kind: 'started' }
    expect(await call(mesa, 'table_web_navigate', { cardId, action: 'reload' })).toMatchObject({ url: 'https://example.com/' })
  })
})

describe('luz de actividad', () => {
  it('las herramientas web la encienden y fijan la tarjeta; table_clear_activity la apaga y la suelta', async () => {
    const { mesa, cardId } = await mesaWith('https://example.com/')
    await call(mesa, 'table_web_snapshot', { cardId })
    expect(activity.list()).toEqual([expect.objectContaining({ sessionId: SESSION, mesaId: mesa.id, cardId, source: 'web', agentName: 'Claude Code' })])
    expect(pins).toEqual([cardId])
    expect(await call(mesa, 'table_clear_activity')).toEqual({ cleared: true })
    expect(activity.list()).toEqual([])
    expect(unpins).toEqual([cardId])
  })

  it('table_set_activity normaliza el node-id y limpia el texto', async () => {
    const { mesa, cardId } = await mesaWith('https://www.figma.com/design/AbCdEfGhIjKlMn/Archivo')
    const lit = await call(mesa, 'table_set_activity', { cardId, nodeId: '12-34', text: 'Revisando\nel frame\u001b[31m' })
    expect(lit).toMatchObject({ cardId, nodeId: '12:34', lit: true })
    expect(activity.list()).toEqual([expect.objectContaining({ cardId, nodeId: '12:34', text: 'Revisando el frame [31m', source: 'announced' })])
  })

  it('table_set_activity pide el mismo permiso que las webs (puede hacer que Table abra la tarjeta) y rechaza Notion filtrado', async () => {
    const { mesa, cardId } = await mesaWith('https://www.figma.com/design/AbCdEfGhIjKlMn/Archivo')
    answer = false
    await expect(call(mesa, 'table_set_activity', { cardId })).rejects.toThrow('no autorizó')
    expect(confirms).toHaveLength(1)
    expect(activity.list()).toEqual([])

    const notion = await mesaWith(NOTION_URL, 'Mesa con Notion')
    await expect(call(notion.mesa, 'table_set_activity', { cardId: notion.cardId }, 'sesion-c')).rejects.toThrow('Notion')
    expect(confirms).toHaveLength(1)
    expect(activity.list()).toEqual([])
  })
})

describe('la política dura toda la operación', () => {
  it('mientras actúa, la web no puede navegar a Notion (política fijada en la web); en «MCP completo», sí', async () => {
    const { mesa, cardId } = await mesaWith('https://example.com/')
    await call(mesa, 'table_web_snapshot', { cardId })
    expect(restricted?.(NOTION_URL)).toBe(true)
    expect(restricted?.('https://example.com/otra')).toBe(false)
    const withMcp = await store.setAgentNotion(mesa.id, 'mcp')
    await call(withMcp, 'table_web_snapshot', { cardId })
    expect(restricted?.(NOTION_URL)).toBe(false)
  })

  it('un clic que acaba en Notion no devuelve éxito', async () => {
    const { mesa, cardId } = await mesaWith('https://example.com/')
    clickLeadsTo = NOTION_URL
    await expect(call(mesa, 'table_web_click', { cardId, uid: 'e1' })).rejects.toThrow('Notion')
  })

  it('una espera se corta si la web llega a Notion', async () => {
    const { mesa, cardId } = await mesaWith('https://example.com/')
    clickLeadsTo = NOTION_URL
    await expect(call(mesa, 'table_web_wait_for', { cardId, text: 'nunca', timeoutMs: 5_000 })).rejects.toThrow('Notion')
  })

  it('foto y captura se rechazan si un iframe es de Notion', async () => {
    const { mesa, cardId } = await mesaWith('https://example.com/')
    frames = ['about:blank', NOTION_URL]
    await expect(call(mesa, 'table_web_snapshot', { cardId })).rejects.toThrow('Notion')
    await expect(call(mesa, 'table_web_screenshot', { cardId })).rejects.toThrow('Notion')
  })

  it('una web local que navega fuera: JavaScript y consola se rechazan', async () => {
    const { mesa, cardId } = await mesaWith('http://localhost:5173/')
    clickLeadsTo = 'https://example.com/'
    await expect(call(mesa, 'table_web_click', { cardId, uid: 'e1' })).resolves.toMatchObject({ clicked: 'e1' })
    await expect(call(mesa, 'table_web_evaluate', { cardId, function: '() => 1' })).rejects.toThrow('Solo en webs locales')
    await expect(call(mesa, 'table_web_console', { cardId })).rejects.toThrow('Solo en webs locales')
  })
})

describe('revocación por cambios del modo de Notion', () => {
  it('relee el store tras cargar: una Mesa antigua con MCP no autoriza la foto ni una petición futura', async () => {
    const { mesa, cardId } = await mesaWith(NOTION_URL)
    await store.setAgentNotion(mesa.id, 'mcp')
    const waiting = Promise.withResolvers<void>()
    const loaded = Promise.withResolvers<void>()
    const read = vi.fn()
    configurePage = page => ({
      ...page,
      send: async <T>(): Promise<T> => {
        read()
        return { nodes: [{ nodeId: '1', role: { value: 'StaticText' }, name: { value: 'MARCADOR_PRIVADO' } }] } as T
      },
      waitForLoad: async () => {
        waiting.resolve()
        await loaded.promise
      },
    })
    const pending = call(mesa, 'table_web_snapshot', { cardId })
    await waiting.promise
    await store.setAgentNotion(mesa.id, 'files')
    loaded.resolve()
    await expect(pending).rejects.toThrow('Notion')
    expect(read).not.toHaveBeenCalled()
    await expect(call(mesa, 'table_web_snapshot', { cardId })).rejects.toThrow('Notion')
    expect(opened).toEqual([cardId])
    expect(restricted?.(NOTION_URL)).toBe(true)
  })

  it.each(['table_web_snapshot', 'table_web_open', 'table_set_activity'] as const)(
    '%s no conserva una autorización obtenida antes de cambiar el modo mientras esperaba permiso',
    async name => {
      const { mesa, cardId } = await mesaWith(NOTION_URL)
      await store.setAgentNotion(mesa.id, 'mcp')
      const asking = Promise.withResolvers<void>()
      const permission = Promise.withResolvers<boolean>()
      confirmWith = async () => {
        asking.resolve()
        return permission.promise
      }
      const input = name === 'table_web_open' ? { url: `${NOTION_URL}?nueva=1` } : { cardId }
      const pending = call(mesa, name, input)
      await asking.promise
      await store.setAgentNotion(mesa.id, 'files')
      permission.resolve(true)
      await expect(pending).rejects.toThrow('Notion')
      expect(opened).toEqual([])
      expect(activity.list()).toEqual([])
      expect((await store.get(mesa.id)).cards).toHaveLength(1)
    },
  )

  it('revoca la carga pendiente y bloquea peticiones nuevas antes de que termine la persistencia', async () => {
    const { mesa, cardId } = await mesaWith(NOTION_URL)
    await store.setAgentNotion(mesa.id, 'mcp')
    const waiting = Promise.withResolvers<void>()
    const loaded = Promise.withResolvers<void>()
    const save = Promise.withResolvers<void>()
    const signals: AbortSignal[] = []
    const read = vi.fn()
    configurePage = (page, signal) => {
      signals.push(signal)
      return {
        ...page,
        send: <T>(method: string, params?: Record<string, unknown>): Promise<T> => {
          read()
          return page.send<T>(method, params)
        },
        waitForLoad: async () => {
          waiting.resolve()
          await loaded.promise
        },
      }
    }
    const pending = call(mesa, 'table_web_snapshot', { cardId })
    await waiting.promise
    expect(restricted?.(NOTION_URL)).toBe(false)
    const changing = web.withNotionModeChange(mesa.id, async () => {
      await save.promise
      return store.setAgentNotion(mesa.id, 'files')
    })
    expect(signals[0]?.aborted).toBe(true)
    expect(restricted?.(NOTION_URL)).toBe(true)
    expect((await store.get(mesa.id)).agentNotion).toBe('mcp')
    await expect(call(mesa, 'table_web_snapshot', { cardId }, 'nueva')).rejects.toThrow('configuración')
    loaded.resolve()
    await expect(pending).rejects.toThrow('configuración')
    expect(read).not.toHaveBeenCalled()
    save.resolve()
    await changing
    await expect(call(mesa, 'table_web_snapshot', { cardId })).rejects.toThrow('Notion')
  })

  it('el hook revoca permisos pendientes y una aceptación tardía no evita volver a preguntar', async () => {
    const { mesa, cardId } = await mesaWith('https://example.com/')
    const asking = Promise.withResolvers<void>()
    const permission = Promise.withResolvers<boolean>()
    const signals: AbortSignal[] = []
    confirmWith = async signal => {
      signals.push(signal)
      asking.resolve()
      return permission.promise
    }
    const pending = call(mesa, 'table_web_snapshot', { cardId })
    await asking.promise
    await web.withNotionModeChange(mesa.id, () => store.setAgentNotion(mesa.id, 'mcp'))
    expect(signals[0]?.aborted).toBe(true)
    permission.resolve(true)
    await expect(pending).rejects.toThrow('configuración')
    expect(opened).toEqual([])
    confirmWith = null
    await call(mesa, 'table_web_snapshot', { cardId })
    expect(confirms).toHaveLength(2)
  })

  it('al tomar turno vuelve a comprobar el modo antes de leer', async () => {
    const { mesa, cardId } = await mesaWith(NOTION_URL)
    await store.setAgentNotion(mesa.id, 'mcp')
    const queued = Promise.withResolvers<void>()
    const turn = Promise.withResolvers<void>()
    const read = vi.fn()
    configurePage = page => ({
      ...page,
      send: <T>(method: string, params?: Record<string, unknown>): Promise<T> => {
        read()
        return page.send<T>(method, params)
      },
      exclusive: async run => {
        queued.resolve()
        await turn.promise
        return run()
      },
    })
    const pending = call(mesa, 'table_web_snapshot', { cardId })
    await queued.promise
    await store.setAgentNotion(mesa.id, 'files')
    turn.resolve()
    await expect(pending).rejects.toThrow('Notion')
    expect(read).not.toHaveBeenCalled()
  })

  it('cambios simultáneos mantienen el bloqueo hasta el último y actualizan la política de una actividad existente', async () => {
    const { mesa, cardId } = await mesaWith('https://example.com/')
    await store.setAgentNotion(mesa.id, 'mcp')
    await call(mesa, 'table_web_snapshot', { cardId })
    const first = Promise.withResolvers<void>()
    const second = Promise.withResolvers<void>()
    const changingFirst = web.withNotionModeChange(mesa.id, async () => {
      await first.promise
      await store.setAgentNotion(mesa.id, 'files')
    })
    const changingSecond = web.withNotionModeChange(mesa.id, async () => {
      await second.promise
      await store.setAgentNotion(mesa.id, 'mcp')
    })
    second.resolve()
    await changingSecond
    expect(restricted?.(NOTION_URL)).toBe(true)
    await expect(call(mesa, 'table_web_snapshot', { cardId })).rejects.toThrow('configuración')
    first.resolve()
    await changingFirst
    expect(restricted?.(NOTION_URL)).toBe(true)
    await web.withNotionModeChange(mesa.id, () => store.setAgentNotion(mesa.id, 'mcp'))
    expect(restricted?.(NOTION_URL)).toBe(false)
  })

  it('un fallo de persistencia revoca lo anterior y recupera la política del modo realmente guardado', async () => {
    const { mesa, cardId } = await mesaWith('https://example.com/')
    await store.setAgentNotion(mesa.id, 'mcp')
    await call(mesa, 'table_web_snapshot', { cardId })
    await expect(web.withNotionModeChange(mesa.id, async () => {
      throw new Error('EACCES sintético')
    })).rejects.toThrow('EACCES')
    expect(restricted?.(NOTION_URL)).toBe(false)
    expect(await call(mesa, 'table_web_snapshot', { cardId })).toContain('Prueba')
  })
})
