/**
 * Herramientas de la mesa para los agentes (D-020, T-011). Se declaran una
 * sola vez, con la forma de WebMCP (nombre, descripción, esquema JSON de
 * entrada y anotaciones), y Table las publica tal cual en su servidor MCP.
 * El proceso principal ejecuta cada una contra el almacén de mesas; un test
 * exige que cada declaración tenga su ejecución y al revés.
 */

/** Esquema JSON (subconjunto) de la entrada de una herramienta. */
export interface JsonSchema {
  readonly type: 'object' | 'string' | 'number' | 'array'
  readonly description?: string
  readonly properties?: Readonly<Record<string, JsonSchema>>
  readonly required?: readonly string[]
  readonly items?: JsonSchema
  readonly minItems?: number
  readonly maxItems?: number
  readonly maxLength?: number
  readonly additionalProperties?: boolean
}

export interface AgentToolDeclaration {
  readonly name: string
  /** Nombre corto para la persona (aviso del panel, chip). */
  readonly title: string
  readonly description: string
  readonly inputSchema: JsonSchema & { readonly type: 'object' }
  readonly annotations: {
    /** Solo lee la mesa. */
    readonly readOnlyHint: boolean
    /** Borra algo: Table pide confirmación a la persona. */
    readonly destructiveHint: boolean
  }
}

/** Elementos que el agente puede pedir por ID en una sola llamada. */
export const MAX_TOOL_ITEMS = 500

const POINT: JsonSchema = {
  type: 'object',
  description: 'Esquina superior izquierda en coordenadas del lienzo (px; x hacia la derecha, y hacia abajo).',
  properties: { x: { type: 'number' }, y: { type: 'number' } },
  required: ['x', 'y'],
  additionalProperties: false,
}
const SIZE: JsonSchema = {
  type: 'object',
  description: 'Ancho y alto en px del lienzo.',
  properties: { width: { type: 'number' }, height: { type: 'number' } },
  required: ['width', 'height'],
  additionalProperties: false,
}
const NEAR: JsonSchema = {
  type: 'string',
  description: 'ID de un elemento de la mesa: el nuevo se coloca a su derecha sin taparse con otros. Se ignora si hay `position`.',
}
const ID_LIST = (description: string): JsonSchema => ({
  type: 'array',
  description,
  items: { type: 'string' },
  minItems: 1,
  maxItems: MAX_TOOL_ITEMS,
})
const NO_INPUT = { type: 'object', properties: {}, additionalProperties: false } as const
const READ = { readOnlyHint: true, destructiveHint: false } as const
const WRITE = { readOnlyHint: false, destructiveHint: false } as const
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true } as const

