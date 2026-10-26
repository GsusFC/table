import type { CSSProperties } from 'react'
import type { ServiceDefinition } from '../../shared/services'

interface ServiceBadgeProps {
  readonly service: ServiceDefinition
  readonly size?: 'sm' | 'lg'
}

/** Distintivo del servicio: monograma sobre su color. El nombre va al lado, en texto. */
export function ServiceBadge({ service, size = 'sm' }: ServiceBadgeProps) {
  return (
    <span
      className={size === 'lg' ? 'service-badge service-badge-lg' : 'service-badge'}
      style={{ '--service-color': service.badge.color } as CSSProperties}
      aria-hidden
    >
      {service.badge.monogram}
    </span>
  )
}
