import type { WebContents } from 'electron'

/**
 * Política de navegación mientras un agente usa una web (T-012): las URLs que
 * no puede ver (Notion con «archivos filtrados») no se abren en ningún frame,
 * redirección ni popup de esa web (`guards.ts` la aplica). La comparten la
 * vista y sus popups; sin agente (`blocked` null) la persona navega como
 * siempre.
 */
export interface NavigationPolicy {
  blocked: ((url: string) => boolean) | null
}

const policies = new WeakMap<WebContents, NavigationPolicy>()

/** Política de una vista de tarjeta (o de uno de sus popups). */
export function navigationPolicy(contents: WebContents): NavigationPolicy {
  let policy = policies.get(contents)
  if (!policy) {
    policy = { blocked: null }
    policies.set(contents, policy)
  }
  return policy
}

/** Un popup comparte la política de la web que lo abrió. */
export function sharePolicy(contents: WebContents, policy: NavigationPolicy): void {
  policies.set(contents, policy)
}
