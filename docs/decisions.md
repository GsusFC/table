# Decisiones

Fecha inicial: 2026-10-26. Este registro distingue lo acordado de las recomendaciones técnicas.

## Aceptadas

| ID | Decisión | Motivo y procedencia |
| --- | --- | --- |
| D-001 | Herramienta interna de FLOC* primero. | Documento guía del usuario: validar con uso real antes de pensar en producto. |
| D-002 | Notion es la fuente de verdad del contexto del proyecto. | Documento guía y confirmación posterior del usuario: «El contexto puede ser Notion». |
| D-003 | Un archivo de Figma por proyecto. | Forma de trabajo descrita por el usuario; enlace desde `WORK Figma File`. |
| D-004 | Orden: proyecto en un sitio → agentes → publicar. | Fases decididas en el documento guía. |
| D-005 | La terminal es una pieza permanente, abierta a arneses alternativos. | Aclaración del usuario: poder ejecutar otros arneses además de Codex y Claude Code. Sustituye la recomendación de evolucionar obligatoriamente hacia UI propias por proveedor. |
| D-006 | Cada usuario utiliza su autenticación con cada arnés/proveedor. | Aclaración del usuario. No implica que una suscripción autorice cualquier cliente ni que Table gestione sus tokens. |
| D-007 | Claude Code y Codex colaborarán en el desarrollo de Table. | Documento guía y aclaración del usuario del 2026-10-26: Claude Code también ayudará en el desarrollo y recibirá esta documentación. Ambos pueden construir y revisar; no hay roles fijos. |
| D-008 | Documentación del producto en `GsusFC/table`. | Destino indicado por el usuario; repositorio vacío al comenzar. |
| D-009 | El consumo de memoria es una preocupación prioritaria. | El usuario señala el conjunto Figma + Notion + Pinterest + terminal + dos agentes. No se ha fijado todavía un límite numérico. |

La exclusión de `Budget` del contexto de agentes es un requisito del documento guía, desarrollado en [contexto de Notion](notion-context.md). Su cumplimiento requiere controlar las vías reales de acceso, no solo el prompt inicial.

## Propuestas pendientes

| ID | Propuesta | Qué falta para decidir |
| --- | --- | --- |
| P-001 | Base propia con Electron + React + TypeScript. | Prueba del navegador integrado, memoria y decisión posterior. |
| P-002 | React Flow para el lienzo. | Validar interacción con tarjetas, foco y cantidad representativa de nodos. |
| P-003 | WebContentsView para la web activa, si se elige Electron. | Login, sesiones, edición, foco, geometría y cierre seguro. |
| P-004 | xterm.js + node-pty para la terminal, si se elige Electron. | Compatibilidad con arneses, señales, redimensionado y empaquetado. |
| P-005 | SQLite para los datos propios de la mesa. | Modelo mínimo y necesidad de copias, exportación y migraciones. JSON sigue siendo alternativa inicial. |
| P-006 | Campos de Notion configurables, resueltos por ID y tipo. | Validar esquema real y el alcance del asistente de configuración. |
| P-007 | Notion por API para la ficha y conexión filtrada para agentes. | Comprobar permisos, lista de campos y vías alternativas de acceso. |
| P-008 | Un editor web de trabajo y referencias descargadas cuando sea seguro. | Medir coste y pérdida de continuidad; no confundir foco con contenido residente. |
| P-009 | MCP local de Table y exportación temporal de contexto. | Contrato mínimo, permisos y compatibilidad de cada arnés. |
| P-010 | Uso individual local para el primer prototipo. | Confirmar quién prueba la herramienta y cómo se recupera o comparte una mesa. |
| P-011 | Tarjetas de decisión y conexiones con significado. | Validar su valor en sesiones reales sin ampliar prematuramente el alcance. |
| P-012 | Publicación mediante API de Notion, sin depender de Workers. | Revisar estructura real del portal y operaciones necesarias. |

## Alternativas y revisión

| Alternativa | Situación |
| --- | --- |
| Mesa como base de código | El repo público revisado solo tenía README y licencia; último commit 2026-03-30. No hay implementación pública acreditada que reutilizar. Esto no prueba abandono del producto privado. |
| OpenCove como base | Referencia candidata, no adoptada. No se ha ejecutado ni auditado su código para Table. |
| ccanvas como base | Referencia candidata con Tauri/Rust; no adoptada ni auditada. |
| Rust/Tauri | Evaluación conceptual. Puede aportar un motor local eficiente, pero la estrategia de navegador y la complejidad deben validarse. |
| Electron con un componente Rust | Posibilidad futura si un perfil de rendimiento identifica una necesidad concreta. |
| UI propia de Claude y Codex como destino obligatorio | Reemplazada por D-005. Adaptadores opcionales siguen siendo posibles. |

## Preguntas abiertas

- Identificadores de la base/data source de Notion y de las propiedades reales.
- Enlaces ausentes en el proyecto piloto y campo correcto entre `Pinterest` y `Pinterest Link`.
- Planes, permisos y límites disponibles de Notion/Figma en el estudio.
- RAM, sistema operativo y carga habitual de los equipos de prueba.
- Usuarios iniciales, uso individual o compartido y política de copia/exportación.
- Arneses que se probarán realmente y mecanismos de autenticación admitidos por cada uno.
- Stack definitivo, distribución, firma, actualizaciones, licencia y nombre final.
- Tecnología e interfaz actuales del escáner de evidencia, antes de plantear su integración.

## Cómo actualizar este registro

Añadir fecha, evidencia o instrucción, motivo y consecuencias. Una propuesta solo pasa a aceptada cuando exista una decisión expresa o una elección de implementación dentro de la autorización recibida. Si cambia una decisión, conservar su historia y enlazar la que la sustituye. No reabrir decisiones aceptadas por preferencia del agente.
