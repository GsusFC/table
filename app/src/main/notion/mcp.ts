import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { NotionConnection, NotionIdentity, SettingsStore } from '../settings/settingsStore'

/** MCP oficial de Notion: OAuth con PKCE y registro dinámico, sin servidor propio ni token pegado. */
export const NOTION_MCP_URL = 'https://mcp.notion.com/mcp'

const CLIENT_NAME = 'Table'
const CALL_TIMEOUT_MS = 20_000
const AUTHORIZE_TIMEOUT_MS = 5 * 60_000

/**
 * Error de Notion con un mensaje apto para la interfaz y los logs: nunca
 * incluye credenciales, la respuesta ni contenido de la ficha.
 */
export class NotionError extends Error {
  constructor(
    message: string,
    readonly code: 'unauthorized' | 'not-found' | 'offline' | 'unexpected' | 'cancelled',
  ) {
    super(message)
    this.name = 'NotionError'
  }
}

function clientMetadata(redirectUri: string): OAuthClientMetadata {
  return {
    client_name: CLIENT_NAME,
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }
}

function connectClient(): Client {
  return new Client({ name: 'table', version: '0.1.0' })
}

/** Texto de la primera respuesta de una herramienta; error de Notion si la herramienta falló. */
function toolText(result: unknown): string {
  const { content, isError } = result as { content?: { type?: string; text?: string }[]; isError?: boolean }
  const text = (content ?? []).map(part => (part.type === 'text' ? (part.text ?? '') : '')).join('\n')
  if (isError) {
    // Notion indica el motivo en el cuerpo (`object_not_found`, `validation_error`…); no se copia.
    throw /object_not_found|validation_error|restricted_resource/.test(text)
      ? new NotionError('La página no existe o tu cuenta de Notion no tiene acceso', 'not-found')
      : new NotionError('Notion respondió con un error', 'unexpected')
  }
  return text
}

function mapFailure(error: unknown): NotionError {
  if (error instanceof NotionError) {
    return error
  }
  if (error instanceof UnauthorizedError) {
    return new NotionError('La conexión con Notion caducó: vuelve a conectar en Ajustes', 'unauthorized')
  }
  return new NotionError('Sin conexión con Notion', 'offline')
}

export interface NotionMcp {
  /** Llama a una herramienta de solo lectura y devuelve su texto. */
  read(tool: 'notion-fetch', args: Record<string, unknown>): Promise<string>
}

/**
 * Conexión con la cuenta guardada en Ajustes. Los tokens renovados por el SDK
 * se guardan cifrados. Si caducan del todo, hay que volver a conectar.
 */
export function createNotionMcp(settings: SettingsStore, serverUrl: () => string = () => NOTION_MCP_URL): NotionMcp {
  let session: { revision: number; client: Promise<Client> } | null = null

  function provider(connection: NotionConnection): OAuthClientProvider {
    let current = connection
    const info = connection.client as OAuthClientInformationMixed & { redirect_uris?: string[] }
    const redirect = info.redirect_uris?.[0] ?? 'http://127.0.0.1/callback'
    return {
      get redirectUrl() {
        return redirect
      },
      get clientMetadata() {
        return clientMetadata(redirect)
      },
      clientInformation: () => current.client as OAuthClientInformationMixed,
      saveClientInformation: async client => {
        current = { ...current, client }
        await settings.updateNotionConnection(current)
      },
      tokens: () => current.tokens as OAuthTokens | undefined,
      saveTokens: async tokens => {
        current = { ...current, tokens }
        await settings.updateNotionConnection(current)
      },
      // Sin interacción: si la renovación falla, el usuario reconecta desde Ajustes.
      redirectToAuthorization: () => {
        throw new UnauthorizedError('Hay que volver a conectar Notion')
      },
      saveCodeVerifier: () => undefined,
      codeVerifier: () => {
        throw new UnauthorizedError('Hay que volver a conectar Notion')
      },
    }
  }

  function client(): Promise<Client> {
    const revision = settings.revision()
    if (session?.revision === revision) {
      return session.client
    }
    const previous = session
    session = null
    void previous?.client.then(old => old.close()).catch(() => undefined)
    const connection = settings.notionConnection()
    if (!connection) {
      return Promise.reject(new NotionError('Notion no está conectado', 'unauthorized'))
    }
    const created = connectClient()
    const ready = created
      .connect(new StreamableHTTPClientTransport(new URL(serverUrl()), { authProvider: provider(connection) }))
      .then(() => created)
    const entry = { revision, client: ready }
    session = entry
    // Un fallo al conectar no se queda en caché: el siguiente intento vuelve a probar.
    ready.catch(() => {
      if (session === entry) {
        session = null
      }
    })
    return ready
  }

  return {
    async read(tool, args) {
      try {
        const connected = await client()
        return toolText(await connected.callTool({ name: tool, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS }))
      } catch (error) {
        // Una sesión rota (red caída, servidor reiniciado) se descarta para reconectar la próxima vez.
        if (!(error instanceof NotionError)) {
          session = null
        }
        throw mapFailure(error)
      }
    },
  }
}

