# Arquitectura propuesta

Estado: contenedor y web integrada aceptados para el prototipo de Fase 1 ([D-010](decisions.md)); el resto sigue siendo propuesta. Solo existe el ensayo de T-001, no la aplicación.

## Reparto de responsabilidades

| Componente | Autoridad y trabajo |
| --- | --- |
| Notion | Ficha, brief, estado, decisiones consolidadas y destinos de publicación del proyecto. |
| Figma | Diseño editable, nodos y versiones del archivo. |
| Table | Posiciones, relaciones, referencias capturadas, notas locales y metadatos de sesiones/resultados. |
| Arnés | Bucle del agente, modelos, autenticación y herramientas propias. |

Table puede guardar una caché fechada de contenido remoto, pero no debe presentar esa copia como información actual sin comprobar su vigencia. Los datos propios de Table necesitan persistencia y recuperación: no todo lo local es descartable.

## Candidata principal

| Pieza | Candidata | Estado |
| --- | --- | --- |
| Contenedor | Electron | Aceptado para el prototipo (D-010); validado en T-001. |
| Interfaz | React + TypeScript | Aceptado para el prototipo (D-010). |
| Lienzo | React Flow | Propuesto; no confundir con motor de edición de Figma. |
| Web integrada | WebContentsView | Aceptado para el prototipo (D-010); login, sesión, edición y descarga segura validados en T-001. |
| Terminal | xterm.js + node-pty | Propuesto; PTY real. |
| Datos locales | SQLite | Propuesto; JSON todavía posible para una prueba acotada. |
| Contexto | API de Notion + herramientas filtradas + exportación temporal | Contrato por validar. |

La interfaz representa tarjetas. El proceso principal gestiona ventanas, contenido web, permisos y credenciales. La ejecución de terminales y el trabajo intensivo deben aislarse de la interfaz y no bloquear el proceso principal. La elección entre un proceso auxiliar y otros mecanismos se toma al implementar, con mediciones.

## Navegador integrado

- No usar iframes como supuesto de compatibilidad con cualquier web.
- Electron desaconseja `<webview>`; WebContentsView es una vista fuera del DOM, con posición y tamaño coordinados desde el proceso principal.
- Validar login real de Figma y Pinterest. Abrir un login en el navegador del sistema no transfiere automáticamente la sesión web a Table.
- Persistir sesiones con mecanismos del contenedor, sin extraer cookies del navegador del usuario.
- Distinguir cuenta web, token de API, autorización MCP y cuenta del arnés. No son la misma sesión.
- Probar arrastrar, copiar/pegar, permisos, descargas, foco, teclado y escalado.
- Separar capturas y enlaces persistentes del ciclo de vida de la vista web.
- Al cerrar contenido, respetar edición pendiente y fallos de sincronización. Una página puede impedir el cierre; no se elude esa señal para ahorrar RAM.

Una propuesta de interacción es ampliar la tarjeta activa en una superficie de trabajo estable. Todavía debe compararse con editar dentro de la tarjeta sobre el lienzo.

## Modelo de datos mínimo propuesto

| Entidad | Datos necesarios |
| --- | --- |
| Mesa | ID local, referencia al proyecto de Notion, posiciones y versión del esquema. |
| Tarjeta | ID, tipo, posición, referencia a origen y fecha de actualización. |
| Frame | File key, node ID, versión cuando exista y caché de miniatura. |
| Referencia | URL, fecha de captura, artefacto local y nota. |
| Relación | Tarjeta origen/destino y, si se valida, significado de la relación. |
| Sesión | Perfil de arnés, proyecto, directorio de trabajo, estado y referencia a registros. |
| Contexto entregado | Proyecto, fuentes, selección, fecha, versión de filtrado e identificador de ejecución. |
| Publicación | Resultado y versión, destino, fecha, estado e IDs de Notion devueltos. |

No almacenar secretos en estas entidades. Los registros pueden contener datos privados: se mantienen fuera del repositorio y con una política de retención por definir.

## Interfaces propuestas

Mantener separadas las responsabilidades de lectura de proyecto, gestión de vistas web, ejecución de terminal, almacenamiento y publicación. Los perfiles de arnés no deben invadir el modelo de tarjetas.

Para un contexto externo, resolver explícitamente qué campos y bloques están permitidos. La conexión filtrada entrega el contexto tanto a MCP como a exportaciones temporales. Los resultados requieren referencias a las fuentes utilizadas para poder relacionarlos con el lienzo.

## Memoria y alternativas

Rust puede incorporarse a tareas locales que lo justifiquen. No acelera por sí mismo las webs de terceros ni la inferencia remota. Tauri 2 usa motores web del sistema; en macOS eso supone WebKit y cambia la premisa de Chromium. Sus vistas web hijas están documentadas como API inestable. Tauri 3 ofrece CEF en alpha, con Chromium distribuido y coste de tamaño asociado. Son hechos de la documentación consultada, no pruebas de Table.

La decisión se toma a partir de [mediciones](memory-validation.md), no de cifras genéricas de frameworks. Tampoco se presume que integrar varias herramientas consuma menos que usarlas por separado.

## Publicación

En Fase 3, resolver destinos estables de Live Process y Entregables. Mostrar el resultado y la versión que se publicará. Registrar IDs remotos y evitar duplicados por reintentos. Una escritura silenciosa puede ser visible para el cliente; las notificaciones son un comportamiento separado que deberá comprobarse.

La API de Notion puede crear páginas y añadir bloques sin Workers. Los Workers se evaluarían para automatizaciones remotas posteriores. En Figma, un evento de versión nombrada no equivale a cada autoguardado; un evento de archivo tampoco identifica por sí solo el frame modificado.

Ver [fuentes y alcance de la verificación](research/sources.md).
