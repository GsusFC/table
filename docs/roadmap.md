# Fases y estado

Fecha: 2026-10-26. **Estado actual: documentación inicial en Fase 0. No hay implementación ni pruebas del producto.**

Los hitos preservan el orden acordado. Los hallazgos de una prueba pueden cambiar una propuesta técnica sin ampliar la fase entera.

## Fase 0 · Preparación y pruebas de viabilidad

- [x] Consolidar visión, terminal universal y Notion como contexto en documentación inicial.
- [x] Preparar instrucciones compartidas para Claude Code y Codex.
- [x] Registrar fuentes revisadas y distinguirlas de pruebas ejecutadas.
- [ ] Revisar esta base documental con el usuario y cerrar las decisiones pendientes que condicionen la primera tarea.
- [ ] Identificar equipo de prueba, RAM, usuarios iniciales y proyecto piloto.
- [ ] Validar campos, permisos y enlaces de Notion; resolver los dos campos de Pinterest.
- [ ] Ejecutar [T-001: prueba de escritorio](tasks/001-desktop-spike.md).
- [ ] Comparar una base propia con la reutilización que realmente ahorre trabajo. Mesa no ofrece implementación en el repo público revisado; OpenCove [evaluado](research/opencove-evaluation.md) con recomendación de usarlo como referencia, pendiente de decisión; ccanvas sin auditar.
- [ ] Registrar la decisión técnica y el protocolo de memoria aplicable.

Salida: evidencia de que la edición integrada y su ciclo de vida funcionan, decisiones documentadas y una tarea de producto delimitada. Un fallo de login o de estado pendiente puede cambiar el alcance; no se declara la fase libre de bloqueos por anticipado.

## Fase 1 · El proyecto en un sitio

- [ ] Mostrar proyectos leídos de la base configurada de Notion, con filtros de estado.
- [ ] Crear la mesa y mostrar la ficha autorizada del proyecto piloto.
- [ ] Mostrar una selección de frames de su único archivo Figma.
- [ ] Editar en el navegador integrado según el resultado de T-001.
- [ ] Abrir Pinterest y webs; guardar referencias con URL, captura y fecha.
- [ ] Crear notas, conexiones y posiciones persistentes.
- [ ] Reabrir la mesa sin perder trabajo y distinguir caché de información actual.
- [ ] Validar memoria del flujo sin agentes, cierre y recuperación.

Salida: una sesión de trabajo real que pueda retomarse, con resultados de uso y consumo registrados. No implica colaboración simultánea ni integración completa de agentes.

## Fase 2 · Terminal universal y contexto compartido

- [ ] Integrar PTY y perfiles de arnés configurables.
- [ ] Probar al menos dos arneses disponibles con la autenticación oficial de cada usuario; uno alternativo a Codex/Claude Code si está disponible y autorizado.
- [ ] Consultar contexto filtrado de Notion y entregar la selección explícita del lienzo.
- [ ] Ofrecer exportación temporal para arneses sin MCP.
- [ ] Registrar resultados como tarjetas con sus fuentes mediante contrato explícito o importación.
- [ ] Preservar solicitudes de permiso, errores y estados de los arneses.
- [ ] Validar dos sesiones, procesos hijos, recuperación y limpieza de recursos.
- [ ] Probar los límites de exclusión de datos y documentar accesos que Table no controla.

Salida: cambiar de arnés conserva el contexto compartido del proyecto, con diferencias de capacidades visibles. No se requiere una UI propia de cada proveedor.

## Fase 3 · Publicar al portal

- [ ] Inspeccionar y mapear los destinos reales de Live Process y Entregables.
- [ ] Mostrar contenido, versión y destino antes de publicar.
- [ ] Escribir mediante la API adecuada y registrar IDs remotos.
- [ ] Evitar duplicados en reintentos y tratar fallos parciales.
- [ ] Verificar el comportamiento de notificaciones. El objetivo del documento guía es escritura sin aviso por defecto y aviso en entregables, sin prometer control no probado sobre Notion.
- [ ] Mantener el contexto interno separado del contenido que verá el cliente.

Salida: publicación deliberada y trazable de un resultado revisado. Workers y eventos de Figma son automatizaciones opcionales posteriores, no requisitos del botón.

## Fase 4 · Extensiones

- [ ] Evaluar integración del escáner de evidencia de marca y su metodología actual.
- [ ] Detectar cambios de frames desde una revisión con una política de versiones definida.
- [ ] Agrupar referencias y extraer paletas si aporta valor al uso real.
- [ ] Evaluar colaboración, exportación y distribución más allá del piloto.

## Próxima tarea

[T-001](tasks/001-desktop-spike.md) es la primera tarea propuesta. No ejecutar toda la hoja de ruta de forma automática. Cada sesión debe terminar con un resultado verificable y el estado real de su tarea.
