# Tarea 011 · MCP de Table: el agente trabaja en la mesa

Estado: en curso desde el 2026-10-27; implementada, falta la prueba del usuario con un arnés real. Fase: 2. Aplica [D-020](../decisions.md) (P-009).

## Resultado esperado

Cada sesión de agente tiene conectado el MCP de Table, igual que Figma o el navegador (T-010). El agente sabe en qué mesa está, ve lo que hay en ella y lo que la persona tiene seleccionado, y puede hacer en la mesa lo mismo que la persona: añadir tarjetas, notas y resultados con sus fuentes, cambiar notas, mover, conectar y borrar. La persona ve los cambios en vivo en la mesa.

## Diseño

**Propuesta del asistente, aceptada por el usuario el 2026-10-27 («me encaja»).** Las herramientas se declaran una sola vez, con la forma de WebMCP (nombre, descripción, esquema JSON de entrada y anotaciones `readOnlyHint`/`destructiveHint`), y Table las publica tal cual como MCP. Cada acción nueva de la mesa que se declare llega al agente sin trabajo extra. No es WebMCP del navegador (`navigator.modelContext`): los agentes están en la terminal.

- **Catálogo único** en `shared/agentTools.ts`: la declaración de cada herramienta. El proceso principal las ejecuta contra el almacén de mesas, de modo que funcionan aunque la mesa no esté abierta en pantalla; las que dependen de la interfaz (selección, mostrar) lo dicen si la mesa no está abierta. Un test exige que cada herramienta declarada tenga su ejecución y al revés.
- **Transporte.** Servidor MCP en el proceso principal (`@modelcontextprotocol/sdk`, ya en dependencias) sobre un socket Unix en una carpeta 0700 de Table. El arnés arranca un puente stdio mínimo (el propio ejecutable de Table en modo Node, `ELECTRON_RUN_AS_NODE=1`) que solo pasa bytes entre stdio y el socket. Sin puerto TCP: ninguna web ni otro usuario del equipo puede llamarlo. El puente se presenta con el ID de la sesión y un testigo aleatorio de esa sesión; Table rechaza testigos desconocidos o de sesiones cerradas. El testigo no es una credencial de ningún servicio y caduca con la sesión.
- **Configuración por arnés.** Los adaptadores de T-010 añaden el servidor `table` (stdio) en cada arnés que admite MCP, con su chip «Table» en el panel; el tooltip lista lo que puede hacer el agente.
- **Cambios en vivo.** Tras cada escritura del agente, el proceso principal avisa a la interfaz para que vuelva a leer la mesa, conservando lo que la persona esté arrastrando o escribiendo. Cada acción del agente muestra un aviso breve («El agente añadió una nota»).
- **Borrar.** Toda herramienta destructiva (borrar un elemento o una conexión) pide confirmación a la persona con un diálogo de Table que dice qué agente quiere borrar qué; si la persona no acepta, la herramienta devuelve que se rechazó. Propuesta del asistente (D-020) por la norma de no descartar trabajo sin preguntar.

## Herramientas

| Herramienta | Qué hace | Tipo |
| --- | --- | --- |
| `table_get_mesa` | Nombre, carpeta de trabajo, tarjetas (servicio, título, URL, posición, tamaño), notas (texto), resultados (archivo, tipo, fuentes), conexiones y el sistema de coordenadas. | lectura |
| `table_get_selection` | Elementos seleccionados ahora en la mesa (la interfaz informa al cambiar la selección). | lectura |
| `table_get_project` | Ficha de Notion vinculada, filtrada como en `TABLE.md`, y la lista de archivos de `notion/`. | lectura |
| `table_add_card` | Añade una URL http(s) como tarjeta, en una posición o junto a un elemento (`near`). | escritura |
| `table_add_note` | Añade una nota con texto, en una posición o junto a un elemento. | escritura |
| `table_update_note` | Cambia el texto de una nota. Falla si la persona la está editando. | escritura |
| `table_move_items` | Mueve o redimensiona elementos. | escritura |
| `table_connect` | Conecta dos elementos. | escritura |
| `table_add_result` | Registra un archivo que el agente escribió en `resultados/` como tarjeta de resultado y lo conecta con sus fuentes (elementos de la mesa). | escritura |
| `table_show_items` | Selecciona y centra elementos en la vista de la persona (si la mesa está abierta). | interfaz |
| `table_remove_items` | Borra elementos (tarjetas, notas, resultados; el archivo de un resultado se queda). Pide confirmación. | destructiva |
| `table_disconnect` | Borra conexiones. Pide confirmación. | destructiva |

