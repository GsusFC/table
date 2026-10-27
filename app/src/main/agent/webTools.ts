import { MAX_WEB_TEXT, MAX_WEB_WAIT_MS, type WebToolName } from '../../shared/agentTools'
import { DEFAULT_CARD_SIZE, type Card, type CardId, type Mesa, type MesaId } from '../../shared/model'
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
}

type Grant = { readonly state: 'granted' } | { readonly state: 'denied'; readonly until: number } | { readonly state: 'asking'; readonly answer: Promise<boolean> }

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

  /** Permiso de la sesión: se pregunta una vez y se recuerda hasta que termina. */
  async function requirePermission(context: TableToolContext): Promise<void> {
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
    grants.set(context.sessionId, { state: 'asking', answer })
    let accepted = false
    try {
      accepted = await answer
    } finally {
      if (accepted) {
        grants.set(context.sessionId, { state: 'granted' })
      } else if (context.signal.aborted) {
        // Sin respuesta de la persona (sesión cerrada, petición cancelada): la próxima vez se pregunta.
        grants.delete(context.sessionId)
      } else {
        grants.set(context.sessionId, { state: 'denied', until: now() + WEB_DENIAL_MS })
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
    run: (page: AgentPage, check: () => void) => Promise<T>,
  ): Promise<T> {
    const url = parseHttpUrl(card.url)
    checkUrl(mesa, url, local)
    if (!deps.isMesaOpen(mesa.id)) {
      throw new Error(MESA_CLOSED)
    }
    await requirePermission(context)
    context.signal.throwIfAborted()
    const done = activity.beginWeb({ sessionId: context.sessionId, mesaId: mesa.id, agentName: context.agentName }, card.id)
    try {
      const page = await deps.openPage(mesa.id, card.id, url, context.signal)
      // Mientras el agente usa la web, ni navegaciones, ni redirecciones, ni frames, ni popups a lo que no puede ver.
      page.restrict(target => isNotion(target) && mesa.agentNotion !== 'mcp')
      // Una web que se acaba de cargar (o que sigue cargando) se espera antes de mirarla o tocarla.
      await page.waitForLoad(LOAD_TIMEOUT_MS, context.signal)
      const check = (): void => {
        context.signal.throwIfAborted()
        checkPage(mesa, page, local)
      }
      check()
      const result = await run(page, check)
      check()
      return result
    } finally {
      done()
    }
  }

  async function forCard<T>(
    context: TableToolContext,
    input: Readonly<Record<string, unknown>>,
    local: boolean,
    run: (page: AgentPage, check: () => void) => Promise<T>,
  ): Promise<T> {
    const mesa = await store.get(context.mesaId)
    return withPage(context, cardIn(mesa, input['cardId']), mesa, local, run)
  }

  const handlers: Record<WebToolName, TableToolHandler> = {
    async table_web_open(context, input) {
      checkKeys(input, ['cardId', 'url'])
      if ((input['cardId'] === undefined) === (input['url'] === undefined)) {
        throw new Error('Indica cardId o url (uno de los dos)')
      }
      let mesa = await store.get(context.mesaId)
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
          card = await store.addCard(mesa.id, { url, serviceId: recognizeService(url).id, position: placement(mesa, {}, DEFAULT_CARD_SIZE) })
          created = true
          deps.changed(mesa.id, 'El agente añadió una tarjeta')
          mesa = await store.get(mesa.id)
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
      const mesa = await store.get(context.mesaId)
      const card = cardIn(mesa, input['cardId'])
      const url = input['url'] === undefined ? null : parseHttpUrl(input['url'])
      if (url !== null) {
        checkUrl(mesa, url, false)
      }
      const target = url !== null ? { url } : { action: action as 'back' | 'forward' | 'reload' }
      return withPage(context, card, mesa, false, async page => {
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
        const reached = page.url()
        // Si la navegación acabó en Notion, se dice, pero no se enseña nada de ella.
        if (reached !== '') {
          checkUrl(mesa, reached, false)
        }
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
      const mesa = await store.get(context.mesaId)
      const card = cardIn(mesa, input['cardId'])
      const nodeId = parseNodeId(input['nodeId'])
      const text = activityText(input['text'])
      // La luz puede hacer que Table abra la tarjeta (seguir al agente) con las sesiones de la persona:
      // las mismas reglas y el mismo permiso que las herramientas web.
      checkUrl(mesa, parseHttpUrl(card.url), false)
      await requirePermission(context)
      context.signal.throwIfAborted()
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

  return {
    handlers,
    endSession(sessionId) {
      grants.delete(sessionId)
    },
  }
}
