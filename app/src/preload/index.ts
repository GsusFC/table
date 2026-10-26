import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type TableApi } from '../shared/ipc'
import type { Card, MesaId } from '../shared/model'
import type { SurfaceCardState } from '../shared/surface'

const api: TableApi = {
  platform: process.platform,
  mesas: {
    list: () => ipcRenderer.invoke(IPC.mesasList),
    create: name => ipcRenderer.invoke(IPC.mesasCreate, name),
    get: id => ipcRenderer.invoke(IPC.mesasGet, id),
    rename: (id, name) => ipcRenderer.invoke(IPC.mesasRename, id, name),
    remove: id => ipcRenderer.invoke(IPC.mesasRemove, id),
    setViewport: (id, viewport) => ipcRenderer.invoke(IPC.mesasSetViewport, id, viewport),
  },
  cards: {
    add: (mesaId, url, position) => ipcRenderer.invoke(IPC.cardsAdd, mesaId, url, position),
    update: (mesaId, cardId, patch) => ipcRenderer.invoke(IPC.cardsUpdate, mesaId, cardId, patch),
    remove: (mesaId, cardId) => ipcRenderer.invoke(IPC.cardsRemove, mesaId, cardId),
  },
  surface: {
    openMesa: mesaId => ipcRenderer.invoke(IPC.surfaceOpenMesa, mesaId),
    enter: (mesaId, cardId) => ipcRenderer.invoke(IPC.surfaceEnter, mesaId, cardId),
    exit: () => ipcRenderer.invoke(IPC.surfaceExit),
    unload: cardId => ipcRenderer.invoke(IPC.surfaceUnload, cardId),
    setPanelBounds: bounds => ipcRenderer.send(IPC.surfaceSetPanelBounds, bounds),
    getStates: () => ipcRenderer.invoke(IPC.surfaceGetStates),
    onState: listener => {
      const handler = (_event: IpcRendererEvent, state: SurfaceCardState): void => listener(state)
      ipcRenderer.on(IPC.surfaceState, handler)
      return () => {
        ipcRenderer.removeListener(IPC.surfaceState, handler)
      }
    },
  },
  onCardChanged: listener => {
    const handler = (_event: IpcRendererEvent, mesaId: MesaId, card: Card): void => listener(mesaId, card)
    ipcRenderer.on(IPC.cardChanged, handler)
    return () => {
      ipcRenderer.removeListener(IPC.cardChanged, handler)
    }
  },
}

contextBridge.exposeInMainWorld('table', api)
