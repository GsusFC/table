import { House } from 'lucide-react'

interface RailProps {
  readonly homeActive: boolean
  readonly onHome: () => void
}

/** Carril lateral. En T-002 solo tiene Inicio: nada de iconos sin función. */
export function Rail({ homeActive, onHome }: RailProps) {
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
    </nav>
  )
}
