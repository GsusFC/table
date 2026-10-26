# Fuentes y alcance de la revisión

Consultadas el 2026-10-26. Son fuentes de decisiones técnicas; no constituyen pruebas de que Table funcione. No se han validado cuentas privadas, planes del estudio, hardware, edición integrada ni consumo real.

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
| [OpenCove](https://github.com/DeadWaveWave/opencove) | README/árbol: Electron, React, terminales y licencia MIT; se declara alpha. | No se ha ejecutado ni auditado para este proyecto. |
| [ccanvas](https://github.com/DevoidSloth/ccanvas) | README/árbol: Tauri/Rust, terminales y Apache-2.0. | No se ha ejecutado ni auditado; cambia la arquitectura respecto a Electron. |
| [Fabric MCP](https://fabric.so/features/mcp) | Documenta conexión con clientes externos como Claude Code y Codex. | No sostener la afirmación de que toda herramienta creativa tiene IA cerrada. |

Kosmik, Milanote, Maestri y Podium se mencionaron como referencias en el documento guía. No se han auditado ni se usan como evidencia para elegir una base técnica.

## Estado de las comprobaciones

- Revisión documental de fuentes públicas: realizada.
- Inspección funcional de repos candidatos: no realizada.
- Acceso y esquema real de Notion/Figma del piloto: no comprobados.
- Autenticación de Figma/Pinterest dentro de Table: no probada.
- Memoria del equipo o del prototipo: no medida.
- Implementación de Table: no iniciada.

Revalidar las fuentes al implementar, especialmente autenticación, licencias, versiones, capacidades y APIs experimentales. Registrar la versión exacta que se pruebe; no usar «latest» como evidencia reproducible.
