import { MAX_WEB_TEXT, MAX_WEB_WAIT_MS, type WebToolName } from '../../shared/agentTools'
import { DEFAULT_CARD_SIZE, type AgentNotionMode, type Card, type CardId, type Mesa, type MesaId } from '../../shared/model'
import { recognizeService, serviceById } from '../../shared/services'
import { isHttpUrl, parseHttpUrl, parseId } from '../../shared/validate'
import type { MesaStore } from '../store/types'
import { isLocalUrl, type AgentPage } from '../web/agentPages'
import { click, parseKey, parseUid, pressKey, scroll, snapshot, typeText, waitForText } from '../web/webDriver'
import type { ActivityTracker } from './activity'
import { checkKeys, placement, type AgentConfirmation, type TableToolContext, type TableToolHandler } from './tableTools'
import { ToolContent } from './toolContent'

/**
 * Herramientas web del MCP de Table (D-021, T-012): el agente usa las webs de
 * las tarjetas de la mesa de su sesión, con las sesiones de Table y a la
 * vista de la persona. Reglas, en este orden y antes de tocar ninguna web:
 * - la tarjeta es de la mesa de la sesión y su URL es http(s);
 * - Notion solo con «Notion para el agente: MCP completo» (D-019: una
 *   captura enseñaría presupuestos), también si la web llegó a Notion
 *   navegando;
 * - JavaScript y consola, solo en webs locales (`localhost`, `127.0.0.1`,
 *   `[::1]`): en las demás leerían datos de la cuenta de la persona;
 * - la mesa está abierta en Table (lo que hace el agente se ve);
 * - la persona dio permiso a esta sesión (se pregunta una vez por sesión).
 * Cada herramienta enciende la luz de actividad en la tarjeta.
 */

/** Tras un «no» de la persona, Table no vuelve a preguntar a esa sesión durante este tiempo. */
export const WEB_DENIAL_MS = 2 * 60_000
const LOAD_TIMEOUT_MS = 15_000
const DEFAULT_WAIT_MS = 10_000
const DEFAULT_SCROLL_PX = 600
const MAX_ACTIVITY_TEXT = 120

const MESA_CLOSED =
  'La mesa de esta sesión no está abierta en Table: lo que haces en sus webs tiene que verse. Pide a la persona que la abra y vuelve a intentarlo.'
const DENIED =
  'La persona no autorizó a esta sesión a usar las webs de la mesa. No insistas; si te lo pide, vuelve a intentarlo y Table le preguntará otra vez.'
const NOTION_BLOCKED =
  'Las webs de Notion no están disponibles para el agente en esta mesa («Notion para el agente: archivos filtrados»): usa notion/ y table_get_project.'
const LOCAL_ONLY =
  'Solo en webs locales (localhost, 127.0.0.1, [::1]): en las demás webs el agente usa la sesión de la persona y esto leería datos de su cuenta.'
const MODE_CHANGED = 'La configuración de Notion de esta mesa está cambiando o cambió durante la petición; vuelve a intentarlo.'

export interface WebToolDeps {
  readonly store: MesaStore
  /** La mesa está abierta en la ventana: la interfaz la muestra y sus webs pueden cargarse. */
  isMesaOpen(mesaId: MesaId): boolean
  /**
   * Carga (si hace falta) la web de la tarjeta sin mostrarla y la devuelve
   * para esta operación (con `signal` cancelada no envía más comandos); la
   * tarjeta ya tiene actividad (fijada).
   */
  openPage(mesaId: MesaId, cardId: CardId, url: string, signal: AbortSignal): Promise<AgentPage>
  readonly activity: ActivityTracker
  /** Pregunta a la persona; true si acepta. */
  confirm(request: AgentConfirmation, signal: AbortSignal): Promise<boolean>
  /** El agente cambió la mesa (una tarjeta nueva). */
  changed(mesaId: MesaId, notice: string): void
  now?: () => number
}

export interface WebTools {
  readonly handlers: Readonly<Record<WebToolName, TableToolHandler>>
  /** La sesión terminó: se olvida su permiso. */
  endSession(sessionId: string): void
  /** Revoca las peticiones de la mesa y bloquea nuevas hasta persistir y releer el modo. */
  withNotionModeChange<T>(mesaId: MesaId, change: () => Promise<T>): Promise<T>
}

type Grant = { readonly state: 'granted' } | { readonly state: 'denied'; readonly until: number } | { readonly state: 'asking'; readonly answer: Promise<boolean> }

interface MesaPolicy {
  mode: AgentNotionMode
  changing: number
  revision: number
  readonly requests: Map<AbortController, string>
}