Validación: los mismos límites que la interfaz (URLs http(s), texto de notas, IDs de la mesa de la sesión, tamaños). Un agente solo actúa sobre la mesa de su sesión.

## Fuera de alcance

- Navegar y actuar dentro de las webs de las tarjetas (D-020: más adelante).
- Deshacer las acciones del agente.
- `navigator.modelContext` en la interfaz: sin cliente que lo use.

## Implementación

Contrato detallado en [harnesses](../harnesses.md#mcp-de-table-t-011) y la interfaz en [diseño](../design.md).

- **Catálogo** (`app/src/shared/agentTools.ts`): las 12 herramientas con descripción, esquema JSON y anotaciones. **Ejecución** (`app/src/main/agent/tableTools.ts`): contra el almacén, con las validaciones de la interfaz y solo en la mesa de la sesión; `near` coloca a la derecha del elemento y baja si tapa otro. `table_get_mesa` da las fuentes de cada resultado (los elementos conectados) y `table_get_project`, los campos de la lista cerrada y los archivos de `notion/`.
- **Servidor** (`app/src/main/agent/tableMcp.ts`): SDK de MCP sobre un socket Unix en una carpeta `mkdtemp` 0700 de la carpeta temporal del usuario (`/var/folders/…/T/table-mcp-…/s`, unos 70 bytes; si no cupiera en los 104 de `sun_path`, `/tmp/table-mcp-…`). **Puente** (`app/src/main/agent/mcpBridge.ts`, entrada aparte en `electron.vite.config.ts` → `out/main/mcpBridge.js`): el ejecutable de Table con `ELECTRON_RUN_AS_NODE=1`; saludo `{"session","ticket"}`, respuesta `ok`/`no`, y después solo bytes.
- **Testigo**: 32 bytes aleatorios por sesión, en el entorno de la sesión (`TABLE_MCP_SOCKET`, `TABLE_MCP_SESSION`, `TABLE_MCP_TICKET`), nunca en argumentos, archivos ni registros; caduca al terminar o cerrar la sesión (el gestor de sesiones llama a `dispose`, que corta las conexiones). `TICKET` y no `TOKEN` porque Gemini CLI quita del entorno de sus MCP los nombres con `TOKEN`. Comprobado el 2026-10-27 con un servidor de prueba que vuelca su entorno: Claude Code, OpenCode y Gemini CLI pasan el entorno del arnés; Codex, solo los nombres de `env_vars` (lo declara el adaptador); omp, según su documentación (`env overlays Bun.env`), sin arrancarlo.
- **Adaptadores** (`app/src/main/agent/mcp.ts`): servidor `table` en Claude Code, Codex, Gemini CLI, OpenCode y omp; chip «Table» con lo que puede hacer el agente. Si el servidor no arranca, las sesiones se abren sin él.
- **Interfaz**: el lienzo informa de la mesa abierta, la selección y la nota en edición (solo cuando cambian); tras cada cambio del agente, la interfaz vuelve a leer la mesa (la geometría que cambia en disco se aplica salvo a lo que se arrastra) y avisa, juntando los avisos seguidos; `table_show_items` selecciona y centra. Borrar: diálogo de Table si la mesa está abierta (vuelve antes al lienzo si hay una web), diálogo nativo si no; 50 s para contestar.
- **`TABLE.md`**: «Herramientas de la sesión» explica el MCP de Table, cuándo usarlo y que sin él sirven `TABLE.md` y `resultados/`.

Decisiones de implementación (propuestas del asistente, sin cambiar el alcance): el testigo va en el entorno de la sesión y no en la configuración, para que no quede en `ps` ni en los archivos de proyecto compartidos por la mesa; diálogo de Table con la mesa abierta y nativo sin ella; plazo de 50 s para confirmar; un agente que registra un resultado que la persona había quitado lo vuelve a poner en la mesa.

## Criterios de aceptación

- [x] Un cliente MCP de prueba (el SDK) conectado por el puente lista las herramientas del catálogo con sus esquemas y ejecuta cada una contra una mesa: los cambios se guardan y la interfaz los muestra sin recargar. *(Tests: cada herramienta contra una mesa; smoke: puente real, nota que aparece en el lienzo y borrado confirmado en el diálogo.)*
- [x] Testigo desconocido o de otra sesión: conexión rechazada. Sesión cerrada: el puente termina.
- [x] Borrar pide confirmación; rechazada, no cambia nada.
- [x] Los adaptadores configuran `table` en Claude Code, Codex, Gemini CLI, OpenCode y omp; el panel muestra el chip.
- [x] `TABLE.md` dice que la sesión tiene el MCP de Table y para qué usarlo.
- [x] `npm run typecheck`, `npm test` y `npm run smoke` pasan.
- [ ] Prueba del usuario: pedir a un agente que lea la selección, añada una nota con un resumen conectada a sus fuentes y borre algo (con confirmación).

## Comprobaciones (2026-10-27)

- Tests: paridad entre catálogo y ejecución; cada herramienta contra un almacén real en una carpeta temporal (validaciones, `near`, nota en edición, mover validando todo antes, resultados con enlaces simbólicos, nombres temporales y rutas, borrado aceptado y rechazado, tarjeta que no se descarga, IDs de otra mesa en todas las herramientas, posiciones calculadas fuera del lienzo, sesión cerrada con la confirmación pendiente); servidor y puente con el cliente del SDK sobre un socket real (catálogo, ejecución, testigo erróneo, otra sesión, sesión cerrada, puente sin entorno, borrado pendiente cancelado al cerrar la sesión, cierre con conexiones rechazadas y sin presentarse); adaptadores con `table` en cada arnés, el navegador con las variables de Table vacías y sin testigo en la configuración; gestor de sesiones (`dispose` al terminar, al cerrar y en preparaciones antiguas); lecturas de la interfaz tras un cambio del agente (texto y geometría con guardado en curso o posterior, elementos creados y borrados por la persona, conexiones huérfanas); geometría del lienzo (arrastre, redimensionado y cambios sin guardar); `TABLE.md`.
- Smoke: un perfil propio como Claude Code recibe `table` y `TABLE_MCP_SESSION`, con el chip «Table»; el puente compilado con el ejecutable de Table en modo Node: lista las 12 herramientas, `table_get_selection` refleja la selección hecha en la interfaz, `table_add_note` junto a una tarjeta aparece en el lienzo con su aviso, `table_remove_items` abre el diálogo («Claude con Table quiere borrar 1 elemento…») y, aceptado, la nota desaparece; con otro borrado esperando, cerrar la sesión retira el diálogo, termina el puente y la tarjeta sigue en la mesa.
- Revisión: revisión separada de Codex (1 alta, 5 medias), corregidas: posiciones calculadas sin validar que podían dejar la mesa ilegible; un borrado pendiente que seguía valiendo tras cerrar la sesión o cancelar la petición; lecturas tras un cambio del agente que podían deshacer texto o geometría de la persona aún sin guardar; redimensionados interrumpidos; el testigo heredado por el MCP del navegador; y conexiones sin autenticar que podían bloquear el cierre.
- Sin comprobar: un arnés real (Claude Code, Codex…) usando el MCP de Table en una sesión autorizada; omp.
