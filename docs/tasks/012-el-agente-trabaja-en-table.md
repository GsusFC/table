# Tarea 012 · El agente trabaja en las webs de Table, a la vista

Estado: implementada el 2026-10-27; falta la prueba del usuario con los arneses reales. Fase: 2. Aplica [D-021](../decisions.md).

## Resultado esperado

Todo el trabajo web del agente ocurre en Table y se ve en Table. El agente mira y usa las webs de las tarjetas de la mesa (Figma, Pinterest, cualquier web) con sus sesiones de Table, sin ir a Chrome. Si está creando una web, la abre como tarjeta y la persona la ve. Cuando trabaja en una tarjeta, también en un archivo de Figma por el MCP oficial, la tarjeta se ilumina con un aviso y la persona puede verlo trabajar dentro de Table.

## Alcance

- **Navegador de Table para el agente** (MCP de Table, catálogo `shared/agentTools.ts`): abrir una URL o una tarjeta de la mesa (si la URL no está, se crea la tarjeta), navegar, foto del estado (árbol de accesibilidad con identificadores para actuar), captura de imagen, clic, escribir, teclas, scroll y esperar a un texto. Se implementa sobre las webs de las tarjetas (`WebContentsView`, protocolo de DevTools de `webContents.debugger`), nunca sobre la interfaz de Table. Mientras el agente usa una tarjeta, no se descarga por el límite de webs cargadas.
- **Webs locales** (`localhost`, `127.0.0.1`, `[::1]`): el agente abre su servidor de desarrollo como tarjeta. Solo en ellas puede, además, ejecutar JavaScript y leer la consola y los errores de red (propuesta: en las webs con la sesión de la persona, esas dos cosas permitirían leer datos de su cuenta).
- **Notion**: las herramientas web rechazan las tarjetas de Notion salvo con «Notion para el agente: MCP completo» en la mesa (D-019; una captura enseñaría presupuestos).
- **Luz de actividad**: la tarjeta en la que trabaja el agente se ilumina con «<agente> está trabajando» y la pestaña de su sesión lo indica. Se enciende sola con las herramientas web y con `table_set_activity` (el agente la llama antes de usar el MCP de Figma sobre un archivo de la mesa, con la tarjeta y el `node-id`; `TABLE.md` se lo pide) y se apaga con `table_clear_activity`, al cerrar la sesión o tras un rato sin actividad.
- **Seguir al agente** (propuesta: activado por defecto, interruptor en el panel): cuando el agente empieza a trabajar en una tarjeta, Table la abre para que la persona lo vea; en Figma, en el `node-id` indicado. No interrumpe si la persona está escribiendo o dentro de otra web: entonces solo se ilumina la tarjeta, con «Ver» en el aviso.
- **Permiso** (propuesta): la primera vez que una sesión usa las webs de la mesa, Table pregunta «¿Dejar que <agente> use las webs de esta mesa con tus sesiones?». Sin permiso, las herramientas web devuelven que la persona no lo autorizó.
- **Sin Chrome**: se retira el MCP de Chrome (`table-chrome-devtools`) del catálogo, de los adaptadores, del panel, de `TABLE.md` y de la documentación; Table quita sus entradas de los archivos de proyecto que creó.

## Fuera de alcance

- Editar diseño de Figma con clics en su editor: para eso está el MCP oficial de Figma (Claude Code, Codex, Gemini CLI, OpenCode).
- Ver lo que hace el MCP de Figma sin que el agente lo anuncie: Table no ve esas llamadas (van del arnés a Figma). Investigación aparte si hace falta.

## Criterios de aceptación

- Con un cliente MCP de prueba por el puente: abrir una web local de prueba como tarjeta, foto del estado, clic y escritura que cambian la página, captura de imagen, consola de la web local; las mismas herramientas en una web no local ejecutan clic/escritura pero rechazan JavaScript y consola; una tarjeta de Notion se rechaza en modo filtrado.
- La tarjeta se ilumina mientras el agente trabaja y se apaga al terminar; «Seguir al agente» abre la tarjeta y no interrumpe una nota en edición.
- Sin permiso no se toca ninguna web; el permiso es por sesión.
- Ninguna sesión recibe ya el MCP de Chrome; los archivos de proyecto creados por Table quedan sin esa entrada.
- `npm run typecheck`, `npm test` y `npm run smoke` pasan.
- Prueba del usuario: pedir a un agente que abra el frame V1 y diga qué ve (en Table), y que levante una web de prueba y la enseñe en la mesa.

## Implementación

