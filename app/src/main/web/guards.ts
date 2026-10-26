import {
  clipboard,
  dialog,
  Menu,
  session,
  type BrowserWindow,
  type BrowserWindowConstructorOptions,
  type MenuItemConstructorOptions,
  type WebContents,
} from 'electron'
import { isHttpUrl } from '../../shared/validate'
import { log, originOf } from '../log'

/** Sesión compartida por todas las webs de las tarjetas (cookies y logins persistentes). */
export const SURFACE_PARTITION = 'persist:table'

/** Ventana sobre la que se preguntan los permisos; la sesión se configura una sola vez por proceso. */
let permissionParent: BrowserWindow | null = null
let sessionConfigured = false

async function askPermission(origin: string, permission: string): Promise<boolean> {
  const parent = permissionParent
  if (!parent || parent.isDestroyed()) {
    return false
  }
  const { response } = await dialog.showMessageBox(parent, {
    type: 'question',
    buttons: ['Denegar', 'Permitir'],
    defaultId: 0,
    cancelId: 0,
    message: `${origin} solicita el permiso «${permission}».`,
    detail: 'La decisión se recuerda para este origen hasta cerrar Table.',
  })
  return response === 1
}

/**
 * Cada permiso se pregunta y la decisión se recuerda por origen y permiso
 * hasta cerrar Table. Las descargas quedan bloqueadas.
 */
export function configureSurfaceSession(parent: BrowserWindow): void {
  permissionParent = parent
  if (sessionConfigured) {
    return
  }
  sessionConfigured = true
  const surfaceSession = session.fromPartition(SURFACE_PARTITION)
  const decisions = new Map<string, boolean>()
  const pending = new Map<string, Promise<boolean>>()
  const reportedChecks = new Set<string>()

  surfaceSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const origin = originOf(details.requestingUrl)
    const key = `${origin}|${permission}`
    const remembered = decisions.get(key)
    if (remembered !== undefined) {
      callback(remembered)
      return
    }
    // Varias peticiones simultáneas del mismo origen comparten un único diálogo.
    let decision = pending.get(key)
    if (!decision) {
      decision = askPermission(origin, permission)
        .catch(() => false)
        .then(granted => {
          decisions.set(key, granted)
          pending.delete(key)
          log('permission-request', { permission, origin, granted })
          return granted
        })
      pending.set(key, decision)
    }
    void decision.then(callback)
  })
  surfaceSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    const origin = originOf(requestingOrigin)
    const granted = decisions.get(`${origin}|${permission}`) ?? false
    const key = `${origin}|${permission}|${granted}`
    if (!reportedChecks.has(key)) {
      reportedChecks.add(key)
      log('permission-check', { permission, origin, granted })
    }
    return granted
  })
  surfaceSession.on('will-download', (event, item) => {
    log('download-blocked', { origin: originOf(item.getURL()) })
    event.preventDefault()
  })
}

/** Popups de login: ventana real hija, con `window.opener` y la misma sesión. */
function popupWindowOptions(parent: BrowserWindow): BrowserWindowConstructorOptions {
  return {
    parent,
    width: 520,
    height: 720,
    autoHideMenuBar: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  }
}

function schemeOf(url: string): string {
  return `${url.split(':', 1)[0] ?? ''}:`
}

/**
 * Electron no trae menú contextual. Sin él no se puede «Copiar imagen» de
 * Pinterest ni de otras referencias web. Solo copia al portapapeles: las
 * descargas siguen bloqueadas.
 */
export function attachContextMenu(contents: WebContents): void {
  contents.on('context-menu', (_event, params) => {
    const items: MenuItemConstructorOptions[] = []
    if (params.mediaType === 'image' && params.hasImageContents) {
      items.push({
        label: 'Copiar imagen',
        click: () => {
          contents.copyImageAt(params.x, params.y)
          log('image-copied', { origin: originOf(params.srcURL) })
        },
      })
    }
    if (params.mediaType === 'image' && isHttpUrl(params.srcURL)) {
      items.push({ label: 'Copiar dirección de la imagen', click: () => clipboard.writeText(params.srcURL) })
    }
    if (isHttpUrl(params.linkURL)) {
      items.push({ label: 'Copiar enlace', click: () => clipboard.writeText(params.linkURL) })
    }
    if (params.isEditable) {
      items.push(
        { label: 'Cortar', enabled: params.editFlags.canCut, click: () => contents.cut() },
        { label: 'Copiar', enabled: params.editFlags.canCopy, click: () => contents.copy() },
        { label: 'Pegar', enabled: params.editFlags.canPaste, click: () => contents.paste() },
      )
    } else if (params.selectionText.trim().length > 0) {
      items.push({ label: 'Copiar', click: () => contents.copy() })
    }
    if (items.length > 0) {
      Menu.buildFromTemplate(items).popup()
    }
  })
}

/**
 * Navegación limitada a http(s). Los popups http(s) o `about:blank` se abren
 * como ventana hija real, con la misma sesión, para no romper logins que
 * usan `window.opener`. Cada popup recibe las mismas restricciones y se
 * notifica con `onPopup` para que su dueño pueda cerrarlo al descargar.
 */
export function guardNavigation(
  contents: WebContents,
  parent: BrowserWindow,
  onPopup: (popup: BrowserWindow) => void,
): void {
  contents.setWindowOpenHandler(({ url }) => {
    const opened = url === 'about:blank' || isHttpUrl(url)
    const origin = isHttpUrl(url) ? originOf(url) : schemeOf(url)
    log(opened ? 'popup-opened' : 'popup-blocked', { origin })
    return opened ? { action: 'allow', overrideBrowserWindowOptions: popupWindowOptions(parent) } : { action: 'deny' }
  })
  contents.on('did-create-window', popup => {
    guardNavigation(popup.webContents, parent, onPopup)
    attachContextMenu(popup.webContents)
    popup.once('closed', () => log('popup-closed'))
    onPopup(popup)
  })

  const allowOnlyWeb = (event: { preventDefault(): void; url: string }): void => {
    if (!isHttpUrl(event.url)) {
      log('navigation-blocked', { scheme: schemeOf(event.url) })
      event.preventDefault()
    }
  }
  contents.on('will-navigate', allowOnlyWeb)
  contents.on('will-redirect', allowOnlyWeb)
}