/**
 * «Conectar con Notion»: abre el navegador para autorizar a Table, recibe el
 * código en un puerto local de un solo uso y devuelve las credenciales y quién
 * se conectó. Se cancela con `signal` o a los 5 minutos.
 */
export async function authorizeNotion(
  openExternal: (url: string) => Promise<void>,
  signal: AbortSignal,
  serverUrl: string = NOTION_MCP_URL,
): Promise<{ connection: NotionConnection; identity: NotionIdentity }> {
  const callback = await startCallbackServer()
  const state = randomBytes(16).toString('hex')
  let clientInfo: OAuthClientInformationMixed | undefined
  let tokens: OAuthTokens | undefined
  let verifier: string | undefined
  const authProvider: OAuthClientProvider = {
    get redirectUrl() {
      return callback.redirectUri
    },
    get clientMetadata() {
      return clientMetadata(callback.redirectUri)
    },
    state: () => state,
    clientInformation: () => clientInfo,
    saveClientInformation: info => {
      clientInfo = info
    },
    tokens: () => tokens,
    saveTokens: next => {
      tokens = next
    },
    redirectToAuthorization: async url => {
      await openExternal(url.toString())
    },
    saveCodeVerifier: next => {
      verifier = next
    },
    codeVerifier: () => {
      if (!verifier) {
        throw new Error('Falta el verificador PKCE')
      }
      return verifier
    },
  }

  try {
    const first = new StreamableHTTPClientTransport(new URL(serverUrl), { authProvider })
    try {
      await connectClient().connect(first)
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) {
        throw error
      }
      const code = await callback.waitForCode(state, signal)
      await first.finishAuth(code)
    }
    const client = connectClient()
    await client.connect(new StreamableHTTPClientTransport(new URL(serverUrl), { authProvider }))
    const self = JSON.parse(toolText(await client.callTool({ name: 'notion-get-self', arguments: {} }, undefined, { timeout: CALL_TIMEOUT_MS }))) as {
      workspace?: { name?: unknown }
      user?: { name?: unknown }
    }
    await client.close()
    if (!clientInfo || !tokens) {
      throw new NotionError('Notion no completó la autorización', 'unexpected')
    }
    return {
      connection: { client: clientInfo, tokens },
      identity: {
        workspaceName: typeof self.workspace?.name === 'string' && self.workspace.name ? self.workspace.name : null,
        userName: typeof self.user?.name === 'string' && self.user.name ? self.user.name : null,
      },
    }
  } catch (error) {
    throw error instanceof NotionError ? error : mapFailure(error)
  } finally {
    callback.close()
  }
}

interface CallbackServer {
  readonly redirectUri: string
  waitForCode(state: string, signal: AbortSignal): Promise<string>
  close(): void
}

const CALLBACK_PAGE = `<!doctype html><meta charset="utf-8"><title>Table</title>
<body style="font:15px -apple-system,system-ui,sans-serif;padding:48px;color:#1f1f1d">
<p>Listo. Ya puedes volver a Table y cerrar esta pestaña.</p></body>`

/** Servidor en 127.0.0.1 con un puerto libre, solo para recibir el código de autorización. */
async function startCallbackServer(): Promise<CallbackServer> {
  let deliver: ((params: URLSearchParams) => void) | null = null
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/callback') {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(CALLBACK_PAGE)
    deliver?.(url.searchParams)
  })
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
  await promise
  const { port } = server.address() as AddressInfo

  return {
    redirectUri: `http://127.0.0.1:${port}/callback`,
    waitForCode(state, signal) {
      return new Promise((resolveCode, rejectCode) => {
        const timer = setTimeout(() => finish(new NotionError('Se acabó el tiempo para autorizar en Notion', 'cancelled')), AUTHORIZE_TIMEOUT_MS)
        const onAbort = (): void => finish(new NotionError('Conexión cancelada', 'cancelled'))
        const finish = (result: string | Error): void => {
          clearTimeout(timer)
          signal.removeEventListener('abort', onAbort)
          deliver = null
          if (typeof result === 'string') {
            resolveCode(result)
          } else {
            rejectCode(result)
          }
        }
        signal.addEventListener('abort', onAbort, { once: true })
        deliver = params => {
          const code = params.get('code')
          if (params.get('state') !== state) {
            finish(new NotionError('Respuesta de autorización no válida', 'unexpected'))
          } else if (code) {
            finish(code)
          } else {
            finish(new NotionError('No se autorizó el acceso en Notion', 'cancelled'))
          }
        }
        if (signal.aborted) {
          onAbort()
        }
      })
    },
    close() {
      server.close()
    },
  }
}