Detalle en [harnesses.md](../harnesses.md#navegador-de-table-t-012) y [design.md](../design.md).

- **Catálogo** (`shared/agentTools.ts`): `MESA_TOOLS` (T-011) y `WEB_TOOLS`: `table_web_open`, `table_web_navigate`, `table_web_snapshot`, `table_web_screenshot`, `table_web_click`, `table_web_type`, `table_web_press_key`, `table_web_scroll`, `table_web_wait_for`, `table_web_evaluate` y `table_web_console` (solo webs locales), `table_set_activity` y `table_clear_activity`. Las web llevan `openWorldHint`. La captura viaja como imagen del MCP (`ToolContent`).
- **Ejecución** (`main/agent/webTools.ts`): reglas (mesa de la sesión, http(s), Notion solo con «MCP completo», JavaScript y consola solo en `localhost`/`127.0.0.1`/`[::1]`, mesa abierta en Table), permiso por sesión y luz de actividad. Operaciones del protocolo de DevTools en `main/web/webDriver.ts` (foto del árbol de accesibilidad con `uid`, entrada real, espera en mundo aislado) y la parte de Electron en `main/web/agentPages.ts` (depurador, consola de webs locales, navegación que respeta `beforeunload`, captura de vistas ocultas).
- **Webs** (`main/web/surfaceManager.ts`): `loadForAgent` carga la web de una tarjeta sin mostrarla; `pin`/`unpin` la sacan del límite de webs cargadas y de la cesión del editor de Figma mientras tiene actividad; `enter` con `focus: false` y navegación a un `node-id` para seguir al agente.
- **Luz** (`main/agent/activity.ts`): una actividad por sesión; 20 s tras la última herramienta web, 10 min tras `table_set_activity`; se apaga con `table_clear_activity` o al cerrar la sesión. La interfaz la recibe por IPC (`agent:activity`).
- **Interfaz**: tarjeta iluminada con etiqueta, etiqueta en la barra superior dentro de la web, punto de la pestaña de la sesión, aviso con «Ver», interruptor «Seguir al agente» (ojo en el panel, `localStorage`), diálogo de permiso con el `ConfirmDialog` de los borrados (botón principal).
- **Sin Chrome** (`main/agent/mcp.ts`): fuera del catálogo, de los adaptadores, de los chips (`AgentMcpName` sin `browser`), de `TABLE.md` y de los textos del panel. `retireLegacy()` quita al arrancar la entrada `table-chrome-devtools` de los archivos de proyecto donde la creó Table (registro), y preparar una sesión de Gemini CLI u omp también la quita; si no puede quitarla, esos arneses no arrancan y el panel dice por qué (igual que con el Notion residual de T-010).
- **`TABLE.md`**: «Herramientas de la sesión» con las webs de la mesa, el flujo de una web local (arrancar el servidor y `table_web_open` en `http://localhost:PUERTO`) y la petición de llamar a `table_set_activity` antes de usar el MCP de Figma sobre un archivo de la mesa y a `table_clear_activity` al terminar.

Decisiones de implementación (propuestas del asistente, sin cambiar el alcance):

- Las herramientas web exigen la mesa abierta en Table: lo que hace el agente tiene que verse y las webs de una mesa cerrada no se cargan. Por eso el permiso, en la práctica, siempre usa el diálogo de Table (el nativo queda para la confirmación genérica).
- Tras un «no» al permiso, Table no vuelve a preguntar a esa sesión durante 2 minutos; después, sí. Una pregunta retirada (sesión cerrada, petición cancelada) no cuenta como «no».
- Una tarjeta con actividad puede superar el límite de 2 webs cargadas mientras dure; el editor de Figma en el que trabaja el agente no se cede a otra tarjeta (esa carga el suyo), y el agente no puede quitarle a la persona el editor que tiene delante.
- Los errores de red de `table_web_console` se recogen desde que el agente usa la web (el protocolo de red solo se activa en webs locales); la consola, desde que se creó la vista.
- Seguir al agente no se aplica a lo que ya estaba en marcha al abrir la mesa, y no quita el foco a la terminal.

## Criterios de aceptación (estado)

- [x] Con un cliente MCP de prueba por el puente: abrir una web local de prueba como tarjeta, foto del estado, clic y escritura que cambian la página, captura de imagen, consola de la web local; las mismas herramientas en una web no local ejecutan clic/escritura pero rechazan JavaScript y consola; una tarjeta de Notion se rechaza en modo filtrado. *(Smoke; la web no local es la misma app servida con un nombre `.test` que el smoke resuelve a 127.0.0.1.)*
- [x] La tarjeta se ilumina mientras el agente trabaja y se apaga al terminar; «Seguir al agente» abre la tarjeta y no interrumpe una nota en edición. *(Smoke y tests.)*
- [x] Sin permiso no se toca ninguna web; el permiso es por sesión. *(Tests: aceptar, rechazar, otra sesión, fin de sesión; smoke: diálogo aceptado en la interfaz.)*
- [x] Ninguna sesión recibe ya el MCP de Chrome; los archivos de proyecto creados por Table quedan sin esa entrada. *(Tests de adaptadores y de limpieza; smoke.)*
- [x] `npm run typecheck`, `npm test` y `npm run smoke` pasan.
- [ ] Prueba del usuario: pedir a un agente que abra el frame V1 y diga qué ve (en Table), y que levante una web de prueba y la enseñe en la mesa.

## Comprobaciones (2026-10-27)

- `npm run typecheck`; `npm test` (27 archivos, 482 tests); `npm run smoke` (113/113).
- Tests: catálogo y ejecución en paridad (mesa y web); reglas antes de tocar una web (otra mesa, http(s), mesa cerrada, Notion con y sin «MCP completo» y al llegar a Notion navegando, JavaScript y consola solo en `localhost`/`127.0.0.1`/`[::1]` y no en `localhost.example.com`, entradas validadas antes de preguntar); permiso (pregunta una vez, otra sesión vuelve a preguntar, fin de sesión lo olvida, «no» sin insistir 2 minutos, pregunta cancelada no cuenta, `table_web_open` no crea la tarjeta sin permiso); luz (encendido y fijado, apagado por inactividad y nunca durante una herramienta, `table_set_activity` con plazo largo, cambio de tarjeta y de nodo, fin de sesión, tarjeta compartida por dos sesiones); foto del árbol de accesibilidad (uids, contenedores, texto repetido, caracteres de control, recorte), clic, escritura y teclas por el protocolo; captura como imagen por el puente real; adaptadores sin Chrome y limpieza de la entrada antigua (solo la de Table, conservando el resto y lo de la persona; carpeta que no pasa la comprobación).
- Smoke: perfil propio como Claude Code con el puente real y el cliente del SDK; diálogo de permiso aceptado en la interfaz; `table_web_open` crea la tarjeta de la app local; la tarjeta se ilumina, la pestaña lo indica, la barra dice «Claude con webs está trabajando» y «Seguir al agente» entra en ella; foto, escritura y clic cambian la página; captura JPEG; consola (mensaje de carga y 404) y JavaScript en la web local; en la web no local, oculta, escritura, clic y captura funcionan y JavaScript y consola se rechazan, y seguir al agente no saca a la persona de la web local (aviso con «Ver»); tarjeta de Notion rechazada; `table_clear_activity` apaga la luz; con una nota en edición, `table_set_activity` solo ilumina y avisa, y «Ver» abre la tarjeta; cerrar la sesión apaga la luz. Chips de las sesiones sin «Navegador».
- Revisión: revisión separada de Codex (3 altas, 5 medias), corregidas con un test de regresión cada una: el filtro de Notion solo miraba la URL antes de actuar (ahora la web queda restringida mientras el agente la usa —navegaciones, redirecciones, iframes y popups— y se comprueban todos los frames antes y después; smoke: un clic en un enlace a Notion no sale de la web); `table_web_evaluate` podía ejecutarse en un documento remoto si la web navegaba entre la comprobación y la ejecución (ahora en un contexto fijado por su ID y verificado como local); `table_set_activity` podía hacer que Table abriera una web sin permiso, también Notion filtrado (ahora pide el mismo permiso y la misma regla); dos herramientas a la vez soltaban la primera tarjeta; una espera tras cerrar la sesión volvía a enganchar el depurador; un cambio de nodo de Figma ignoraba «Seguir al agente» desactivado; las esperas dejaban escuchas; y un fallo al quitar el MCP de Chrome no bloqueaba los arneses afectados.
- Sin comprobar: un arnés real con las herramientas web; Figma real (editor compartido, `node-id` al seguir al agente, `capturePage` de un editor oculto pesado); webs con iframes (la foto solo cubre el documento principal) y popups de inicio de sesión (no se controlan); herramientas de desarrollo abiertas sobre una tarjeta.

## Correcciones de auditoría (2026-10-27)

- Cola por `WebContents` para toda operación web: dos herramientas concurrentes no intercalan foco, selección, escritura o envío; otras vistas permanecen independientes. La cancelación responde inmediatamente, pero conserva el turno de un comando o navegación ya emitidos hasta su resolución.
- Los cambios de modo de Notion revocan peticiones pendientes y bloquean nuevas operaciones durante la transición. Se releen mesa, tarjeta y modo después de esperas y antes de devolver contenido.
- La señal de cancelación llega a `loadForAgent`, incluida su cola y la cesión de editores: una petición revocada no crea una vista ni inicia una carga al alcanzar su turno.
- Verificación integrada de las correcciones de auditoría: `npm run typecheck`, 530 tests y smoke Electron 114/114. El smoke incluye dos escrituras simultáneas por el puente MCP real y comprueba en el DOM que cada campo conserva su propio valor.
- Revisión independiente de Codex: observaciones cerradas y revisión final del caso de navegación cancelada sin hallazgos adicionales. No se repitieron pruebas con cuentas reales de Figma o Notion.
