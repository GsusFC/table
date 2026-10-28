# Arquitectura del prototipo

Estado a 2026-10-28: aplicación implementada en `app/`. Fase 1 cerrada por decisión del usuario ([D-018](decisions.md)); Fase 2 en curso, con T-007 a T-012 implementadas y pruebas reales pendientes. Este documento describe el prototipo y separa las extensiones futuras; no fija el stack definitivo del producto.

## Reparto de responsabilidades

| Componente | Autoridad y trabajo |
| --- | --- |
| Notion | Ficha, brief, estado, decisiones consolidadas y destinos de publicación del proyecto. |
| Figma | Diseño editable, nodos y versiones del archivo. |
| Table | Posiciones, relaciones, referencias capturadas, notas locales y metadatos de sesiones/resultados. |
| Arnés | Bucle del agente, modelos, autenticación y herramientas propias. |

Table puede guardar una caché fechada de contenido remoto, pero no debe presentar esa copia como información actual sin comprobar su vigencia. Los datos propios de Table necesitan persistencia y recuperación: no todo lo local es descartable.

## Piezas en uso

| Pieza | Implementación | Estado y evidencia |
| --- | --- | --- |
| Contenedor | Electron | Aceptado para el prototipo (D-010); validado en T-001. |
| Interfaz | React + TypeScript | Aceptado para el prototipo (D-010). |
| Lienzo | React Flow | Aceptado en D-017 e implementado en T-002; no es un motor de edición de Figma. |
| Web integrada | WebContentsView | Aceptado para el prototipo (D-010); login, sesión, edición y descarga segura validados en T-001. |
| Terminal | xterm.js + node-pty | Implementada en T-007; panel con sesiones y terminal desacoplable. Faltan pruebas con todos los arneses reales. |
| Datos locales | Un JSON por mesa | Aceptado en D-017: escritura atómica, cola por mesa, validación y migración del esquema. SQLite queda como alternativa futura. |
| Contexto | MCP oficial de Notion por OAuth, filtrado local, `TABLE.md` y `notion/` | T-003, T-008 y T-009; lectura por modo `view`. Falta comprobar el recorrido completo del piloto. |
| Herramientas del agente | MCP de Table y adaptadores por arnés | T-010/T-011/T-012: mesa, selección, resultados con fuentes y webs de Table. Figma usa su MCP oficial; Notion completo es opcional por mesa. |

La interfaz React representa tarjetas, notas, conexiones y terminales. El proceso principal gestiona el almacén, las vistas web, las conexiones y credenciales, los procesos PTY y el servidor MCP de Table. `preload` expone una API acotada y las llamadas entre procesos se validan. Las webs remotas están aisladas del acceso a Node y a la terminal.

Las responsabilidades se encuentran en `app/src/main/store/`, `web/`, `terminal/`, `notion/`, `figma/`, `settings/` y `agent/`; los contratos compartidos están en `app/src/shared/`. Un proceso puente stdio conecta el arnés con el MCP local de Table mediante socket y un testigo limitado a la sesión. No se ha adoptado un proceso auxiliar general para el trabajo intensivo; cualquier cambio requiere evidencia de rendimiento.

## Navegador integrado

- No usar iframes como supuesto de compatibilidad con cualquier web.
- Electron desaconseja `<webview>`; WebContentsView es una vista fuera del DOM, con posición y tamaño coordinados desde el proceso principal.
- Login, persistencia de sesión, edición y portapapeles de Figma y Pinterest se probaron en T-001. Esto no acredita la integración completa de sus herramientas de agente. Abrir un login en el navegador del sistema no transfiere automáticamente la sesión web a Table.
- Persistir sesiones con mecanismos del contenedor, sin extraer cookies del navegador del usuario.
- Distinguir cuenta web, token de API, autorización MCP y cuenta del arnés. No son la misma sesión.
- Probar arrastrar, copiar/pegar, permisos, descargas, foco, teclado y escalado.
- Separar capturas y enlaces persistentes del ciclo de vida de la vista web.
- Al cerrar contenido, respetar edición pendiente y fallos de sincronización. Una página puede impedir el cierre; no se elude esa señal para ahorrar RAM.

Al entrar en una tarjeta, la web ocupa una superficie estable en el panel principal (D-016); no sigue el pan ni el zoom del lienzo. El límite habitual de dos webs cargadas descarga las menos usadas cuando es seguro. Un editor de Figma se reutiliza entre tarjetas del mismo archivo (T-005), salvo las excepciones de actividad de agentes de T-012.

