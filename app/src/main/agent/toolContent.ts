/**
 * Resultado de una herramienta que no es solo JSON (T-012): una captura de
 * una web va como imagen del MCP, con una línea de texto. El servidor del MCP
 * de Table la publica tal cual; el resto de resultados se publican como JSON.
 */
export type ToolContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly data: string; readonly mimeType: string }

export class ToolContent {
  constructor(readonly blocks: readonly ToolContentBlock[]) {}
}
