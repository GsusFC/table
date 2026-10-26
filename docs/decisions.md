# Decisiones

Fecha inicial: 2026-10-26. Este registro distingue lo acordado de las recomendaciones técnicas.

## Aceptadas

| ID | Decisión | Motivo y procedencia |
| --- | --- | --- |
| D-001 | Herramienta interna de FLOC* primero. | Documento guía del usuario: validar con uso real antes de pensar en producto. |
| D-002 | Notion es la fuente de verdad del contexto del proyecto. | Documento guía y confirmación posterior del usuario: «El contexto puede ser Notion». |
| D-003 | Lo habitual es un archivo de Figma por proyecto, con muchas páginas. Table no limita el número de archivos por mesa. | Forma de trabajo descrita por el usuario. Origen del enlace modificado por D-012: ya no se lee de `WORK Figma File`, lo añade el usuario en Table. Precisado el 2026-10-26: pueden añadirse varios archivos, pero el caso normal es uno con muchas páginas. |
| D-004 | Orden: proyecto en un sitio → agentes → publicar. | Fases decididas en el documento guía. |
| D-005 | La terminal es una pieza permanente, abierta a arneses alternativos. | Aclaración del usuario: poder ejecutar otros arneses además de Codex y Claude Code. Sustituye la recomendación de evolucionar obligatoriamente hacia UI propias por proveedor. |
| D-006 | Cada usuario utiliza su autenticación con cada arnés/proveedor. | Aclaración del usuario. No implica que una suscripción autorice cualquier cliente ni que Table gestione sus tokens. |
| D-007 | Claude Code y Codex colaborarán en el desarrollo de Table. | Documento guía y aclaración del usuario del 2026-10-26: Claude Code también ayudará en el desarrollo y recibirá esta documentación. Ambos pueden construir y revisar; no hay roles fijos. |
| D-008 | Documentación del producto en `GsusFC/table`. | Destino indicado por el usuario; repositorio vacío al comenzar. |
| D-009 | El consumo de memoria es una preocupación prioritaria. | El usuario señala el conjunto Figma + Notion + Pinterest + terminal + dos agentes. Umbrales del escenario A aceptados el 2026-10-26 en [validación de memoria](memory-validation.md); B y C sin fijar. |
| D-010 | Electron + React + TypeScript, con `WebContentsView` para la web integrada, como base del prototipo de Fase 1. Revisable si el escenario B de memoria no cumple sus umbrales. | Decisión expresa del usuario del 2026-10-26, tras recomendación del asistente, basada en [T-001](research/001-desktop-spike-results.md): login, sesión, edición y portapapeles reales en Figma y Pinterest; memoria 39 % por debajo de Figma de escritorio; descarga sin crecimiento residual. No decide lienzo, terminal ni almacenamiento (P-002, P-004, P-005), ni el stack definitivo del producto. Sustituye a P-001 y P-003. |
| D-011 | Equipo de referencia para las mediciones: Apple M2 Pro, 16 GiB, macOS 27.2 (el Mac del usuario). | Confirmado por el usuario el 2026-10-26. Las mediciones de T-001 se hicieron en él con las demás aplicaciones cerradas. La carga habitual con todas las herramientas abiertas no está medida. |
| D-012 | Los enlaces de una mesa los añade el usuario en Table (clic derecho → «Añadir URL»), a medida que los tiene. Table reconoce el servicio por la URL (Figma, Notion, Pinterest u otra web) y todos se abren como tarjeta web con el mismo ciclo de vida; el reconocimiento solo añade capacidades propias de cada servicio. Credenciales y preferencias comunes van en una configuración global. | Decisión del usuario del 2026-10-26: leer los enlaces de campos de Notion no es usable (campos duplicados como `Pinterest`/`Pinterest Link`, fichas sin enlaces). Consecuencias: los campos URL de la base de Notion dejan de ser la fuente de los enlaces y se cierra la duda entre los dos campos de Pinterest. Notion sigue siendo la fuente del contexto (D-002). |
| D-013 | Las mesas se crean libremente, como un proyecto de Claude: nombre propio y, en ese momento o después, los enlaces que se tengan (ficha o base de Notion, Figma, Pinterest u otros). El catálogo de servicios reconocidos debe poder ampliarse. | Decisión del usuario del 2026-10-26. Responde a cómo se crea una mesa: no se elige de una lista de Notion. Objetivo declarado por el usuario: que los agentes reciban contexto de todo lo que se añada a la mesa, idealmente con las plataformas conectadas a los agentes. Ese objetivo es la dirección de Fase 2; el modelo de conexión sigue abierto (P-013, P-014). |

La exclusión de `Budget` del contexto de agentes es un requisito del documento guía, desarrollado en [contexto de Notion](notion-context.md). Su cumplimiento requiere controlar las vías reales de acceso, no solo el prompt inicial.

## Propuestas pendientes

