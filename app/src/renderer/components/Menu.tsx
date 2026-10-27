import type { LucideIcon } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'

export interface MenuItem {
  readonly label: string
  readonly icon: LucideIcon
  readonly onSelect: () => void
  readonly danger?: boolean
  readonly hint?: string
  /** Visible pero sin acción (p. ej. un arnés no instalado); se salta con las flechas. */
  readonly disabled?: boolean
  /** Explicación al pasar por encima. */
  readonly title?: string
}

interface MenuProps {
  /** Punto de anclaje en coordenadas de la ventana. */
  readonly anchor: { readonly x: number; readonly y: number }
  /** `end`: el borde derecho del menú se alinea con el ancla. */
  readonly align?: 'start' | 'end'
  readonly label: string
  readonly items: readonly MenuItem[]
  readonly onClose: () => void
}

const EDGE = 8

/**
 * Menú flotante en una capa propia (portal en `body`), fuera del lienzo
 * transformado. Se cierra con Esc, Tab, clic fuera o al perder la ventana el
 * foco, y devuelve el foco a donde estaba.
 */
export function Menu({ anchor, align = 'start', label, items, onClose }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  // Los listeners se instalan una vez y llaman siempre al cierre más reciente.
  const closeRef = useRef(onClose)
  useLayoutEffect(() => {
    closeRef.current = onClose
  })

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }
    const { width, height } = element.getBoundingClientRect()
    const preferredLeft = align === 'end' ? anchor.x - width : anchor.x
    const left = Math.max(EDGE, Math.min(preferredLeft, window.innerWidth - width - EDGE))
    const top = Math.max(EDGE, Math.min(anchor.y, window.innerHeight - height - EDGE))
    setPosition({ left, top })
  }, [anchor.x, anchor.y, align])

  // El primer elemento se enfoca cuando el menú ya está colocado y visible.
  const focused = useRef(false)
  useLayoutEffect(() => {
    if (position && !focused.current) {
      focused.current = true
      ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus()
    }
  }, [position])

  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const element = ref.current

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Element
      // El botón que abrió el menú lo cierra con su propio clic.
      if (!element?.contains(target) && !target.closest?.('[aria-expanded="true"]')) {
        closeRef.current()
      }
    }
    const close = (): void => closeRef.current()
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      const active = document.activeElement
      if (previous?.isConnected && (active === document.body || element?.contains(active))) {
        previous.focus()
      }
    }
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])
    const current = buttons.indexOf(document.activeElement as HTMLElement)
    const focusAt = (index: number): void => buttons[(index + buttons.length) % buttons.length]?.focus()
    switch (event.key) {
      case 'Escape':
      case 'Tab':
        event.preventDefault()
        event.stopPropagation()
        onClose()
        break
      case 'ArrowDown':
        event.preventDefault()
        focusAt(current + 1)
        break
      case 'ArrowUp':
        event.preventDefault()
        focusAt(current - 1)
        break
      case 'Home':
        event.preventDefault()
        focusAt(0)
        break
      case 'End':
        event.preventDefault()
        focusAt(buttons.length - 1)
        break
    }
  }

  return createPortal(
    <div
      ref={ref}
      className="menu"
      role="menu"
      aria-label={label}
      style={position ?? { left: anchor.x, top: anchor.y, visibility: 'hidden' }}
      onKeyDown={onKeyDown}
      onContextMenu={event => event.preventDefault()}
    >
      {items.map(item => {
        const Icon = item.icon
        return (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={item.danger ? 'menu-item menu-item-danger' : 'menu-item'}
            disabled={item.disabled}
            title={item.title}
            onClick={() => {
              onClose()
              item.onSelect()
            }}
          >
            <Icon aria-hidden size={15} strokeWidth={1.75} />
            <span className="menu-item-label">{item.label}</span>
            {item.hint && <span className="menu-item-hint">{item.hint}</span>}
          </button>
        )
      })}
    </div>,
    document.body,
  )
}
