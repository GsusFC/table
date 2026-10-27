import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type AgentActivity, type AgentConfirmRequest, type PersistenceError, type TableApi } from '../shared/ipc'
import type { Card, ItemId, MesaId } from '../shared/model'
import type { NotionContextProgress } from '../shared/notionContext'
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
    enter: (mesaId, cardId, options) => ipcRenderer.invoke(IPC.surfaceEnter, mesaId, cardId, options),
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
    ack: (sessionId, chars) => ipcRenderer.send(IPC.terminalAck, sessionId, chars),
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
  agent: {
    refreshContext: mesaId => ipcRenderer.invoke(IPC.agentRefreshContext, mesaId),
    selectionText: (mesaId, itemIds) => ipcRenderer.invoke(IPC.agentSelectionText, mesaId, itemIds),
    openContext: mesaId => ipcRenderer.invoke(IPC.agentOpenContext, mesaId),
    contextState: mesaId => ipcRenderer.invoke(IPC.agentContextState, mesaId),
    onProgress: listener => {
      const handler = (_event: IpcRendererEvent, progress: NotionContextProgress): void => listener(progress)
      ipcRenderer.on(IPC.agentContextProgress, handler)
      return () => {
        ipcRenderer.removeListener(IPC.agentContextProgress, handler)
      }
    },
    notionTree: mesaId => ipcRenderer.invoke(IPC.agentNotionTree, mesaId),
    setNotionSelection: (mesaId, selections) => ipcRenderer.invoke(IPC.agentSetNotionSelection, mesaId, selections),
    setNotionMode: (mesaId, mode) => ipcRenderer.invoke(IPC.agentSetNotionMode, mesaId, mode),
    reportUiState: state => ipcRenderer.send(IPC.agentUiState, state),
    onMesaChanged: listener => {
      const handler = (_event: IpcRendererEvent, mesaId: MesaId, notice: string): void => listener(mesaId, notice)
      ipcRenderer.on(IPC.agentMesaChanged, handler)
      return () => {
        ipcRenderer.removeListener(IPC.agentMesaChanged, handler)
      }
    },
    onShowItems: listener => {
      const handler = (_event: IpcRendererEvent, mesaId: MesaId, itemIds: readonly ItemId[]): void => listener(mesaId, itemIds)
      ipcRenderer.on(IPC.agentShowItems, handler)
      return () => {
        ipcRenderer.removeListener(IPC.agentShowItems, handler)
      }
    },
    onConfirmRequest: listener => {
      const handler = (_event: IpcRendererEvent, request: AgentConfirmRequest): void => listener(request)
      ipcRenderer.on(IPC.agentConfirmRequest, handler)
      return () => {
        ipcRenderer.removeListener(IPC.agentConfirmRequest, handler)
      }
    },
    onConfirmCancel: listener => {
      const handler = (_event: IpcRendererEvent, requestId: string): void => listener(requestId)
      ipcRenderer.on(IPC.agentConfirmCancel, handler)
      return () => {
        ipcRenderer.removeListener(IPC.agentConfirmCancel, handler)
      }
    },
    respondConfirm: (requestId, accepted) => ipcRenderer.send(IPC.agentConfirmResponse, requestId, accepted),
    activities: () => ipcRenderer.invoke(IPC.agentActivities),
    onActivity: listener => {
      const handler = (_event: IpcRendererEvent, activities: readonly AgentActivity[]): void => listener(activities)
      ipcRenderer.on(IPC.agentActivity, handler)
      return () => {
        ipcRenderer.removeListener(IPC.agentActivity, handler)
      }
    },
  },
  results: {
    update: (mesaId, resultId, patch) => ipcRenderer.invoke(IPC.resultsUpdate, mesaId, resultId, patch),
    remove: (mesaId, resultId) => ipcRenderer.invoke(IPC.resultsRemove, mesaId, resultId),
    open: (mesaId, resultId) => ipcRenderer.invoke(IPC.resultsOpen, mesaId, resultId),
    reveal: (mesaId, resultId) => ipcRenderer.invoke(IPC.resultsReveal, mesaId, resultId),
    preview: (mesaId, resultId) => ipcRenderer.invoke(IPC.resultsPreview, mesaId, resultId),
    missing: mesaId => ipcRenderer.invoke(IPC.resultsMissing, mesaId),
    onChanged: listener => {
      const handler = (_event: IpcRendererEvent, mesaId: MesaId): void => listener(mesaId)
      ipcRenderer.on(IPC.resultsChanged, handler)
      return () => {
        ipcRenderer.removeListener(IPC.resultsChanged, handler)
      }
    },
  },
}

contextBridge.exposeInMainWorld('table', api)
