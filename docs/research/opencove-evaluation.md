# Evaluación de OpenCove como base o referencia

Fecha: 2026-10-26. Estado: revisión estática y arranque en modo desarrollo. No se han probado login de Figma/Pinterest, edición web ni arneses dentro de OpenCove.

Responde al punto de Fase 0 del [roadmap](../roadmap.md): comparar una base propia con la reutilización que realmente ahorre trabajo. La conclusión es una **recomendación**, no una decisión aceptada.

## Objeto evaluado

| Dato | Valor |
| --- | --- |
| Repositorio | [DeadWaveWave/opencove](https://github.com/DeadWaveWave/opencove), licencia MIT |
| Commit | `e10604b9d940ed7752c6fe931e23024d6003aa55` (2026-10-17), tag `v0.4.0-nightly.20261018.1` |
| Stack | Electron 41.5.1, React 19, TypeScript, `@xyflow/react` 12, xterm.js 6, node-pty 1.1.0, better-sqlite3 + drizzle |
| Tamaño | ~1 840 ficheros TS/TSX, ~252 000 líneas en `src/` |
| Madurez | Alpha declarada, versión 0.4.0; ~690 ficheros de test unitarios y ~210 e2e |

El fork [Jevari/opencove](https://github.com/Jevari/opencove) se descartó: 0 commits propios y 277 por detrás del original en la fecha de revisión.

## Método

1. Clonado fuera de este repositorio y fijado al commit anterior.
2. Revisión estática por áreas: web integrada y seguridad Electron; terminal y agentes; persistencia y red; lienzo, modelo y licencia. Las afirmaciones siguientes citan ficheros del commit evaluado.
3. Ejecución con `pnpm dev` y `userData` aislado, sin abrir webs ni lanzar agentes.
4. Copia y hash previos de `~/.claude/settings.json`, `~/.codex/config.toml` y `~/.codex/hooks.json`, comprobados después del arranque y del cierre.

Reproducción (macOS arm64, Node 22.22, pnpm 9.6.0 vía corepack):

```sh
git clone https://github.com/DeadWaveWave/opencove
git -C opencove checkout e10604b9d940ed7752c6fe931e23024d6003aa55
cd opencove
corepack pnpm install --frozen-lockfile
# Copiar antes ~/.claude/settings.json y ~/.codex/{config.toml,hooks.json}: ver «Incidencia».
OPENCOVE_DEV_USER_DATA_DIR=<carpeta-de-evaluación> corepack pnpm dev
```

## Resultado de la ejecución

- La instalación compiló los módulos nativos para Electron 41 sin errores; el arranque abrió la ventana con el lienzo vacío.
- Abre un servidor de control local en `127.0.0.1` con puerto efímero y token. La interfaz web del worker queda desactivada por defecto.
- Al cerrar el proceso de desarrollo no quedaron procesos de OpenCove ni puertos escuchando.

### Memoria observada

Una única instantánea con `footprint` sobre el árbol de procesos, lienzo vacío y modo desarrollo, en un Apple M2 Pro con 16 GiB:

| Proceso | `phys_footprint` |
| --- | --- |
| GPU (Electron Helper) | 819 MB |
| Renderer | 285 MB |
| Proceso principal | 232 MB |
| Worker | 64 MB |
| PTY host y utilidades | 26 MB |
| **Total** | **1 419 MB** |

No es comparable con el escenario A de [validación de memoria](../memory-validation.md): build de desarrollo con React sin optimizar y Vite, una sola muestra, sin umbrales fijados y sin carga de trabajo. Solo indica que el lienzo vacío ya no es ligero y que el proceso GPU domina la instantánea. Medir un build empaquetado antes de sacar conclusiones.

### Incidencia: modificación de la configuración de Codex

Al arrancar, OpenCove ejecuta `cleanupLegacyManagedHooksAtStartup` desde el proceso principal y el worker (`src/app/main/index.ts:265`, `src/app/worker/index.ts:90`). En la prueba **eliminó de `~/.codex/config.toml` las seis entradas `[hooks.state."…/.codex/hooks.json:…"]`** que registraban la confianza en hooks del usuario. Ni `config.toml` ni `hooks.json` contenían referencias a OpenCove.

Causa: `LEGACY_CODEX_HOOK_REFERENCE_PATTERN` (`src/contexts/agent/infrastructure/legacyManagedHookCleanup.ts:96`) acepta cualquier tabla de confianza que apunte a `~/.codex/hooks.json`, sin comprobar que ese fichero sea de OpenCove. Se restauró la copia previa y se verificó el hash tras el cierre. `~/.claude/settings.json` y `~/.codex/hooks.json` no cambiaron.

Consecuencia para Table: una herramienta que solo debía abrir un lienzo alteró la configuración global de un arnés. Es exactamente lo que [harnesses.md](../harnesses.md) pide evitar.

Comunicado al proyecto con un caso sintético: [DeadWaveWave/opencove#464](https://github.com/DeadWaveWave/opencove/issues/464) (2026-10-26).

## Hallazgos frente a los requisitos de Table

| Área | OpenCove | Encaje con Table |
| --- | --- | --- |
| Web integrada | `WebContentsView` dentro de una vista anfitriona, geometría sincronizada con el lienzo (`src/app/main/websiteWindow/`). Contenido remoto con `sandbox`, `contextIsolation`, sin Node ni preload (`websiteWindowEnsureView.ts:88-95`). | Coincide con P-003. Referencia útil. |
| Ciclo de vida web | Estados activa/templada/fría, presupuesto de vistas activas (1 por defecto, máximo 6), captura JPEG al ocultar y descarte tras 20 min (`websiteWindowPolicy.ts`, `websiteWindowLifecycle.ts`). | Similar a activa/conservada/descargada de [memoria](../memory-validation.md). |
| Cierre seguro | Cierra con `close({ waitForBeforeUnload: false })` (`websiteWindowLifecycle.ts:79`); sin manejo de `will-prevent-unload`. | **No cumple**: puede descartar ediciones pendientes de Figma o Notion. |
| Login y popups | `setWindowOpenHandler` siempre deniega y convierte el popup en otro nodo (`websiteWindowWebContents.ts:31-40`). Particiones `persist:` compartida, por perfil o incógnito; no por proyecto. | `[INFERENCIA]` Rompe flujos OAuth que dependan de `window.opener`. No probado con Figma. |
| IPC | Preload amplio (sistema de ficheros, agentes, `controlSurface.invoke`); `registerHandledIpc` no valida `senderFrame` (`src/app/main/ipc/handle.ts`). Sin CSP en el renderer. | Por debajo de lo exigido en [AGENTS.md](../../AGENTS.md): validar llamadas entre procesos. |
| Terminal | node-pty en un `utilityProcess` supervisado (`mainTerminalProcessEngineFactory.ts`), scrollback de 400 000 caracteres persistido en SQLite. | Buen aislamiento. Persistir salida de terminal en claro requiere una política de retención que Table aún no tiene. |
| Arneses | Lista cerrada: `claude-code`, `codex`, `opencode`, `gemini`, `pi`, `kimi` (`src/shared/contracts/dto/agent.ts`). Otros arneses, solo como terminal sin perfil propio. | Contrario a D-005: no hay perfiles arbitrarios de ejecutable, argumentos y entorno. |
| Permisos de agentes | `agentFullAccess: true` por defecto (`agentSettings.defaults.ts:27`): añade `--dangerously-skip-permissions` a Claude Code y `--dangerously-bypass-approvals-and-sandbox` a Codex (`AgentCommandFactory.ts:62,82`). | **No cumple** la regla de no aceptar permisos del arnés automáticamente. |
| Integración con el shell | Inyecta shims de `claude`, `codex` y `pi` en `PATH` y cambia `ZDOTDIR` en sus terminales (`TerminalAgentTelemetryScripts.ts`). | Intrusivo. Table no debe alterar el entorno del arnés sin declararlo. |
| Secretos | Variables de entorno de workspace en SQLite y tokens en JSON `0600`; no usa Keychain ni `safeStorage`. | Table exige mecanismos del sistema para credenciales. |
| Red saliente | Sin telemetría de terceros encontrada. Actualizador contra GitHub Releases de DeadWaveWave, plugins desde GitHub, catálogo de modelos desde raw.githubusercontent. | Habría que redirigir o eliminar cada salida en un fork. |
| Plugins | Proceso Node hijo con acceso completo al sistema, sin modelo de permisos (`docs/plugins/RUNTIME.md`). | No reutilizable como extensión segura. |
| Lienzo | React Flow con 10 tipos de nodo. Añadir un tipo nativo toca ~15–20 ficheros y los datos comparten el campo `task` (`types.ts:269-280`). Sin virtualización; imágenes a resolución completa. | Coste alto para tarjetas de Notion, frames y referencias. Riesgo de memoria con muchas referencias. |
| Proyecto | `WorkspaceState` ligado a una ruta local y worktrees; sin metadatos externos. Única integración: GitHub vía `gh`. | No hay nada de Notion, Figma ni Pinterest que reutilizar. |
| Licencia y marca | MIT. Un fork redistribuido necesita nombre e icono distintos (`TRADEMARKS.md`). El CLA solo aplica a contribuciones hacia el original. | Sin bloqueo legal para copiar piezas conservando el aviso MIT. |

## Recomendación

**OpenCove como referencia, no como base.** Propuesta del asistente pendiente de decisión del usuario.

Motivos:

- Su dominio gira en torno a repositorios, worktrees y una lista cerrada de agentes. Adaptarlo a Notion, Figma y arneses arbitrarios supone reescribir el modelo y gran parte del lienzo.
- Varios comportamientos por defecto contradicen requisitos de Table: aprobaciones de agentes omitidas, cierre web que ignora trabajo pendiente, modificación de la configuración global de Codex e IPC sin validar el emisor. Un fork obligaría a auditar y corregir ~252 000 líneas que no controlamos.
- Es alpha con un mantenedor principal; seguir el original añadiría coste de integración continuo.

Piezas que conviene estudiar al implementar T-001 y Fase 1, sin copiar a ciegas:

- Gestión de `WebContentsView` sincronizada con el lienzo, incluida la desactivación del zoom de la página principal para no descuadrar la geometría (`src/app/main/index.ts`, `src/app/main/websiteWindow/`).
- Política de vistas activas, captura al ocultar y descarte temporizado, **añadiendo** respeto a `beforeunload` y `will-prevent-unload`.
- Prompt de permisos web con decisión recordada por origen.
- PTY en `utilityProcess` con supervisor y reinicio.
- Migraciones SQLite con `user_version`, copia previa y apartado de bases corruptas.
- Reglas de dependencias entre capas comprobadas por script (`harness/architecture/`).

Copiar código exige conservar el aviso de copyright MIT.

## No comprobado

- Login y edición de Figma y Pinterest en un nodo web de OpenCove.
- Consumo de un build empaquetado, con webs y terminales abiertas.
- Comportamiento con arneses reales; no se lanzó ningún agente para no ejecutarlo con permisos omitidos.
- Pruebas automáticas del propio OpenCove.
