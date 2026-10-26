import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type PersistenceError, type TableApi } from '../shared/ipc'
import type { Card, MesaId } from '../shared/model'
import type { SurfaceCardState } from '../shared/surface'

const flushHandlers = new Set<() => Promise<void>>()

// El proceso principal pide guardar lo pendiente antes de cerrar; se responde
// con el mismo id cuando terminan todos los manejadores, indicando si alguno falló.
ipcRenderer.on(IPC.appFlushRequest, (_event: IpcRendererEvent, requestId: unknown) => {
  void Promise.allSettled([...flushHandlers].map(handler => handler())).then(results => {
    ipcRenderer.send(IPC.appFlushDone, requestId, results.every(result => result.status === 'fulfilled'))
  })
})

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
  notes: {
    add: (mesaId, position) => ipcRenderer.invoke(IPC.notesAdd, mesaId, position),
    update: (mesaId, noteId, patch) => ipcRenderer.invoke(IPC.notesUpdate, mesaId, noteId, patch),
    remove: (mesaId, noteId) => ipcRenderer.invoke(IPC.notesRemove, mesaId, noteId),
  },
  edges: {
    add: (mesaId, source, target) => ipcRenderer.invoke(IPC.edgesAdd, mesaId, source, target),
    remove: (mesaId, edgeId) => ipcRenderer.invoke(IPC.edgesRemove, mesaId, edgeId),
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
  onPersistenceError: listener => {
    const handler = (_event: IpcRendererEvent, error: PersistenceError): void => listener(error)
    ipcRenderer.on(IPC.persistenceError, handler)
    return () => {
      ipcRenderer.removeListener(IPC.persistenceError, handler)
    }
  },
  onFlushRequest: handler => {
    flushHandlers.add(handler)
    return () => {
      flushHandlers.delete(handler)
    }
  },
  settings: {
    notion: () => ipcRenderer.invoke(IPC.settingsNotion),
    setNotionToken: token => ipcRenderer.invoke(IPC.settingsSetNotionToken, token),
    clearNotionToken: () => ipcRenderer.invoke(IPC.settingsClearNotionToken),
    listNotionDatabases: () => ipcRenderer.invoke(IPC.settingsListNotionDatabases),
    setNotionDatabase: databaseId => ipcRenderer.invoke(IPC.settingsSetNotionDatabase, databaseId),
  },
  notion: {
    cachedProject: (mesaId, cardId) => ipcRenderer.invoke(IPC.notionCachedProject, mesaId, cardId),
    refreshProject: (mesaId, cardId) => ipcRenderer.invoke(IPC.notionRefreshProject, mesaId, cardId),
  },
}

contextBridge.exposeInMainWorld('table', api)
