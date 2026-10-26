# Fases y estado

Fecha: 2026-10-26. **Estado actual: Fase 1 en curso. [T-002](tasks/002-mesa-y-enlaces.md) completada: app con mesas libres, «Añadir URL», webs integradas, ordenar con imán y descarga automática.**

Los hitos preservan el orden acordado. Los hallazgos de una prueba pueden cambiar una propuesta técnica sin ampliar la fase entera.

## Fase 0 · Preparación y pruebas de viabilidad

- [x] Consolidar visión, terminal universal y Notion como contexto en documentación inicial.
- [x] Preparar instrucciones compartidas para Claude Code y Codex.
- [x] Registrar fuentes revisadas y distinguirlas de pruebas ejecutadas.
- [x] Revisar esta base documental con el usuario y cerrar las decisiones pendientes que condicionen la primera tarea (D-010 a D-015).
- [x] Identificar equipo de prueba, RAM, usuarios iniciales y proyecto piloto. Equipo y RAM ([D-011](decisions.md)), usuarios: el equipo de FLOC* ([D-014](decisions.md)), mesas individuales ([D-015](decisions.md)), proyecto piloto con archivo de Figma configurado localmente.
- [x] Validar campos, permisos y enlaces de Notion. Integración de solo lectura conectada a la base de proyectos; esquema, estados y uso de campos comprobados ([contexto de Notion](notion-context.md#esquema-comprobado)). La duda de Pinterest la cierra [D-012](decisions.md).
- [x] Ejecutar [T-001: prueba de escritorio](tasks/001-desktop-spike.md). Apto para continuar, con límites ([resultados](research/001-desktop-spike-results.md)).
- [x] Comparar una base propia con la reutilización que realmente ahorre trabajo. Mesa no ofrece implementación pública; OpenCove [evaluado](research/opencove-evaluation.md) y usado como referencia; ccanvas descartado (Tauri). Resultado: base propia ([D-010](decisions.md)).
- [x] Registrar la decisión técnica y el protocolo de memoria aplicable: [D-010](decisions.md) y umbrales del escenario A en [validación de memoria](memory-validation.md). B y C sin umbrales.

Salida: evidencia de que la edición integrada y su ciclo de vida funcionan, decisiones documentadas y una tarea de producto delimitada. Un fallo de login o de estado pendiente puede cambiar el alcance; no se declara la fase libre de bloqueos por anticipado.

## Fase 1 · El proyecto en un sitio

- [x] Crear mesas libremente, con nombre, y añadir enlaces al crearlas o después ([D-013](decisions.md)). T-002.
- [x] «Añadir URL» con clic derecho; reconocer Figma, Notion, Pinterest y otras webs, y crear la tarjeta web ([D-012](decisions.md)). T-002.
- [ ] Configuración global: credenciales de Notion y preferencias comunes, fuera de la mesa y de Git.
- [ ] Mostrar la ficha autorizada de Notion de la mesa por API.
- [ ] Mostrar una selección de frames del archivo de Figma enlazado.
- [x] Editar en el navegador integrado según el resultado de T-001; referencias con URL y captura con fecha. T-002 (Figma, Notion y Pinterest).
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

[T-002](tasks/002-mesa-y-enlaces.md) está completada. Siguen en Fase 1: configuración global, ficha de Notion por API, frames de Figma, notas y conexiones, y la validación de memoria del escenario B (umbrales propuestos en los [resultados de T-002](research/002-mesa-y-enlaces-results.md#memoria-con-1-3-y-6-tarjetas-2026-10-26), pendientes de aceptación). No ejecutar toda la hoja de ruta de forma automática. Cada sesión debe terminar con un resultado verificable y el estado real de su tarea.
