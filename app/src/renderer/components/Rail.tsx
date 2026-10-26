import { House, Settings } from 'lucide-react'

interface RailProps {
  readonly homeActive: boolean
  readonly onHome: () => void
  readonly onSettings: () => void
}

/** Carril lateral: Inicio arriba y Ajustes abajo. Nada de iconos sin función. */
export function Rail({ homeActive, onHome, onSettings }: RailProps) {
  return (
    <nav className="rail" aria-label="Navegación principal">
      <button
        type="button"
        className={homeActive ? 'rail-button rail-button-active' : 'rail-button'}
        aria-label="Inicio"
        aria-current={homeActive ? 'page' : undefined}
        title="Inicio"
        onClick={onHome}
      >
        <House aria-hidden size={18} strokeWidth={1.75} />
      </button>
      <button type="button" className="rail-button rail-button-end" aria-label="Ajustes" title="Ajustes" onClick={onSettings}>
        <Settings aria-hidden size={18} strokeWidth={1.75} />
      </button>
    </nav>
  )
}