| ID | Propuesta | Qué falta para decidir |
| --- | --- | --- |
| P-001 | Base propia con Electron + React + TypeScript. | Aceptada como D-010 el 2026-10-26. |
| P-002 | React Flow para el lienzo. | Validar interacción con tarjetas, foco y cantidad representativa de nodos. |
| P-003 | WebContentsView para la web activa, si se elige Electron. | Aceptada como D-010 el 2026-10-26. El aviso real de Figma con cambios sin sincronizar no se ha observado; el usuario indica que en el estudio no se edita Figma sin conexión. Riesgo residual: desconexión accidental durante la edición, cubierto por el mismo mecanismo probado con una página sintética. |
| P-004 | xterm.js + node-pty para la terminal, si se elige Electron. | Compatibilidad con arneses, señales, redimensionado y empaquetado. |
| P-005 | SQLite para los datos propios de la mesa. | Modelo mínimo y necesidad de copias, exportación y migraciones. JSON sigue siendo alternativa inicial. |
| P-006 | Campos de Notion configurables, resueltos por ID y tipo. | Validar esquema real y el alcance del asistente de configuración. |
| P-007 | Notion por API para la ficha y conexión filtrada para agentes. | Comprobar permisos, lista de campos y vías alternativas de acceso. |
| P-008 | Un editor web de trabajo y referencias descargadas cuando sea seguro. | Medir coste y pérdida de continuidad; no confundir foco con contenido residente. |
| P-009 | MCP local de Table y exportación temporal de contexto. | Contrato mínimo, permisos y compatibilidad de cada arnés. |
| P-010 | Uso individual local para el primer prototipo. | Confirmar quién prueba la herramienta y cómo se recupera o comparte una mesa. |
| P-011 | Tarjetas de decisión y conexiones con significado. | Validar su valor en sesiones reales sin ampliar prematuramente el alcance. |
| P-012 | Publicación mediante API de Notion, sin depender de Workers. | Revisar estructura real del portal y operaciones necesarias. |
| P-013 | Servicio como unidad extensible: patrón de URL que lo reconoce y capacidades opcionales (vista web, miniatura, contexto para agentes). Añadir un servicio nuevo no toca el modelo de tarjetas. | Concretar en Fase 1 con Figma, Notion y Pinterest; validar que un servicio nuevo se añade sin cambiar el núcleo. |
| P-014 | Contexto para agentes desde la mesa: Table actúa como pasarela (MCP local, P-009) y cada servicio aporta su contexto con su filtro. Las conexiones directas de las plataformas con los agentes (MCP oficiales de Notion o Figma) serían opcionales por servicio. | Elegir en Fase 2. La pasarela permite filtrar (`Budget`, `Opportunity`); una conexión directa da más contexto con menos trabajo, pero no garantiza exclusiones (ver [contexto de Notion](notion-context.md#exclusión-real-de-información)). |

## Alternativas y revisión

| Alternativa | Situación |
| --- | --- |
| Mesa como base de código | El repo público revisado solo tenía README y licencia; último commit 2026-03-30. No hay implementación pública acreditada que reutilizar. Esto no prueba abandono del producto privado. |
| OpenCove como base | Revisado estáticamente y arrancado en modo desarrollo el 2026-10-26 (commit `e10604b9`). Recomendación del asistente: usarlo como referencia, no como base; T-001 se construyó así. Ver [evaluación](research/opencove-evaluation.md). |
| ccanvas como base | Referencia candidata con Tauri/Rust; no adoptada ni auditada. |
| Rust/Tauri | No elegido para el prototipo (D-010). Tauri 2 usa WebKit en macOS y sus vistas web hijas son inestables; reevaluar solo si el escenario B o C de memoria no cumple con Electron. |
| Electron con un componente Rust | Posibilidad futura si un perfil de rendimiento identifica una necesidad concreta. |
| UI propia de Claude y Codex como destino obligatorio | Reemplazada por D-005. Adaptadores opcionales siguen siendo posibles. |

## Preguntas abiertas

- Bases relacionadas (`Account`, `Opportunity`): no compartidas con la integración. Decidir si el contexto de los agentes necesita el cliente; `Opportunity` sigue excluida por defecto.
- Cómo se representan las páginas y frames de un archivo de Figma en el lienzo. Propuesta: un único editor web cargado por archivo y tarjetas ligeras de página o frame (miniatura por API) que llevan ese editor al nodo, en vez de un editor por página. Cada editor de Figma cargado ocupó ~1,6 GiB en T-001.
- Uso de `Opportunity`, `Lead` y `Notion Link`, para decidir si el contexto entregado a los agentes los incluye. Ver [contexto de Notion](notion-context.md#esquema-comprobado).
- Notion como tarjeta web editable dentro de Table: login y edición no probados en T-001.
- Planes, permisos y límites disponibles de Notion/Figma en el estudio.
- Carga habitual del equipo de referencia con todas las herramientas abiertas (equipo fijado en D-011). Otros equipos del estudio, si los hay.
- Usuarios iniciales, uso individual o compartido y política de copia/exportación.
- Arneses que se probarán realmente y mecanismos de autenticación admitidos por cada uno.
- Stack definitivo, distribución, firma, actualizaciones, licencia y nombre final.
- Tecnología e interfaz actuales del escáner de evidencia, antes de plantear su integración.

## Cómo actualizar este registro

Añadir fecha, evidencia o instrucción, motivo y consecuencias. Una propuesta solo pasa a aceptada cuando exista una decisión expresa o una elección de implementación dentro de la autorización recibida. Si cambia una decisión, conservar su historia y enlazar la que la sustituye. No reabrir decisiones aceptadas por preferencia del agente.