function isNotion(url: string): boolean {
  return recognizeService(url).id === 'notion'
}

function cardIn(mesa: Mesa, value: unknown): Card {
  const id = parseId(value)
  const card = mesa.cards.find(candidate => candidate.id === id)
  if (!card) {
    throw new Error(`La tarjeta ${id} no está en la mesa de esta sesión`)
  }
  return card
}

function optionalBoolean(value: unknown, label: string): boolean {
  if (value === undefined) {
    return false
  }
  if (typeof value !== 'boolean') {
    throw new Error(`${label}: true o false`)
  }
  return value
}

function boundedText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.length > max) {
    throw new Error(`${label}: texto de hasta ${max} caracteres`)
  }
  return value
}

function optionalNumber(value: unknown, label: string, min: number, max: number, fallback: number): number {
  if (value === undefined) {
    return fallback
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label}: un número entre ${min} y ${max}`)
  }
  return value
}

/** `node-id` de Figma («12:34» o «12-34») como en la API («12:34»). */
function parseNodeId(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null
  }
  if (typeof value !== 'string' || !/^[0-9]{1,12}[:-][0-9]{1,12}$/.test(value)) {
    throw new Error('nodeId: un node-id de Figma como «12:34» o «12-34»')
  }
  return value.replace('-', ':')
}

/** Texto del aviso, en una línea y sin caracteres de control. */
function activityText(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null
  }
  const text = boundedText(value, 'text', MAX_ACTIVITY_TEXT)
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text === '' ? null : text
}

function pageSummary(page: AgentPage): { url: string; title: string } {
  return { url: page.url(), title: page.title() }
}

export function createWebToolHandlers(deps: WebToolDeps): WebTools {
  const { store, activity } = deps
  const now = deps.now ?? Date.now
  const grants = new Map<string, Grant>()
  const policies = new Map<MesaId, MesaPolicy>()

  function policyFor(mesaId: MesaId): MesaPolicy {
    let policy = policies.get(mesaId)
    if (!policy) {
      policy = { mode: 'files', changing: 0, revision: 0, requests: new Map() }
      policies.set(mesaId, policy)
    }
    return policy
  }

  /** Nunca autoriza con la Mesa leída antes de una espera de permiso, carga o turno. */
  async function currentMesa(context: TableToolContext): Promise<Mesa> {
    context.signal.throwIfAborted()
    const policy = policyFor(context.mesaId)
    if (policy.changing > 0) {
      throw new Error(MODE_CHANGED)
    }
    const mesa = await store.get(context.mesaId)
    context.signal.throwIfAborted()
    if (policy.changing > 0) {
      throw new Error(MODE_CHANGED)
    }
    policy.mode = mesa.agentNotion
    if (!deps.isMesaOpen(mesa.id)) {
      throw new Error(MESA_CLOSED)
    }
    return mesa
  }

  /** Permiso de la sesión: se pregunta una vez y se recuerda hasta que termina. */
  async function requirePermission(context: TableToolContext): Promise<void> {
    context.signal.throwIfAborted()
    const grant = grants.get(context.sessionId)
    if (grant?.state === 'granted') {
      return
    }
    if (grant?.state === 'denied' && now() < grant.until) {
      throw new Error(DENIED)
    }
    if (grant?.state === 'asking') {
      if (!(await grant.answer)) {
        throw new Error(DENIED)
      }
      return
    }
    const answer = deps.confirm(
      {
        mesaId: context.mesaId,
        agentName: context.agentName,
        kind: 'web',
        title: `¿Dejar que ${context.agentName} use las webs de esta mesa con tus sesiones?`,
        items: [],
        note: 'El agente abrirá, mirará y usará las webs de las tarjetas (Figma, Pinterest, cualquier web) con tus sesiones iniciadas en Table, a la vista: la tarjeta se ilumina mientras trabaja. Solo en webs locales (localhost) podrá ejecutar JavaScript y leer la consola. Vale para esta sesión hasta que se cierre.',
        confirmLabel: 'Permitir',
      },
      context.signal,
    )
    const asking: Grant = { state: 'asking', answer }
    grants.set(context.sessionId, asking)
    let accepted = false
    try {
      accepted = await answer
    } finally {
      if (grants.get(context.sessionId) === asking) {
        if (context.signal.aborted) {
          // Una respuesta tardía no recupera un permiso de una petición revocada.
          grants.delete(context.sessionId)
        } else if (accepted) {
          grants.set(context.sessionId, { state: 'granted' })
        } else {
          grants.set(context.sessionId, { state: 'denied', until: now() + WEB_DENIAL_MS })
        }
      }
    }
    if (!accepted) {
      throw new Error(DENIED)
    }
  }

  /** Reglas que no dependen de la web cargada: Notion y webs locales. */
  function checkUrl(mesa: Mesa, url: string, local: boolean): void {
    if (isNotion(url) && mesa.agentNotion !== 'mcp') {
      throw new Error(NOTION_BLOCKED)
    }
    if (local && !isLocalUrl(url)) {
      throw new Error(LOCAL_ONLY)
    }
  }

  /**
   * Las mismas reglas sobre la web tal como está ahora: el documento principal
   * y todos sus frames (una captura enseñaría un iframe de Notion). Se
   * comprueba antes de actuar y otra vez después: si la web llegó a un sitio
   * prohibido durante la operación, su resultado se descarta.
   */
  function checkPage(mesa: Mesa, page: AgentPage, local: boolean): void {
    const current = page.url()
    if (current !== '') {
      checkUrl(mesa, current, local)
    }
    for (const frame of page.frameUrls()) {
      if (isHttpUrl(frame)) {
        checkUrl(mesa, frame, false)
      }
    }
  }

  /** Comprueba las reglas, pide permiso, enciende la luz y da la web cargada de la tarjeta. */
  async function withPage<T>(
    context: TableToolContext,
    card: Card,
    mesa: Mesa,
    local: boolean,
    run: (page: AgentPage, check: () => Promise<void>) => Promise<T>,
  ): Promise<T> {
    let url = parseHttpUrl(card.url)
    checkUrl(mesa, url, local)
    await requirePermission(context)
    const current = await currentMesa(context)
    url = parseHttpUrl(cardIn(current, card.id).url)
    checkUrl(current, url, local)
    const done = activity.beginWeb({ sessionId: context.sessionId, mesaId: mesa.id, agentName: context.agentName }, card.id)
    try {
      const page = await deps.openPage(mesa.id, card.id, url, context.signal)
      context.signal.throwIfAborted()
      const policy = policyFor(mesa.id)
      // La política permanece viva mientras haya actividad, también después de esta petición.
      page.restrict(target => isNotion(target) && (policy.changing > 0 || policy.mode !== 'mcp'))
      return await page.exclusive(async () => {
        const check = async (): Promise<void> => {
          const latest = await currentMesa(context)
          checkUrl(latest, parseHttpUrl(cardIn(latest, card.id).url), local)
          checkPage(latest, page, local)
        }
        // Lecturas, navegaciones y secuencias de entrada comparten el turno de la web real.
        await check()
        await page.waitForLoad(LOAD_TIMEOUT_MS, context.signal)
        await check()
        const result = await run(page, check)
        await check()
        return result
      })
    } finally {
      done()
    }
  }

  async function forCard<T>(
    context: TableToolContext,
    input: Readonly<Record<string, unknown>>,
    local: boolean,
    run: (page: AgentPage, check: () => Promise<void>) => Promise<T>,
  ): Promise<T> {
    const mesa = await currentMesa(context)
    return withPage(context, cardIn(mesa, input['cardId']), mesa, local, run)
  }

  const handlers: Record<WebToolName, TableToolHandler> = {
    async table_web_open(context, input) {
      checkKeys(input, ['cardId', 'url'])
      if ((input['cardId'] === undefined) === (input['url'] === undefined)) {
        throw new Error('Indica cardId o url (uno de los dos)')
      }
      let mesa = await currentMesa(context)
      let card: Card | undefined
      let created = false
      if (input['url'] !== undefined) {
        const url = parseHttpUrl(input['url'])
        checkUrl(mesa, url, false)
        card = mesa.cards.find(candidate => candidate.url === url)
        if (!card) {
          if (!deps.isMesaOpen(mesa.id)) {
            throw new Error(MESA_CLOSED)
          }
          // La tarjeta se crea solo con permiso: sin él, el agente no toca la mesa por esta vía.
          await requirePermission(context)
          mesa = await currentMesa(context)
          checkUrl(mesa, url, false)
          card = await store.addCard(mesa.id, { url, serviceId: recognizeService(url).id, position: placement(mesa, {}, DEFAULT_CARD_SIZE) })
          created = true
          deps.changed(mesa.id, 'El agente añadió una tarjeta')
          mesa = await currentMesa(context)
        }
      } else {
        card = cardIn(mesa, input['cardId'])
      }
      const opened = card
      return withPage(context, opened, mesa, false, async page => {
        return {
          cardId: opened.id,
          service: serviceById(opened.serviceId).name,
          created,
          ...pageSummary(page),
          message: 'Abierta en Table, a la vista de la persona. Usa table_web_snapshot para ver su contenido.',
        }
      })
    },

    async table_web_navigate(context, input) {
      checkKeys(input, ['cardId', 'url', 'action'])
      if ((input['url'] === undefined) === (input['action'] === undefined)) {
        throw new Error('Indica url o action (uno de los dos)')
      }
      const action = input['action']
      if (action !== undefined && action !== 'back' && action !== 'forward' && action !== 'reload') {
        throw new Error('action: back, forward o reload')
      }
      const mesa = await currentMesa(context)
      const card = cardIn(mesa, input['cardId'])
      const url = input['url'] === undefined ? null : parseHttpUrl(input['url'])
      if (url !== null) {
        checkUrl(mesa, url, false)
      }
      const target = url !== null ? { url } : { action: action as 'back' | 'forward' | 'reload' }
      return withPage(context, card, mesa, false, async (page, check) => {
        if (url !== null) {
          checkUrl(await currentMesa(context), url, false)
        }
        const outcome = await page.navigate(target)
        if (outcome.kind === 'blocked') {
          throw new Error(
            'La web avisa de cambios sin guardar: Table no navega para no perderlos. Pide a la persona que los guarde o los descarte.',
          )
        }
        if (outcome.kind === 'failed') {
          throw new Error(`No se pudo navegar: ${outcome.error}`)
        }
        await page.waitForLoad(LOAD_TIMEOUT_MS, context.signal)
        await check()
        return pageSummary(page)
      })
    },

    async table_web_snapshot(context, input) {
      checkKeys(input, ['cardId'])
      return forCard(context, input, false, page => snapshot(page, pageSummary(page)))
    },

    async table_web_screenshot(context, input) {
      checkKeys(input, ['cardId'])
      return forCard(context, input, false, async page => {
        const jpeg = await page.capture()
        if (!jpeg) {
          throw new Error('No se pudo capturar la web (aún sin pintar o sin tamaño); inténtalo de nuevo en un momento')
        }
        const { url, title } = pageSummary(page)
        return new ToolContent([
          { type: 'image', data: jpeg.toString('base64'), mimeType: 'image/jpeg' },
          { type: 'text', text: `Captura de «${title}» — ${url}` },
        ])
      })
    },

    async table_web_click(context, input) {
      checkKeys(input, ['cardId', 'uid', 'dblClick'])
      const uid = String(input['uid'])
      parseUid(uid)
      const double = optionalBoolean(input['dblClick'], 'dblClick')
      return forCard(context, input, false, async page => {
        await click(page, uid, double)
        await page.settle(context.signal)
        return { clicked: uid, ...pageSummary(page) }
      })
    },

    async table_web_type(context, input) {
      checkKeys(input, ['cardId', 'uid', 'text', 'submit'])
      const uid = String(input['uid'])
      parseUid(uid)
      const text = boundedText(input['text'], 'text', MAX_WEB_TEXT)
      const submit = optionalBoolean(input['submit'], 'submit')
      return forCard(context, input, false, async page => {
        await typeText(page, uid, text, submit)
        await page.settle(context.signal)
        return { typed: uid, submitted: submit, ...pageSummary(page) }
      })
    },

    async table_web_press_key(context, input) {
      checkKeys(input, ['cardId', 'key'])
      parseKey(input['key'])
      return forCard(context, input, false, async page => {
        await pressKey(page, input['key'])
        await page.settle(context.signal)
        return { pressed: input['key'], ...pageSummary(page) }
      })
    },

    async table_web_scroll(context, input) {
      checkKeys(input, ['cardId', 'uid', 'direction', 'amount'])
      const direction = input['direction']
      if (direction !== 'up' && direction !== 'down' && direction !== 'left' && direction !== 'right') {
        throw new Error('direction: up, down, left o right')
      }
      const uid = input['uid'] === undefined ? null : String(input['uid'])
      if (uid !== null) {
        parseUid(uid)
      }
      const amount = optionalNumber(input['amount'], 'amount', 1, 10_000, DEFAULT_SCROLL_PX)
      return forCard(context, input, false, async page => {
        await scroll(page, uid, direction, amount)
        return { scrolled: direction, amount, ...pageSummary(page) }
      })
    },

    async table_web_wait_for(context, input) {
      checkKeys(input, ['cardId', 'text', 'timeoutMs'])
      const text = boundedText(input['text'], 'text', 1_000)
      if (text.trim() === '') {
        throw new Error('text: el texto que esperas ver')
      }
      const timeoutMs = optionalNumber(input['timeoutMs'], 'timeoutMs', 100, MAX_WEB_WAIT_MS, DEFAULT_WAIT_MS)
      return forCard(context, input, false, async (page, check) => {
        // Si la web llega durante la espera a un sitio que el agente no puede ver, la espera se corta.
        const found = await waitForText(page, text, timeoutMs, context.signal, check)
        return found
          ? { found: true, ...pageSummary(page) }
          : { found: false, ...pageSummary(page), message: `«${text}» no apareció en ${timeoutMs} ms` }
      })
    },

    async table_web_evaluate(context, input) {
      checkKeys(input, ['cardId', 'function'])
      const source = boundedText(input['function'], 'function', MAX_WEB_TEXT)
      if (source.trim() === '') {
        throw new Error('function: una función como «() => document.title»')
      }
      return forCard(context, input, true, async page => ({ result: await page.evaluateLocal(source), ...pageSummary(page) }))
    },

    async table_web_console(context, input) {
      checkKeys(input, ['cardId'])
      return forCard(context, input, true, async page => ({
        ...pageSummary(page),
        console: page.consoleEntries(),
        networkErrors: page.networkErrors(),
        note: 'La consola, desde que cargó la página; los errores de red, desde que el agente usa la web (table_web_navigate con action reload para verlos desde el principio).',
      }))
    },

    async table_set_activity(context, input) {
      checkKeys(input, ['cardId', 'nodeId', 'text'])
      let mesa = await currentMesa(context)
      const card = cardIn(mesa, input['cardId'])
      const nodeId = parseNodeId(input['nodeId'])
      const text = activityText(input['text'])
      // La luz puede hacer que Table abra la tarjeta (seguir al agente) con las sesiones de la persona:
      // las mismas reglas y el mismo permiso que las herramientas web.
      checkUrl(mesa, parseHttpUrl(card.url), false)
      await requirePermission(context)
      mesa = await currentMesa(context)
      checkUrl(mesa, parseHttpUrl(cardIn(mesa, card.id).url), false)
      const lit = activity.announce({ sessionId: context.sessionId, mesaId: mesa.id, agentName: context.agentName }, card.id, nodeId, text)
      return {
        cardId: lit.cardId,
        nodeId: lit.nodeId,
        lit: true,
        message: 'La tarjeta se ilumina en Table. Llama a table_clear_activity al terminar.',
      }
    },

    async table_clear_activity(context, input) {
      checkKeys(input, [])
      return { cleared: activity.clear(context.sessionId) }
    },
  }

  const guarded = Object.fromEntries(
    Object.entries(handlers).map(([name, handler]) => [name, async (context: TableToolContext, input: Readonly<Record<string, unknown>>) => {
      const policy = policyFor(context.mesaId)
      context.signal.throwIfAborted()
      if (policy.changing > 0) {
        throw new Error(MODE_CHANGED)
      }
      const request = new AbortController()
      const signal = AbortSignal.any([context.signal, request.signal])
      policy.requests.set(request, context.sessionId)
      try {
        const result = await handler({ ...context, signal }, input)
        signal.throwIfAborted()
        return result
      } finally {
        policy.requests.delete(request)
      }
    }]),
  ) as Record<WebToolName, TableToolHandler>
  // Apagar la luz no usa ninguna web y sigue disponible durante la transición.
  guarded.table_clear_activity = handlers.table_clear_activity

  return {
    handlers: guarded,
    endSession(sessionId) {
      grants.delete(sessionId)
      for (const policy of policies.values()) {
        for (const [request, owner] of policy.requests) {
          if (owner === sessionId) {
            request.abort(new Error('La sesión del agente terminó'))
          }
        }
      }
    },
    async withNotionModeChange(mesaId, change) {
      const policy = policyFor(mesaId)
      policy.changing += 1
      policy.revision += 1
      policy.mode = 'files'
      for (const [request, sessionId] of policy.requests) {
        grants.delete(sessionId)
        request.abort(new Error(MODE_CHANGED))
      }
      try {
        return await change()
      } finally {
        // Si coinciden varios cambios, una lectura antigua no sustituye al último modo persistido.
        const revision = ++policy.revision
        try {
          const latest = await store.get(mesaId)
          if (policy.revision === revision) {
            policy.mode = latest.agentNotion
          }
        } catch (error) {
          if (policy.revision === revision) {
            policy.mode = 'files'
          }
          throw error
        } finally {
          policy.changing -= 1
        }
      }
    },
  }
}
