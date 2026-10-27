# Tarea 010 · MCP de Figma, Notion y navegador para los agentes

Estado: en curso desde el 2026-10-27; implementada, falta la prueba del usuario con los arneses reales. Fase: 2. Aplica [D-019](../decisions.md).

## Resultado esperado

Al abrir una sesión, el agente ya tiene conectados los MCP que tocan: Figma (para ver y editar el diseño), un navegador con la sesión del usuario (para Pinterest y otras webs privadas) y, si la mesa lo permite, Notion sin filtro. Table los configura en cada arnés; cada arnés pide la autorización la primera vez con la cuenta de la persona. El panel muestra qué está conectado en la sesión.

## Alcance

- **Catálogo de MCP** en Table: Figma remoto (`https://mcp.figma.com/mcp`), Notion remoto (`https://mcp.notion.com/mcp`) y uno de navegador (por investigar: Chrome DevTools MCP con conexión al Chrome en uso, o Playwright MCP con su extensión; criterio: usa la sesión del navegador de la persona, pide permiso visible, mantenido por un proveedor serio).
- **Adaptador por arnés**, sin tocar su configuración global si se puede evitar: configuración por proyecto en la carpeta de la mesa o parámetros de arranque (`claude --mcp-config`, configuración de proyecto de Codex, `.gemini/settings.json`, `opencode.json`…; se investigan las versiones instaladas). Si un arnés no admite MCP o no se sabe configurar, el panel lo dice y la sesión funciona igual.
- **Notion por mesa**: ajuste de la mesa «Notion para el agente: archivos filtrados (por defecto) / MCP completo». Activar el MCP muestra un aviso claro de que el agente podrá leer presupuestos y oportunidades. Con archivos filtrados no se configura el MCP de Notion en esa sesión.
- **Estado en el panel**: por sesión, los MCP configurados y, si el arnés lo expone, si están autorizados; un enlace a cómo autorizarlos (por ejemplo `/mcp` en Claude Code).
- **`TABLE.md`**: dice qué MCP tiene la sesión y para qué usar cada uno (enlaces de Figma con `node-id`, URLs de Pinterest para el navegador).

## Fuera de alcance

- MCP propio de Table (selección, resultados con fuentes): tarea posterior.
- Copiar credenciales de Table al agente: nunca.

## Investigación (2026-10-27)

Versiones instaladas: Claude Code 2.1.308, codex-cli 0.164.0, Gemini CLI 0.40.1, OpenCode 1.17.8, omp 18.13.1, pi 0.85.1; Chrome 156. Se probó con `--help` de cada uno y con `HOME`/`CODEX_HOME`/`CLAUDE_CONFIG_DIR` temporales, sin tocar la configuración del usuario.

| Arnés | Vía menos invasiva | Comprobado | Autorización OAuth |
| --- | --- | --- | --- |
| Claude Code | `claude --mcp-config=<json>` al arrancar (sin `--strict-mcp-config`: los MCP propios de la persona siguen). Con `=`: el parámetro admite varios valores y se comería los siguientes. | Con `-p --output-format stream-json`, los servidores aparecen como `source: "dynamic"`, Figma y Notion en `needs-auth`, y las herramientas del navegador cargadas, sin aprobación. Un `.mcp.json` en la carpeta queda en «⏸ Pending approval» (`claude mcp list`); por eso no se usa. | `/mcp` → servidor → «Authenticate». Claude guarda la autorización por URL del servidor. |
| Codex | `-c mcp_servers.<nombre>.url="…"` (y `command`, `args`, `startup_timeout_sec` para el navegador) al arrancar. | `codex -c … mcp list` los lista; la configuración de proyecto `.codex/config.toml` se ignora en una carpeta sin confianza. | `codex mcp login <nombre> -c mcp_servers.<nombre>.url="…"` en una terminal (la TUI solo dice «Run `codex mcp login`»). Probado hasta la URL de autorización de Figma y de Notion. Guarda la credencial en el almacén de Codex, no en `config.toml`. |
| Gemini CLI | `.gemini/settings.json` en la carpeta de la mesa (`httpUrl` para remotos). | Con `GEMINI_CLI_TRUST_WORKSPACE=true`, `gemini mcp list` muestra Figma y el navegador. Sin confianza en la carpeta (activada por defecto en 0.40), la configuración de proyecto no se aplica: Gemini pregunta la primera vez y la persona decide. Table no pasa `--skip-trust` (sería aceptar por ella). | `/mcp auth <nombre>` en la sesión. |
| OpenCode | Variable `OPENCODE_CONFIG_CONTENT` con un `mcp` (se fusiona con la configuración de la persona). | `opencode mcp list` con la variable: navegador conectado; Figma y Notion piden autenticación. | Automática la primera vez que se usa; también `opencode mcp auth <nombre>`. |
| omp | `.omp/mcp.json` en la carpeta de la mesa (documentación local de omp, `mcp-config.md`). | No arrancado. omp descarta los MCP de navegador llamados `browser`, por eso el servidor se llama `table-chrome-devtools`. omp también importa `.gemini/settings.json` del proyecto. | `/mcp reauth <nombre>`. **Figma no**: su registro de clientes solo admite los de su catálogo y a `omp` le responde «Forbidden» (a «Claude Code» u «opencode», sí). |
| pi | Sin MCP propio (solo con extensiones). | `pi --help`. | — |

