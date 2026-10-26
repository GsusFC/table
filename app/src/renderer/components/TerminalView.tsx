import { useEffect, useLayoutEffect, useRef } from 'react'
import type { SessionId } from '../../shared/terminal'
import { mountTerminal, scaleTerminal } from '../lib/terminals'

interface TerminalViewProps {
  readonly sessionId: SessionId
  readonly className?: string
  /** Escala de la letra: el zoom del lienzo en una tarjeta, 1 en el panel. */
  readonly fontScale?: number
}

/**
 * Hueco donde se ve el terminal de una sesión. El terminal es siempre el mismo:
 * al montarse aquí se mueve su elemento desde donde estuviera (panel o tarjeta).
 */
export function TerminalView({ sessionId, className, fontScale = 1 }: TerminalViewProps) {
  const ref = useRef<HTMLDivElement>(null)
  const fontScaleRef = useRef(fontScale)
  fontScaleRef.current = fontScale
  useLayoutEffect(() => {
    const container = ref.current
    return container ? mountTerminal(sessionId, container, fontScaleRef.current) : undefined
  }, [sessionId])
  useEffect(() => {
    scaleTerminal(sessionId, fontScale)
  }, [sessionId, fontScale])
  return <div ref={ref} className={className ? `terminal-view ${className}` : 'terminal-view'} />
}
