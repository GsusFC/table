import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type PersistenceError, type TableApi } from '../shared/ipc'
import type { Card, MesaId } from '../shared/model'
import type { SurfaceCardState } from '../shared/surface'
import type { SessionId, SessionInfo } from '../shared/terminal'

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
    connectNotion: () => ipcRenderer.invoke(IPC.settingsConnectNotion),
    cancelConnectNotion: () => ipcRenderer.invoke(IPC.settingsCancelConnectNotion),
    disconnectNotion: () => ipcRenderer.invoke(IPC.settingsDisconnectNotion),
    figma: () => ipcRenderer.invoke(IPC.settingsFigma),
    connectFigma: token => ipcRenderer.invoke(IPC.settingsConnectFigma, token),
    disconnectFigma: () => ipcRenderer.invoke(IPC.settingsDisconnectFigma),
  },
  notion: {
    cachedProject: (mesaId, cardId) => ipcRenderer.invoke(IPC.notionCachedProject, mesaId, cardId),
    refreshProject: (mesaId, cardId) => ipcRenderer.invoke(IPC.notionRefreshProject, mesaId, cardId),
    searchProjects: query => ipcRenderer.invoke(IPC.notionSearchProjects, query),
  },
  figma: {
    listFrames: (mesaId, cardId) => ipcRenderer.invoke(IPC.figmaListFrames, mesaId, cardId),
    fetchThumbnails: (mesaId, cardIds) => ipcRenderer.invoke(IPC.figmaFetchThumbnails, mesaId, cardIds),
    thumbnail: (mesaId, cardId) => ipcRenderer.invoke(IPC.figmaThumbnail, mesaId, cardId),
  },
  terminal: {
    profiles: () => ipcRenderer.invoke(IPC.terminalProfiles),
    saveCustomProfile: input => ipcRenderer.invoke(IPC.terminalSaveCustomProfile, input),
    removeCustomProfile: profileId => ipcRenderer.invoke(IPC.terminalRemoveCustomProfile, profileId),
    sessions: mesaId => ipcRenderer.invoke(IPC.terminalSessions, mesaId),
    start: (mesaId, profileId, size) => ipcRenderer.invoke(IPC.terminalStart, mesaId, profileId, size),
    replay: sessionId => ipcRenderer.invoke(IPC.terminalReplay, sessionId),
    close: sessionId => ipcRenderer.invoke(IPC.terminalClose, sessionId),
    write: (sessionId, data) => ipcRenderer.send(IPC.terminalWrite, sessionId, data),
    resize: (sessionId, size) => ipcRenderer.send(IPC.terminalResize, sessionId, size),
    onData: listener => {
      const handler = (_event: IpcRendererEvent, sessionId: SessionId, data: string): void => listener(sessionId, data)
      ipcRenderer.on(IPC.terminalData, handler)
      return () => {
        ipcRenderer.removeListener(IPC.terminalData, handler)
      }
    },
    onSession: listener => {
      const handler = (_event: IpcRendererEvent, session: SessionInfo): void => listener(session)
      ipcRenderer.on(IPC.terminalSession, handler)
      return () => {
        ipcRenderer.removeListener(IPC.terminalSession, handler)
      }
    },
  },
}

contextBridge.exposeInMainWorld('table', api)