Figma: el servidor remoto solo admite clientes de su [catálogo](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/) (Claude Code, Codex, Gemini CLI, OpenCode, entre otros). Notion: registro dinámico de clientes.

**Navegador.** Propuesta del asistente: [Chrome DevTools MCP](https://developer.chrome.com/docs/devtools/agents/use-cases/auto-connect) de Google (`chrome-devtools-mcp`), frente a `@playwright/mcp` con su extensión.

- Chrome DevTools MCP con `--autoConnect` se conecta al Chrome en uso (Chrome 144 o posterior) y a su perfil, con sus sesiones. La persona activa una vez `chrome://inspect/#remote-debugging`, y Chrome muestra un diálogo de permiso cada vez que el servidor pide conectarse. No necesita extensión. Mantenido por el equipo de Chrome DevTools (versión 1.12.0 del 2026-10-22; Node 20.19 o posterior).
- Playwright MCP con `--extension` también usa la sesión del navegador, pero exige instalar la extensión «Playwright Extension» y elige el último perfil con la extensión; su modo `--cdp-endpoint=chrome` usa el mismo mecanismo de Chrome que el anterior.
- Elegido: `npx -y chrome-devtools-mcp@1.12.0 --wsEndpoint=ws://127.0.0.1:9222/devtools/browser --no-usage-statistics --no-performance-crux` (versión fijada; sin estadísticas de uso ni envío de URLs a CrUX). Riesgo: con el permiso concedido, el agente accede a todas las pestañas y datos del perfil de Chrome.
- **Cambio del 2026-10-27, tras la prueba del usuario con omp:** primero se usó `--autoConnect`, que lee `DevToolsActivePort` en la carpeta del perfil de Chrome para saber la dirección. macOS protege esa carpeta frente a otras apps (registro del sistema: `System Policy: deny(1) file-read-data …/DevToolsActivePort`), también frente a la terminal, así que el MCP no conectaba. Dar «Acceso total al disco» a Table lo arreglaría, pero lo heredarían todos sus agentes. La depuración remota de Chrome escucha en `127.0.0.1:9222`, y Chrome acepta `ws://127.0.0.1:9222/devtools/browser` sin el identificador del archivo, tras su diálogo «Permitir»: comprobado con `Browser.getVersion` y con el MCP completo (`list_pages`), aceptando el diálogo el usuario.

## Implementación

- **Catálogo** (`app/src/main/agent/mcp.ts`): `table-figma`, `table-notion` (la URL del MCP de Notion que ya usa Table) y `table-chrome-devtools` (navegador). Con el prefijo `table-` no pisan ni se mezclan con servidores de la persona llamados `figma` o `notion` (con `-c` de Codex, un mismo nombre se fusionaría con su entrada). Figma y navegador siempre; Notion solo si la mesa lo permite. Ningún archivo, argumento o variable lleva credenciales: solo URLs públicas y el comando del navegador.
- **Adaptadores** por ID del perfil del catálogo: Claude Code (argumento), Codex (argumentos), OpenCode (variable de entorno), Gemini CLI y omp (archivo de proyecto). pi y los perfiles propios: los MCP aparecen como «no configurado» con el motivo. La terminal normal no tiene MCP. Los argumentos se añaden entre comillas simples al comando del perfil (`$SHELL -l -c`), así que nada se expande.
- **Archivos de proyecto** (`.gemini/settings.json`, `.omp/mcp.json`): Table fusiona sus entradas en `mcpServers` y conserva el resto. Anota en sus datos (`agent-mcp-files.json`, 0600) qué entradas creó en cada archivo y solo cambia o quita esas; una entrada con el mismo nombre que no creó Table no se toca y la sesión la marca como «no configurado» con el motivo. Antes de escribir, anota también las nuevas: si algo falla a medias, sigue sabiendo que son suyas. No sobrescribe un archivo que no es JSON (p. ej. con comentarios) ni sigue enlaces simbólicos; el archivo reescrito queda con 0600, o con los permisos del original si son más restrictivos. Si no puede escribir, la sesión se abre con sus MCP como «no configurado».
- **Carpeta de la mesa**: antes de crear o escribir configuración, Table comprueba que es una carpeta normal (no un enlace simbólico) cuya ruta real está directamente dentro de `~/Table` (o de la raíz del smoke). Una carpeta cambiada por un enlace (p. ej. a `~`) no se usa: la sesión no se abre.
- **Ajuste de la mesa** `agentNotion: 'files' | 'mcp'` dentro del esquema 3: un archivo sin el campo se lee con `files`; un valor desconocido hace la mesa ilegible (como cualquier campo inválido). Se cambia desde «…» del panel; activar el MCP pide confirmación. Guardar el modo y reescribir los archivos de Table van en la misma cola que la preparación de las sesiones, que lee el modo dentro de la cola: una preparación antigua no puede volver a añadir Notion. Cambiar el modo invalida en el acto las preparaciones anteriores; la sesión se vuelve a preparar justo antes de arrancar (y, si el modo no deja de cambiar, no arranca). Las sesiones ya abiertas conservan la configuración con la que arrancaron.
- **Si no se puede quitar Notion** de un archivo de Table (p. ej. sin permiso de escritura): el cambio de modo informa del error (el modo queda guardado y el panel lo vuelve a leer) y los arneses que leen ese archivo (Gemini CLI; omp, que también importa `.gemini/settings.json`) no arrancan, con el motivo, hasta que se arregle. Elegir otra vez «archivos filtrados» lo reintenta. Los demás arneses arrancan.
- **Sesión**: `SessionInfo.mcp` con nombre, estado (`configured` o `unsupported`) y cómo autorizarlo; el panel lo muestra en chips sobre el terminal.
- **`TABLE.md`**: sección «Herramientas de la sesión»; con «archivos filtrados» pide al agente que no abra Notion con el navegador (es una instrucción, no un control).

## Primera vez (lo que hace la persona)

1. Chrome: abrir `chrome://inspect/#remote-debugging` y activar la depuración remota (una vez). Cuando el agente use el navegador, pulsar «Permitir» en el diálogo de Chrome.
2. Figma (y Notion si la mesa lo permite), una vez por arnés:
   - Claude Code: `/mcp` → `table-figma` → «Authenticate».
   - Codex: en una terminal, `codex mcp login table-figma -c mcp_servers.table-figma.url="https://mcp.figma.com/mcp"` (y lo mismo con `table-notion` y `https://mcp.notion.com/mcp`).
   - Gemini CLI: aceptar la confianza en la carpeta de la mesa al abrirlo y después `/mcp auth table-figma`.
   - OpenCode: autorizar cuando lo pida la primera vez.
   - omp: `/mcp reauth table-notion` (Figma no está disponible).
3. El primer uso del navegador descarga `chrome-devtools-mcp` con `npx` (necesita Node 20.19 o posterior en el `PATH` del shell de inicio de sesión).

## Límites

- Con «MCP completo», el agente lee todo lo que la cuenta de Notion de la persona ve, presupuestos incluidos ([contexto de Notion](../notion-context.md#exclusión-real-de-información)). Con «archivos filtrados», Table no configura Notion, pero si la persona ya tiene el MCP de Notion en la configuración global del arnés, el agente lo seguirá teniendo.
- **El navegador abre Notion igualmente.** Con el MCP del navegador autorizado, el agente usa el Chrome de la persona con sus sesiones: puede abrir Notion (y cualquier web) aunque la mesa esté en «archivos filtrados». «Archivos filtrados» no es una garantía mientras el navegador esté autorizado; la interfaz y `TABLE.md` lo dicen.
- El estado de autorización de cada MCP solo lo conoce el arnés: el panel dice qué configuró Table y cómo autorizarlo, no si ya está autorizado.
- La configuración por proyecto de Gemini solo se aplica si la persona confía en la carpeta de la mesa.

## Criterios de aceptación

- [ ] Claude Code y Codex arrancan con Figma y el navegador configurados sin que la persona edite nada; el resto de arneses, según admitan. *(Comprobado con los propios arneses en carpetas y `HOME` temporales; falta en una sesión real.)*
- [x] Una mesa con «MCP completo» de Notion lo configura; una con «archivos filtrados», no. El aviso aparece al activarlo.
- [x] La configuración de un arnés en otra carpeta o la global del usuario no cambia (o se documenta exactamente qué cambia y por qué). *Claude Code, Codex y OpenCode: nada en disco. Gemini CLI y omp: un archivo en la carpeta de la mesa. Las autorizaciones las guarda cada arnés en su almacén al autorizar la persona.*
- [x] El panel muestra los MCP de cada sesión.
- [x] Tests de los adaptadores (archivos y argumentos generados) y smoke con un arnés falso que registra su configuración.
- [ ] Probado por el usuario: el agente lee un frame de Figma y un tablero privado de Pinterest.

## Comprobaciones (2026-10-27)

- `npm run typecheck`, `npm test` (19 archivos, 398 tests) y `npm run smoke` (94/94).
- Tests: salida de cada adaptador por modo de Notion (argumentos de Claude Code y Codex, entorno de OpenCode, archivos de Gemini CLI y omp, pi y perfiles propios sin MCP); fusión con un archivo existente sin tocar entradas de la persona (también `figma`/`notion` suyas y `table-…` que no creó Table); quitar Notion al volver a archivos filtrados; error al no poder quitarlo (cambio de modo rechazado, Gemini CLI y omp bloqueados, Claude Code no; también tras reiniciar Table); carrera entre una preparación lenta con «MCP completo» y el cambio a archivos filtrados; permisos 0600 y más restrictivos conservados; no sobrescribir un JSON no válido; no seguir enlaces simbólicos; carpeta de la mesa cambiada por un enlace; nada con forma de credencial en lo generado. Sesiones: argumentos entrecomillados (sin inyección) y entorno de `prepare`; si falla, la sesión arranca sin MCP; si bloquea, no se abre; una preparación antigua se repite. Mesa: campo ausente se lee como `files`, se guarda, valor desconocido ilegible.
- Smoke: perfiles propios mapeados a Claude Code, Gemini CLI y OpenCode vuelcan su `--mcp-config`, el `.gemini/settings.json` de la carpeta y `OPENCODE_CONFIG_CONTENT`; chips «Figma» y «Navegador» con su ayuda; «MCP completo» muestra el aviso (cancelar no cambia nada), se guarda, añade Notion a los archivos, a `TABLE.md` y a la sesión nueva (chip «Notion»); con `.gemini` sin permiso de escritura, volver a archivos filtrados muestra el error y Gemini CLI no arranca; arreglado, lo quita.
- Revisión: revisión separada de Codex (2 altas, 4 medias), corregidas: un error al quitar Notion se daba por bueno; carrera entre preparar y cambiar el modo; Table podía pisar entradas de la persona con el mismo nombre; la carpeta de la mesa como enlace simbólico; permisos perdidos al reescribir; y el navegador como vía a Notion con «archivos filtrados».
- Sin comprobar: sesiones reales autorizadas, un frame de Figma y un tablero de Pinterest leídos por el agente; omp con `.omp/mcp.json`.
