import type {
  AgentNotionMode,
  Card,
  CardId,
  CardPatch,
  Edge,
  EdgeId,
  Mesa,
  MesaId,
  MesaListing,
  ItemId,
  Note,
  NoteId,
  NotePatch,
  Point,
  Result,
  ResultId,
  ResultKind,
  ResultPatch,
  Viewport,
} from '../../shared/model'

/**
 * Guardado local de mesas (D-015). Independiente de Electron: recibe la
 * carpeta base para poder probarse con una carpeta temporal.
 *
 * Disposición en disco:
 *   <baseDir>/mesas/<mesaId>.json          una mesa (SCHEMA_VERSION)
 *   <baseDir>/captures/<mesaId>/<cardId>.jpg
 *
 * Escrituras atómicas (archivo temporal + rename). Un archivo de las versiones
 * de esquema 1 (sin notas ni conexiones) o 2 (sin resultados) se lee migrado a
 * la actual y se guarda en la actual con la siguiente escritura. En la 3,
 * `agentNotion` (T-010) es opcional en el archivo y vale `files` si falta. Un archivo de
 * otra versión, JSON inválido o forma inválida (URL no http(s), geometría o IDs
 * incorrectos, nombres de archivo de resultado que no son un solo segmento,
 * conexiones a elementos que no existen) no se sobrescribe: `list` lo cuenta
 * como ilegible y `get` lanza error.
 *
 * Implementación: tarea paralela «guardado» de T-002.
 */
export interface MesaStore {
  /**
   * Más recientes primero (`updatedAt`). Los archivos ilegibles se cuentan en
   * `unreadable` y no se tocan.
   */
  list(): Promise<MesaListing>
  /** `name` ya validado con `parseMesaName`. */
  create(name: string): Promise<Mesa>
  get(id: MesaId): Promise<Mesa>
  rename(id: MesaId, name: string): Promise<Mesa>
  /** Cómo recibe el agente el contexto de Notion (T-010); sin cambios, no escribe. */
  setAgentNotion(id: MesaId, mode: AgentNotionMode): Promise<Mesa>
  /** Borra la mesa y sus capturas. */
  remove(id: MesaId): Promise<void>
  setViewport(id: MesaId, viewport: Viewport): Promise<void>

  /** `url` ya validada y normalizada; `serviceId` ya reconocido. */
  addCard(mesaId: MesaId, input: { url: string; serviceId: string; position: Point }): Promise<Card>
  updateCard(mesaId: MesaId, cardId: CardId, patch: CardPatch): Promise<Card>
  /** Título observado al cargar la web. */
  setCardTitle(mesaId: MesaId, cardId: CardId, title: string | null): Promise<Card>
  /** Borra la tarjeta, sus conexiones (en la misma escritura) y su captura. */
  removeCard(mesaId: MesaId, cardId: CardId): Promise<void>

  /** Nota vacía con tamaño por defecto; `position` ya validada. */
  addNote(mesaId: MesaId, position: Point): Promise<Note>
  /** `patch` ya validado con `parseNotePatch`. */
  updateNote(mesaId: MesaId, noteId: NoteId, patch: NotePatch): Promise<Note>
  /** Borra la nota y sus conexiones en la misma escritura. */
  removeNote(mesaId: MesaId, noteId: NoteId): Promise<void>

  /**
   * Conecta dos elementos (tarjetas, notas o resultados) de la mesa. Rechaza
   * conectar un elemento consigo, repetir una conexión (en cualquier sentido)
   * o IDs que no están en la mesa.
   */
  addEdge(mesaId: MesaId, source: ItemId, target: ItemId): Promise<Edge>
  /** Borra solo la conexión; los elementos no cambian. */
  removeEdge(mesaId: MesaId, edgeId: EdgeId): Promise<void>

  /**
   * Aplica en una sola escritura lo que encontró la vigilancia de `resultados/`
   * (nombres ya validados con `parseResultFile`): `add` crea tarjetas salvo
   * para archivos que ya tienen una o están descartados; `touch` marca como
   * modificado el archivo de esos resultados (`updatedAt`); `undismiss` olvida
   * descartes de archivos que ya no están. Sin cambios, no escribe.
   */
  reconcileResults(
    mesaId: MesaId,
    changes: {
      readonly add: readonly { file: string; kind: ResultKind; position: Point }[]
      readonly touch: readonly ResultId[]
      readonly undismiss: readonly string[]
    },
  ): Promise<{ added: Result[]; touched: Result[] }>
  /** `patch` ya validado con `parseResultPatch`. */
  updateResult(mesaId: MesaId, resultId: ResultId, patch: ResultPatch): Promise<Result>
  /**
   * Quita la tarjeta y sus conexiones en la misma escritura; el archivo no se
   * toca y queda descartado (no se vuelve a importar mientras siga ahí).
   */
  removeResult(mesaId: MesaId, resultId: ResultId): Promise<void>

  /** Guarda la captura JPEG y actualiza `capturedAt`. */
  saveCapture(mesaId: MesaId, cardId: CardId, jpeg: Buffer): Promise<Card>
  /** Ruta absoluta de la captura, o null si no existe. */
  capturePath(mesaId: MesaId, cardId: CardId): string | null

  /** Espera a que terminen todas las escrituras en curso (cierre de la app). */
  flush(): Promise<void>
}
