import type { Card, CardId, CardPatch, Mesa, MesaId, MesaSummary, Point, Viewport } from '../../shared/model'

/**
 * Guardado local de mesas (D-015). Independiente de Electron: recibe la
 * carpeta base para poder probarse con una carpeta temporal.
 *
 * Disposición en disco:
 *   <baseDir>/mesas/<mesaId>.json          una mesa (SCHEMA_VERSION)
 *   <baseDir>/captures/<mesaId>/<cardId>.jpg
 *
 * Escrituras atómicas (archivo temporal + rename). Un archivo con otra
 * versión de esquema o JSON inválido no se sobrescribe: se ignora en `list`
 * con un aviso y `get` lanza error.
 *
 * Implementación: tarea paralela «guardado» de T-002.
 */
export interface MesaStore {
  /** Más recientes primero (`updatedAt`). */
  list(): Promise<MesaSummary[]>
  /** `name` ya validado con `parseMesaName`. */
  create(name: string): Promise<Mesa>
  get(id: MesaId): Promise<Mesa>
  rename(id: MesaId, name: string): Promise<Mesa>
  /** Borra la mesa y sus capturas. */
  remove(id: MesaId): Promise<void>
  setViewport(id: MesaId, viewport: Viewport): Promise<void>

  /** `url` ya validada y normalizada; `serviceId` ya reconocido. */
  addCard(mesaId: MesaId, input: { url: string; serviceId: string; position: Point }): Promise<Card>
  updateCard(mesaId: MesaId, cardId: CardId, patch: CardPatch): Promise<Card>
  /** Título observado al cargar la web. */
  setCardTitle(mesaId: MesaId, cardId: CardId, title: string | null): Promise<Card>
  /** Borra la tarjeta y su captura. */
  removeCard(mesaId: MesaId, cardId: CardId): Promise<void>

  /** Guarda la captura JPEG y actualiza `capturedAt`. */
  saveCapture(mesaId: MesaId, cardId: CardId, jpeg: Buffer): Promise<Card>
  /** Ruta absoluta de la captura, o null si no existe. */
  capturePath(mesaId: MesaId, cardId: CardId): string | null
}
