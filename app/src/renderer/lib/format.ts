import type { IsoDate } from '../../shared/model'

const relative = new Intl.RelativeTimeFormat('es', { numeric: 'auto' })
const shortDate = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' })
const longDate = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' })
const fullDate = new Intl.DateTimeFormat('es', { dateStyle: 'long', timeStyle: 'short' })

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** «hace 5 minutos», «ayer», «12 oct». */
export function relativeDate(iso: IsoDate, now: number = Date.now()): string {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) {
    return ''
  }
  const elapsed = now - time
  if (elapsed < MINUTE) {
    return 'ahora mismo'
  }
  if (elapsed < HOUR) {
    return relative.format(-Math.floor(elapsed / MINUTE), 'minute')
  }
  if (elapsed < DAY) {
    return relative.format(-Math.floor(elapsed / HOUR), 'hour')
  }
  if (elapsed < 7 * DAY) {
    return relative.format(-Math.floor(elapsed / DAY), 'day')
  }
  const date = new Date(time)
  return date.getFullYear() === new Date(now).getFullYear() ? shortDate.format(date) : longDate.format(date)
}

/** Fecha completa para `title` y lectores de pantalla. */
export function absoluteDate(iso: IsoDate): string {
  const time = Date.parse(iso)
  return Number.isNaN(time) ? '' : fullDate.format(new Date(time))
}

/** Host sin `www.`, o la URL entera si no se puede leer. */
export function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function cardCountLabel(count: number): string {
  return count === 1 ? '1 tarjeta' : `${count} tarjetas`
}
