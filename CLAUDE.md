# Trabajar en Table con Claude Code

Lee `AGENTS.md` antes de actuar: contiene las instrucciones comunes del proyecto. Después consulta `docs/decisions.md` y `docs/roadmap.md`.

## Situación actual

- El repositorio contiene documentación inicial, no una aplicación.
- Estamos en Fase 0: preparación y validación de supuestos.
- La tarea propuesta para comenzar es `docs/tasks/001-desktop-spike.md`.
- No hay un stack confirmado, dependencias instaladas, scripts de desarrollo ni pruebas ejecutadas.

## En cada sesión

1. Identifica la petición del usuario y la tarea concreta que cubre.
2. Lee los documentos relevantes; usa `docs/decisions.md` para distinguir decisiones de propuestas.
3. Explica el resultado que vas a producir y ejecuta el trabajo autorizado.
4. Comprueba el comportamiento afectado y registra resultados reales, errores y límites.
5. Actualiza el estado de la tarea y las decisiones si hay evidencia nueva o una decisión expresa del usuario.

Continúa las acciones reversibles y necesarias dentro del encargo sin pedir confirmaciones rutinarias. Una propuesta de la documentación no equivale a una decisión aprobada. Si una elección material cambia el alcance, explica sus consecuencias antes de fijarla.

Claude Code y Codex colaboran en el desarrollo de Table. Ambos pueden implementar y revisar; no hay un constructor o revisor fijo. Al retomar trabajo del otro, revisa el estado del repositorio y la tarea antes de editar. Deja documentados los cambios, las comprobaciones y el siguiente paso para facilitar la continuidad.

Esta colaboración para construir Table es independiente de su terminal: el producto debe poder ejecutar también otros arneses.
