# Table · FLOC*

Una mesa de trabajo visual para reunir el contexto, el diseño, las referencias y las sesiones de agentes de cada proyecto de FLOC*.

**Estado: definición y preparación.** Este repositorio contiene documentación y un ensayo técnico acotado (`spikes/desktop-001/`, tarea T-001); todavía no hay una aplicación de producto.

Table es el nombre de trabajo del repositorio. El documento inicial llamaba a la propuesta «Lienzo FLOC*». La identidad y el nombre definitivo siguen abiertos.

## Qué estamos construyendo

- Un lienzo por proyecto, vinculado a su ficha de Notion y a un único archivo de Figma.
- Referencias web, notas y conexiones junto al trabajo que ayudan a explicar.
- Una terminal abierta a los arneses que elija cada usuario. Codex y Claude Code son opciones, no dependencias exclusivas del producto.
- Notion como contexto persistente compartido entre arneses; la selección del lienzo aporta el contexto de cada tarea.
- Publicación deliberada de resultados en el portal del cliente, en una fase posterior.

La primera validación será de uso interno. El consumo de memoria y la edición web integrada condicionan la elección técnica.

## Documentación

| Documento | Qué resuelve |
| --- | --- |
| [Producto](docs/product.md) | Problema, experiencia y alcance. |
| [Decisiones](docs/decisions.md) | Qué está acordado, qué se propone y qué falta resolver. |
| [Arquitectura](docs/architecture.md) | Componentes, responsabilidades y límites. |
| [Contexto de Notion](docs/notion-context.md) | Campos, permisos y entrega de contexto a los arneses. |
| [Terminal y arneses](docs/harnesses.md) | Compatibilidad básica y conexión con el lienzo. |
| [Validación de memoria](docs/memory-validation.md) | Cómo medir el coste real sin inventar presupuestos. |
| [Fases](docs/roadmap.md) | Hitos y criterios de salida. |
| [T-001](docs/tasks/001-desktop-spike.md) | Prueba técnica del contenedor de escritorio (completada). |
| [T-002](docs/tasks/002-mesa-y-enlaces.md) | Primera tarea de producto: mesa libre y enlaces con «Añadir URL». |
| [Fuentes](docs/research/sources.md) | Evidencia técnica consultada y límites de esa evidencia. |
| [Resultados de T-001](docs/research/001-desktop-spike-results.md) | Entorno, comandos y resultados del ensayo de escritorio. |
| [Evaluación de OpenCove](docs/research/opencove-evaluation.md) | Revisión de una posible base; usada como referencia. |

## Trabajar con Claude Code y Codex

**Claude Code y Codex colaborarán en el desarrollo de Table.** Ambos pueden construir y revisar; los roles se asignan por tarea. Comparten las instrucciones de [AGENTS.md](AGENTS.md). [CLAUDE.md](CLAUDE.md) es el punto de entrada para Claude Code y remite a esa misma base.

Lee producto, decisiones y fases antes de implementar. Trabaja en una tarea comprobable cada vez y actualiza los documentos afectados con lo aprendido. La primera tarea está **completada**: ver sus [resultados](docs/research/001-desktop-spike-results.md).

Para compartir el contexto con Claude Code:

> Vamos a colaborar en Table con Codex. Lee README.md, CLAUDE.md, AGENTS.md, docs/product.md, docs/decisions.md y docs/roadmap.md. Revisa la propuesta y señala dudas o contradicciones antes de empezar la implementación. La tarea inicial propuesta está en docs/tasks/001-desktop-spike.md.

## Estado técnico

Base del prototipo aceptada ([D-010](docs/decisions.md)): Electron + React + TypeScript con WebContentsView, tras el ensayo T-001. React Flow, xterm.js, node-pty y SQLite siguen siendo piezas candidatas. Rust/Tauri no se eligió para el prototipo. **El stack definitivo del producto sigue abierto.**

## Información del repositorio

Repositorio público: mantener aquí especificaciones, ejemplos sintéticos y resultados técnicos sin datos identificables de clientes. Credenciales, sesiones, exportaciones de Notion, capturas privadas y datos de proyectos se guardan fuera de Git.

No se ha elegido una licencia de distribución. La visibilidad pública del repositorio no sustituye esa decisión.

Documentación inicial: 26 de octubre de 2026.
