# Trabajar en Table con Claude Code

Lee `AGENTS.md` antes de actuar: contiene las instrucciones comunes del proyecto. Después consulta `docs/decisions.md` y `docs/roadmap.md`.

## Situación actual

- Estado revisado el 2026-10-28. El repositorio contiene el prototipo funcional en `app/` y el ensayo de T-001 en `spikes/desktop-001/`.
- Fase 1 cerrada por decisión del usuario (D-018), con pendientes de T-006 trasladados al uso real en Fase 2. T-007 a T-012 están implementadas: terminal, contexto y resultados por archivos, contenido filtrado de Notion, MCP de plataformas, MCP de Table y navegación en las webs de Table. Falta completar las pruebas con arneses y cuentas reales. Decisiones en `docs/decisions.md`; estado y siguiente hito en `docs/roadmap.md`; diseño en `docs/design.md`.
- T-001 está completada: apto para continuar, con límites. Figma y Pinterest funcionan integrados y la memoria del escenario A cumple los umbrales. Estado en `docs/tasks/001-desktop-spike.md` y resultados en `docs/research/001-desktop-spike-results.md`.
- Base del prototipo aceptada: Electron + React + TypeScript con `WebContentsView` (D-010), lienzo con React Flow y un JSON por mesa (D-017). Terminal con node-pty + xterm.js (T-007, propuesta P-004 en uso).
- Las webs del agente se usan dentro de Table, sin el MCP de Chrome (D-021). El diseño se edita por el MCP oficial de Figma; la actividad de esas llamadas requiere que el agente la anuncie. Notion completo es opcional por mesa (D-019): cambiar el modo no reconfigura el MCP de una sesión ya abierta, y Table no controla los MCP externos del arnés.
- No presentar el cierre de Fase 1 como validación completa de memoria: A tiene resultados, B solo mediciones parciales y C con dos agentes no se ha ejecutado. La publicación al cliente sigue en Fase 3.

## En cada sesión

1. Identifica la petición del usuario y la tarea concreta que cubre.
2. Lee los documentos relevantes; usa `docs/decisions.md` para distinguir decisiones de propuestas.
3. Explica el resultado que vas a producir y ejecuta el trabajo autorizado.
4. Comprueba el comportamiento afectado y registra resultados reales, errores y límites.
5. Actualiza el estado de la tarea y las decisiones si hay evidencia nueva o una decisión expresa del usuario.

Continúa las acciones reversibles y necesarias dentro del encargo sin pedir confirmaciones rutinarias. Una propuesta de la documentación no equivale a una decisión aprobada. Si una elección material cambia el alcance, explica sus consecuencias antes de fijarla.

Claude Code y Codex colaboran en el desarrollo de Table. Ambos pueden implementar y revisar; no hay un constructor o revisor fijo. Al retomar trabajo del otro, revisa el estado del repositorio y la tarea antes de editar. Deja documentados los cambios, las comprobaciones y el siguiente paso para facilitar la continuidad.

Esta colaboración para construir Table es independiente de su terminal: el producto debe poder ejecutar también otros arneses.
