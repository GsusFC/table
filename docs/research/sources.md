# Fuentes y alcance de la revisión

Fuentes públicas consultadas inicialmente el 2026-10-26; alcance de las comprobaciones actualizado el 2026-10-28 con la evidencia del repositorio. Las fuentes externas fundamentan decisiones técnicas, pero no prueban por sí solas que Table funcione. Las pruebas de cuentas, hardware, edición y consumo realizadas después se distinguen en el estado de comprobaciones y en las tareas enlazadas. Esta actualización documental no supone una nueva consulta de las fuentes externas.

## Escritorio y memoria

| Fuente primaria | Hallazgo relevante |
| --- | --- |
| [Electron: contenido web integrado](https://www.electronjs.org/docs/latest/tutorial/web-embeds) | Desaconseja `<webview>`; WebContentsView está fuera del DOM y exige coordinar su geometría. |
| [Electron: WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view) | Vista gestionada desde el proceso principal. |
| [Electron: webContents](https://www.electronjs.org/docs/latest/api/web-contents) | Ralentizar actividad en segundo plano no equivale a cerrar contenido; el cierre puede respetar `beforeunload`. |
| [Electron: seguridad](https://www.electronjs.org/docs/latest/tutorial/security) | Aislamiento del contenido remoto, acceso al sistema y validación de mensajes entre procesos. |
| [Electron: rendimiento](https://www.electronjs.org/docs/latest/tutorial/performance) | Medición y control de recursos; no aporta un presupuesto de RAM específico para Table. |
| [Figma: BrowserView](https://www.figma.com/blog/introducing-browserview-for-electron/) | Antecedente histórico de 2017 sobre Electron en Figma; no adoptar esa API obsoleta como recomendación actual. |
| [Google: OAuth para escritorio](https://developers.google.com/identity/protocols/oauth2/native-app) | Autorización en navegador externo; no garantiza transferir una sesión web de terceros a la app. |
| [Tauri 2: procesos](https://v2.tauri.app/concept/process-model/) | Usa motores web del sistema; difieren por plataforma. |
| [Tauri 2: vistas web](https://v2.tauri.app/reference/javascript/api/namespacewebview/) | Crear vistas hijas dentro de una ventana requiere la funcionalidad `unstable`. |
| [Tauri 3: CEF](https://v3.tauri.app/develop/cef/) | Chromium integrado disponible en alpha; no es una garantía de madurez ni de bajo consumo. |

## Notion y Figma

| Fuente primaria | Hallazgo relevante |
| --- | --- |
| [Notion MCP: seguridad](https://developers.notion.com/guides/mcp/mcp-security-best-practices) | El cliente puede acceder al contenido accesible por el usuario. Omitir campos del prompt no restringe ese acceso. |
| [Notion: contenido de páginas](https://developers.notion.com/guides/data-apis/working-with-page-content) | API para crear páginas y añadir bloques; el botón Publicar no necesita depender de Workers. |
| [Figma: archivos y nodos](https://developers.figma.com/docs/rest-api/file-endpoints/) | Referencias por archivo/nodo, versiones y renderizaciones. Definir caché y actualización. |
| [Figma: eventos](https://developers.figma.com/docs/rest-api/webhooks-events/) | `FILE_VERSION_UPDATE` corresponde a una versión nombrada; `FILE_UPDATE` no es un aviso instantáneo por frame. |
| [Figma: límites](https://developers.figma.com/docs/rest-api/rate-limits/) | Comprobar permisos y límites aplicables antes de fijar frecuencia de refresco. |

## Arneses y autenticación

| Fuente primaria | Hallazgo relevante |
| --- | --- |
| [Claude Code: autenticación](https://code.claude.com/docs/en/authentication) | Inicio de sesión oficial del usuario y configuración de cuentas. |
| [Claude Code: condiciones de integración](https://code.claude.com/docs/en/legal-and-compliance) | Distingue ejecución del binario oficial con cuenta del usuario de ofrecer login propio o intermediar credenciales. |
| [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) | Integración programática; la página mantiene restricciones sobre ofrecer login de Claude en productos de terceros. |
| [SDK con un plan Claude](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) | Actualización de 2026-10-07 indica uso del SDK y apps de terceros con límites de suscripción. Aclarar su encaje con la página anterior antes de prometer una UI propia con esa autenticación. |
| [Codex app-server](https://developers.openai.com/codex/app-server/) | Protocolo para clientes propios: autenticación administrada, sesiones, aprobaciones y eventos. No es requisito de una terminal universal. |

## Referencias de producto y posibles bases

| Proyecto | Evidencia revisada | Límite de la conclusión |
| --- | --- | --- |
| [Mesa](https://github.com/Mesa-App/mesa-app) | Solo README y licencia en el árbol público. [Último commit revisado](https://github.com/Mesa-App/mesa-app/commit/f67e40e7e2e6a9e5706ab18a122865bf87338726): 2026-03-30. | No hay implementación pública acreditada que reutilizar. No demuestra abandono de la aplicación privada. |
| [OpenCove](https://github.com/DeadWaveWave/opencove) | Commit `e10604b9`: Electron 41, React, `WebContentsView`, node-pty, MIT; alpha. Revisión estática y arranque en desarrollo. | Sin login web ni arneses probados. Ver [evaluación](opencove-evaluation.md). |
| [ccanvas](https://github.com/DevoidSloth/ccanvas) | README/árbol: Tauri/Rust, terminales y Apache-2.0. | No se ha ejecutado ni auditado; cambia la arquitectura respecto a Electron. |
| [Fabric MCP](https://fabric.so/features/mcp) | Documenta conexión con clientes externos como Claude Code y Codex. | No sostener la afirmación de que toda herramienta creativa tiene IA cerrada. |

Kosmik, Milanote, Maestri y Podium se mencionaron como referencias en el documento guía. No se han auditado ni se usan como evidencia para elegir una base técnica.

## Estado de las comprobaciones

- Revisión documental de fuentes públicas: realizada.
- Inspección funcional de repos candidatos: OpenCove revisado y arrancado ([evaluación](opencove-evaluation.md)); ccanvas no realizada.
- Equipo de referencia: Apple M2 Pro, 16 GiB, macOS 27.2, confirmado por el usuario (D-011).
- Acceso y esquema de Notion: base y campos comprobados; conexión y ficha reales probadas por el usuario ([T-003](../tasks/003-ajustes-y-ficha-notion.md)). T-009 comprobó el límite de consultas del plan y pasó a modo `view`; falta verificar el recorrido de las 63 páginas del piloto con ese modo ([T-009](../tasks/009-contexto-notion-completo.md)).
- Figma: token, miniaturas y apertura de un frame probados con un archivo real ([T-005](../tasks/005-frames-figma.md)); la autorización y el flujo MCP de los arneses siguen pendientes de completar ([T-010](../tasks/010-mcp-de-los-agentes.md)).
- Autenticación, sesión y edición integradas de Figma/Pinterest: comprobaciones reales de T-001, con límites en sus [resultados](001-desktop-spike-results.md). No validan el recorrido web completo de un agente de T-012.
- Memoria: escenario A medido y apto con límites; B parcialmente medido; B completo y C con dos agentes pendientes ([protocolo y resultados](../memory-validation.md)). El cierre de Fase 1 fue por decisión del usuario, sin completar T-006 (D-018).
- Implementación: prototipo en `app/`, Fase 1 cerrada y T-007 a T-012 implementadas. La verificación integrada de tipos, tests y smoke tras la auditoría del 2026-10-27 se registra en [T-012](../tasks/012-el-agente-trabaja-en-table.md); es anterior al ajuste de interfaz del 28 de octubre y no sustituye las pruebas pendientes con arneses y cuentas reales. La publicación al portal permanece en Fase 3.

Revalidar las fuentes al implementar, especialmente autenticación, licencias, versiones, capacidades y APIs experimentales. Registrar la versión exacta que se pruebe; no usar «latest» como evidencia reproducible.
