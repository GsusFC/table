import type { TableSpikeApi } from '../shared/ipc'

declare global {
  interface Window {
    readonly tableSpike: TableSpikeApi
  }
}

export {}
