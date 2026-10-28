# Table · FLOC*

Una mesa de trabajo visual para reunir el contexto, el diseño, las referencias y las sesiones de agentes de cada proyecto de FLOC*.

**Estado a 2026-10-28: prototipo funcional en `app/`.** Fase 1 cerrada por decisión del usuario ([D-018](docs/decisions.md)), con validaciones pendientes de T-006. Fase 2 en curso: T-007 a T-012 implementadas, pendientes de completar las pruebas con arneses y cuentas reales. El ensayo `spikes/desktop-001/` se conserva como evidencia de T-001.

Table es el nombre de trabajo del repositorio. El documento inicial llamaba a la propuesta «Lienzo FLOC*». La identidad y el nombre definitivo siguen abiertos.

## Qué estamos construyendo

- Mesas individuales que se crean libremente, con contexto de Notion y enlaces añadidos en Table. Lo habitual es un archivo de Figma por proyecto, pero se admiten varios.
- Referencias web, notas y conexiones junto al trabajo que ayudan a explicar.
- Una terminal abierta a los arneses que elija cada usuario. Codex y Claude Code son opciones, no dependencias exclusivas del producto.
- Notion como contexto persistente compartido entre arneses; la selección del lienzo aporta el contexto de cada tarea.
- Contexto por archivos (`TABLE.md` y `notion/`), resultados como tarjetas y MCP de Table para leer y modificar la mesa y usar sus webs. Figma utiliza su MCP oficial; Notion completo es opcional por mesa. El MCP de Chrome se retiró ([D-021](docs/decisions.md)).
- Publicación deliberada de resultados en el portal del cliente, en una fase posterior.

La validación es de uso interno. T-001 validó el navegador mínimo y el escenario A de memoria; T-002 midió B de forma parcial. El flujo completo de una mesa real y el escenario C con dos agentes siguen pendientes; ver la [hoja de ruta](docs/roadmap.md) y la [validación de memoria](docs/memory-validation.md).

## Documentación

| Documento | Qué resuelve |
| --- | --- |
| [Producto](docs/product.md) | Problema, experiencia y alcance. |
| [Decisiones](docs/decisions.md) | Qué está acordado, qué se propone y qué falta resolver. |
| [Arquitectura](docs/architecture.md) | Implementación del prototipo, responsabilidades y límites. |
| [Contexto de Notion](docs/notion-context.md) | Campos, permisos y entrega de contexto a los arneses. |
| [Terminal y arneses](docs/harnesses.md) | Compatibilidad básica y conexión con el lienzo. |
| [Validación de memoria](docs/memory-validation.md) | Cómo medir el coste real sin inventar presupuestos. |
| [Fases](docs/roadmap.md) | Hitos y criterios de salida. |
| [T-001](docs/tasks/001-desktop-spike.md) | Prueba técnica del contenedor de escritorio (completada). |
| [T-002](docs/tasks/002-mesa-y-enlaces.md) | Primera tarea de producto completada: mesa libre y enlaces con «Añadir URL». |
| [T-006](docs/tasks/006-validacion-fase-1.md) | Validaciones de Fase 1 que pasan al uso real en Fase 2. |
| [T-007](docs/tasks/007-terminal-universal.md) | Terminal universal y sesiones desacoplables. |
| [T-008](docs/tasks/008-contexto-y-resultados.md) | Contexto por archivos, selección y resultados. |
| [T-009](docs/tasks/009-contexto-notion-completo.md) | Lectura y selección del contexto filtrado de Notion. |
| [T-010](docs/tasks/010-mcp-de-los-agentes.md) | Configuración de MCP por arnés; el navegador externo quedó sustituido por T-012. |
| [T-011](docs/tasks/011-mcp-de-table.md) | Herramientas del agente para operar sobre la mesa. |
| [T-012](docs/tasks/012-el-agente-trabaja-en-table.md) | Navegación dentro de Table, actividad visible y «Seguir al agente». |
| [Fuentes](docs/research/sources.md) | Evidencia técnica consultada y límites de esa evidencia. |
| [Resultados de T-001](docs/research/001-desktop-spike-results.md) | Entorno, comandos y resultados del ensayo de escritorio. |
| [Resultados de T-002](docs/research/002-mesa-y-enlaces-results.md) | App de mesas: construcción, revisión de Codex, pruebas y memoria. |
| [Diseño](docs/design.md) | Estructura, interacción y principios visuales de la interfaz. |
| [Evaluación de OpenCove](docs/research/opencove-evaluation.md) | Revisión de una posible base; usada como referencia. |

## Trabajar con Claude Code y Codex

**Claude Code y Codex colaborarán en el desarrollo de Table.** Ambos pueden construir y revisar; los roles se asignan por tarea. Comparten las instrucciones de [AGENTS.md](AGENTS.md). [CLAUDE.md](CLAUDE.md) es el punto de entrada para Claude Code y remite a esa misma base.

Lee producto, decisiones y fases antes de implementar. Trabaja en una tarea comprobable cada vez y actualiza los documentos afectados con lo aprendido. El siguiente hito es validar el flujo real de Fase 2 y los pendientes heredados de T-006; no darlo por completado por disponer de tests o smoke sintéticos.

Para compartir el contexto con Claude Code:

> Vamos a colaborar en Table con Codex. Lee README.md, CLAUDE.md, AGENTS.md, docs/product.md, docs/decisions.md y docs/roadmap.md. La aplicación está en app/; T-007 a T-012 están implementadas con pruebas reales pendientes. Consulta la tarea afectada y distingue implementación, pruebas sintéticas y uso real antes de continuar.

## Estado técnico

El prototipo utiliza Electron + React + TypeScript con `WebContentsView` ([D-010](docs/decisions.md)), React Flow y un JSON por mesa ([D-017](docs/decisions.md)), y xterm.js + node-pty para la terminal (T-007). SQLite queda como alternativa si crecen las necesidades del almacenamiento; Rust/Tauri no se eligió para el prototipo. **El stack definitivo y la distribución del producto siguen abiertos.**

Las comprobaciones de tipos, tests y smoke se registran con fecha y alcance en cada tarea; las últimas correcciones de auditoría están en [T-012](docs/tasks/012-el-agente-trabaja-en-table.md). Esa evidencia es anterior al ajuste de interfaz del 28 de octubre y no acredita las pruebas pendientes con cuentas reales.

## Información del repositorio

Repositorio público: mantener aquí especificaciones, ejemplos sintéticos y resultados técnicos sin datos identificables de clientes. Credenciales, sesiones, exportaciones de Notion, capturas privadas y datos de proyectos se guardan fuera de Git.

No se ha elegido una licencia de distribución. La visibilidad pública del repositorio no sustituye esa decisión.

Documentación inicial: 26 de octubre de 2026. Estado documental revisado: 28 de octubre de 2026.