El agente navega y actúa sobre esas mismas vistas con el MCP de Table, sin el MCP de Chrome (D-021). Una cola por vista serializa operaciones; se comprueban permisos y cancelación antes de actuar y tras esperas. La actividad mantiene las vistas necesarias cargadas y puede superar el límite de dos. El estado visible y «Seguir al agente» se describen en [diseño](design.md) y [arneses](harnesses.md#navegador-de-table-t-012).

## Modelo de datos y extensiones

El esquema actual de mesa es la versión 3 (`app/src/shared/model.ts`). El almacén lee versiones 1 y 2 migradas a la actual y las guarda como versión 3 en la siguiente escritura. Los datos de sesión, las exportaciones de contexto y la futura publicación tienen ciclos de vida distintos del JSON de la mesa.

| Entidad o representación | Datos y estado |
| --- | --- |
| Mesa | ID local, nombre, enlaces añadidos por el usuario con su servicio reconocido, posiciones y versión del esquema (D-013). |
| Tarjeta web | ID, URL, servicio, título, posición, tamaño y fecha de captura. |
| Frame | Tarjeta web de Figma con referencia de archivo/nodo y metadatos de miniatura. No es un tipo de elemento separado. |
| Referencia web | Tarjeta web con captura fechada; las anotaciones se representan como notas conectadas. |
| Nota | Texto plano, posición, tamaño y fechas; persiste en el JSON de la mesa. |
| Relación | Conexión sin dirección entre elementos de la mesa. El significado de la relación sigue propuesto (P-011). |
| Sesión | Perfil de arnés, mesa, directorio de trabajo, estado e historial acotado en memoria. No se persiste para reanudarla al cerrar Table. |
| Contexto entregado | `TABLE.md`, índice y páginas filtradas de `notion/`, selección enviada y procedencia fechada. No se presupone un historial persistente por ejecución. |
| Resultado | Nombre del archivo de `resultados/`, tipo, metadatos y conexiones con elementos fuente. |
| Publicación (Fase 3, no implementada) | Resultado y versión, destino, fecha, estado e IDs de Notion devueltos: contrato por definir. |

No almacenar secretos en estas entidades. Las credenciales de Table se cifran con `safeStorage`; cada arnés conserva sus propias autorizaciones. Exportaciones y datos privados se mantienen fuera del repositorio; la política de retención e historial de sesiones sigue pendiente.

## Interfaces y límites implementados

Lectura de proyecto, gestión de vistas web, ejecución de terminal y almacenamiento tienen módulos separados. La publicación sigue fuera de la implementación. Los perfiles de arnés no forman parte del modelo de tarjetas.

Table entrega una ficha con lista cerrada de campos y contenido de Notion filtrado mediante archivos y `table_get_project`. El filtro de texto es heurístico; no garantiza excluir información que un arnés consulte por otra vía. Notion completo es opcional por mesa (D-019); cambiar el modo limita las herramientas web de Table y la configuración de sesiones nuevas, pero no retira el MCP de una sesión ya abierta. Ver [contexto de Notion](notion-context.md#exclusión-real-de-información).

El catálogo de servicios reconoce Figma, Notion, Pinterest y web genérica por URL (T-002, P-013). Las integraciones añaden ficha o miniaturas. Las conexiones directas se configuran por arnés: MCP oficial de Figma para diseño, MCP de Notion si la mesa lo permite y MCP de Table para operar en el lienzo y sus webs. La autorización de Figma y Notion la gestiona cada arnés: un chip «configurado» no confirma que esté autorizado. El catálogo, los adaptadores y sus límites están en [arneses](harnesses.md).

## Memoria y alternativas

Rust puede incorporarse a tareas locales que lo justifiquen. No acelera por sí mismo las webs de terceros ni la inferencia remota. Tauri 2 usa motores web del sistema; en macOS eso supone WebKit y cambia la premisa de Chromium. Sus vistas web hijas están documentadas como API inestable. Tauri 3 ofrece CEF en alpha, con Chromium distribuido y coste de tamaño asociado. Son hechos de la documentación consultada, no pruebas de Table.

La decisión se toma a partir de [mediciones](memory-validation.md), no de cifras genéricas de frameworks. Tampoco se presume que integrar varias herramientas consuma menos que usarlas por separado.

## Publicación

En Fase 3, resolver destinos estables de Live Process y Entregables. Mostrar el resultado y la versión que se publicará. Registrar IDs remotos y evitar duplicados por reintentos. Una escritura silenciosa puede ser visible para el cliente; las notificaciones son un comportamiento separado que deberá comprobarse.

La API de Notion puede crear páginas y añadir bloques sin Workers. Los Workers se evaluarían para automatizaciones remotas posteriores. En Figma, un evento de versión nombrada no equivale a cada autoguardado; un evento de archivo tampoco identifica por sí solo el frame modificado.

Ver [fuentes y alcance de la verificación](research/sources.md).
