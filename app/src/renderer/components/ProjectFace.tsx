import { RefreshCw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { CardId, MesaId } from '../../shared/model'
import type { NotionOption, ProjectField, ProjectSnapshot, ProjectState } from '../../shared/notion'
import { errorMessage } from '../lib/errors'
import { absoluteDate, relativeDate } from '../lib/format'
import { useNotionSettingsVersion } from '../lib/notionSettings'

const api = window.table

export interface ProjectView {
  /** Ficha a mostrar (actual o de caché); null = tarjeta web normal. */
  readonly snapshot: ProjectSnapshot | null
  /** Motivo por el que no está actualizada; null si se acaba de leer. */
  readonly problem: string | null
  readonly refreshing: boolean
  readonly refresh: () => void
}

/**
 * Ficha de una tarjeta de Notion: muestra la caché al instante y la vuelve a
 * leer al montar (abrir la mesa), al pedirlo y al cambiar los ajustes.
 */
export function useProjectView(mesaId: MesaId, cardId: CardId, enabled: boolean): ProjectView {
  const settingsVersion = useNotionSettingsVersion()
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [request, setRequest] = useState(0)

  useEffect(() => {
    if (!enabled) {
      return
    }
    let cancelled = false
    // La caché solo rellena la tarjeta mientras la lectura en Notion no ha terminado.
    let settled = false
    setRefreshing(true)
    void api.notion.cachedProject(mesaId, cardId).then(cached => {
      if (!cancelled && !settled && cached) {
        setSnapshot(current => current ?? cached)
      }
    })
    api.notion.refreshProject(mesaId, cardId).then(
      (state: ProjectState) => {
        settled = true
        if (cancelled) {
          return
        }
        setRefreshing(false)
        switch (state.status) {
          case 'ready':
            setSnapshot(state.snapshot)
            setProblem(null)
            break
          case 'error':
            setSnapshot(state.cached)
            setProblem(state.message)
            break
          default:
            setSnapshot(null)
            setProblem(null)
        }
      },
      (error: unknown) => {
        settled = true
        if (!cancelled) {
          setRefreshing(false)
          setProblem(errorMessage(error))
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [mesaId, cardId, enabled, settingsVersion, request])

  const refresh = useCallback(() => setRequest(value => value + 1), [])
  return { snapshot, problem, refreshing, refresh }
}

/** Campos de la ficha, en lugar de la captura; el botón de actualizar va en la esquina. */
export function ProjectFace({ view }: { readonly view: ProjectView }) {
  const { snapshot, refreshing, refresh } = view
  if (!snapshot) {
    return null
  }
  return (
    <div className="project-face">
      <dl className="project-fields">
        {snapshot.fields.map(field => (
          <div key={field.name} className="project-field">
            <dt>{field.label}</dt>
            <dd>
              <FieldValue field={field} />
            </dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        className="icon-button icon-button-small project-refresh nodrag"
        aria-label="Actualizar la ficha"
        title="Actualizar la ficha"
        disabled={refreshing}
        onClick={refresh}
      >
        <RefreshCw aria-hidden size={12} strokeWidth={1.75} className={refreshing ? 'spin' : undefined} />
      </button>
    </div>
  )
}

/** Origen y fecha de la ficha, para el pie de la tarjeta; avisa si es caché. */
export function ProjectSource({ snapshot, problem }: { readonly snapshot: ProjectSnapshot; readonly problem: string | null }) {
  return (
    <span className={problem ? 'project-source project-source-stale' : 'project-source'} role="status" title={problem ?? absoluteDate(snapshot.fetchedAt)}>
      {problem && <TriangleAlert aria-hidden size={12} strokeWidth={1.75} />}
      <span>
        {problem
          ? `Caché de ${relativeDate(snapshot.fetchedAt)} · ${problem}`
          : `Ficha de Notion · leída ${relativeDate(snapshot.fetchedAt)}`}
      </span>
    </span>
  )
}

function FieldValue({ field }: { readonly field: ProjectField }) {
  const { value } = field
  switch (value.kind) {
    case 'missing':
      return <span className="project-empty">No existe en la ficha</span>
    case 'incompatible':
      return <span className="project-empty">Tipo inesperado ({value.actualType})</span>
    case 'status':
      return value.option ? <Chip option={value.option} /> : <Empty />
    case 'tags':
      return value.options.length > 0 ? (
        <span className="project-chips">
          {value.options.map(option => (
            <Chip key={option.name} option={option} />
          ))}
        </span>
      ) : (
        <Empty />
      )
    case 'date':
      return value.start ? <span>{formatRange(value.start, value.end)}</span> : <Empty />
    case 'text':
      return value.text ? <span>{value.text}</span> : <Empty />
  }
}

function Empty() {
  return <span className="project-empty">—</span>
}

function Chip({ option }: { readonly option: NotionOption }) {
  return (
    <span className="project-chip" data-color={option.color}>
      {option.name}
    </span>
  )
}

const dayFormat = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' })

/** Fecha de Notion (`2026-10-26` o con hora) como «26 oct 2026». */
function formatDay(value: string): string {
  const time = Date.parse(value.length === 10 ? `${value}T00:00:00` : value)
  return Number.isNaN(time) ? value : dayFormat.format(new Date(time))
}

function formatRange(start: string, end: string | null): string {
  return end ? `${formatDay(start)} – ${formatDay(end)}` : formatDay(start)
}
