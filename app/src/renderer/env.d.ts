import type { TableApi } from '../shared/ipc'

declare global {
  interface Window {
    readonly table: TableApi
  }
}

export {}