export const AGENT_TOOLS = [
  {
    name: 'table_get_mesa',
    title: 'Leer la mesa',
    description:
      'Devuelve la mesa de esta sesión: nombre, carpeta de trabajo, tarjetas (servicio, título, URL, posición y tamaño), notas (texto), resultados (archivo de resultados/, tipo y fuentes: elementos conectados), conexiones y el sistema de coordenadas. Úsala antes de colocar o conectar elementos.',
    inputSchema: NO_INPUT,
    annotations: READ,
  },
  {
    name: 'table_get_selection',
    title: 'Leer la selección',
    description:
      'Elementos que la persona tiene seleccionados ahora en la mesa (ID, tipo y nombre). Si la mesa no está abierta en Table, lo dice y no hay selección.',
    inputSchema: NO_INPUT,
    annotations: READ,
  },
  {
    name: 'table_get_project',
    title: 'Leer la ficha del proyecto',
    description:
      'Fichas de proyecto de Notion de la mesa con la lista cerrada de campos (como en TABLE.md, sin campos excluidos) y los archivos de notion/ con el contenido filtrado.',
    inputSchema: NO_INPUT,
    annotations: READ,
  },
  {
    name: 'table_add_card',
    title: 'Añadir una tarjeta',
    description: 'Añade una URL http(s) a la mesa como tarjeta, en una posición o junto a otro elemento (`near`). Devuelve la tarjeta creada.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'URL http(s).' }, position: POINT, near: NEAR },
      required: ['url'],
      additionalProperties: false,
    },
    annotations: WRITE,
  },
  {
    name: 'table_add_note',
    title: 'Añadir una nota',
    description: 'Añade una nota de texto a la mesa, en una posición o junto a otro elemento (`near`). Devuelve la nota creada.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', maxLength: 10_000 }, position: POINT, near: NEAR },
      required: ['text'],
      additionalProperties: false,
    },
    annotations: WRITE,
  },
  {
    name: 'table_update_note',
    title: 'Cambiar una nota',
    description: 'Cambia el texto de una nota. Falla si la persona la está editando en ese momento.',
    inputSchema: {
      type: 'object',
      properties: { noteId: { type: 'string' }, text: { type: 'string', maxLength: 10_000 } },
      required: ['noteId', 'text'],
      additionalProperties: false,
    },
    annotations: WRITE,
  },
  {
    name: 'table_move_items',
    title: 'Mover elementos',
    description: 'Mueve o redimensiona tarjetas, notas o resultados de la mesa.',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_TOOL_ITEMS,
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, position: POINT, size: SIZE },
            required: ['id'],
            additionalProperties: false,
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
    annotations: WRITE,
  },
  {
    name: 'table_connect',
    title: 'Conectar elementos',
    description: 'Conecta dos elementos de la mesa (tarjetas, notas o resultados) con una línea sin dirección.',
    inputSchema: {
      type: 'object',
      properties: { source: { type: 'string' }, target: { type: 'string' } },
      required: ['source', 'target'],
      additionalProperties: false,
    },
    annotations: WRITE,
  },
  {
    name: 'table_add_result',
    title: 'Registrar un resultado',
    description:
      'Registra como tarjeta de resultado un archivo que ya escribiste directamente en resultados/ (solo el nombre, sin rutas) y lo conecta con sus fuentes (IDs de elementos de la mesa). Si Table ya lo había importado, solo añade las conexiones.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Nombre del archivo dentro de resultados/.' },
        sources: ID_LIST('Elementos de la mesa en los que se basa el resultado.'),
        position: POINT,
      },
      required: ['file'],
      additionalProperties: false,
    },
    annotations: WRITE,
  },
  {
    name: 'table_show_items',
    title: 'Mostrar elementos',
    description: 'Selecciona y centra elementos en la vista de la persona, si la mesa está abierta en Table.',
    inputSchema: {
      type: 'object',
      properties: { ids: ID_LIST('Elementos que mostrar.') },
      required: ['ids'],
      additionalProperties: false,
    },
    annotations: WRITE,
  },
  {
    name: 'table_remove_items',
    title: 'Borrar elementos',
    description:
      'Borra tarjetas, notas o resultados de la mesa (el archivo de un resultado se queda en resultados/) y sus conexiones. Table pide confirmación a la persona; si no acepta, no se borra nada.',
    inputSchema: {
      type: 'object',
      properties: { ids: ID_LIST('Elementos que borrar.') },
      required: ['ids'],
      additionalProperties: false,
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: 'table_disconnect',
    title: 'Borrar conexiones',
    description: 'Borra conexiones de la mesa (los elementos se quedan). Table pide confirmación a la persona; si no acepta, no se borra nada.',
    inputSchema: {
      type: 'object',
      properties: { edgeIds: ID_LIST('IDs de las conexiones (ver table_get_mesa).') },
      required: ['edgeIds'],
      additionalProperties: false,
    },
    annotations: DESTRUCTIVE,
  },
] as const satisfies readonly AgentToolDeclaration[]

export type AgentToolName = (typeof AGENT_TOOLS)[number]['name']
