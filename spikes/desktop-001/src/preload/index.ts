import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type SurfaceState, type TableSpikeApi } from '../shared/ipc'

const api: TableSpikeApi = {
  platform: process.platform,
  open: url => ipcRenderer.invoke(IPC.open, url),
  enter: () => ipcRenderer.invoke(IPC.enter),
  exit: () => ipcRenderer.invoke(IPC.exit),
  unload: () => ipcRenderer.invoke(IPC.unload),
  setBounds: bounds => ipcRenderer.send(IPC.setBounds, bounds),
  setZoom: factor => ipcRenderer.invoke(IPC.setZoom, factor),
  getState: () => ipcRenderer.invoke(IPC.getState),
  onState: listener => {
    const handler = (_event: IpcRendererEvent, state: SurfaceState): void => listener(state)
    ipcRenderer.on(IPC.state, handler)
    return () => {
      ipcRenderer.removeListener(IPC.state, handler)
    }
  },
}

contextBridge.exposeInMainWorld('tableSpike', api)
