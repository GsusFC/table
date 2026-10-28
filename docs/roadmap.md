# Fases y estado

Estado revisado el 2026-10-28. **Fase 1 cerrada por decisión del usuario, con validaciones pendientes ([D-018](decisions.md)). Fase 2 en curso: terminal (T-007), contexto y resultados por archivos (T-008, T-009), MCP de Figma y Notion en cada agente compatible (T-010, [D-019](decisions.md)), MCP de Table (T-011, [D-020](decisions.md)) y el agente en las webs de Table, a la vista, sin Chrome (T-012, [D-021](decisions.md)). T-007 a T-012 están implementadas; no se da por validado el flujo real completo.**

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
- [x] Registrar la decisión técnica y el protocolo de memoria aplicable: [D-010](decisions.md) y umbrales del escenario A en [validación de memoria](memory-validation.md). B se fijó después en D-017; C sigue sin umbrales.

Salida: evidencia de que la edición integrada y su ciclo de vida funcionan, decisiones documentadas y una tarea de producto delimitada. Un fallo de login o de estado pendiente puede cambiar el alcance; no se declara la fase libre de bloqueos por anticipado.

## Fase 1 · El proyecto en un sitio

- [x] Crear mesas libremente, con nombre, y añadir enlaces al crearlas o después ([D-013](decisions.md)). T-002.
- [x] «Añadir URL» con clic derecho; reconocer Figma, Notion, Pinterest y otras webs, y crear la tarjeta web ([D-012](decisions.md)). T-002.
- [x] Configuración global: credenciales de Notion y preferencias comunes, fuera de la mesa y de Git. T-003 (Notion por OAuth) y T-005 (token de Figma).
- [x] Mostrar la ficha autorizada de Notion de la mesa por API. T-003, con «Vincular proyecto».
- [x] Mostrar una selección de frames del archivo de Figma enlazado. T-005, con un solo editor por archivo.
- [x] Editar en el navegador integrado según el resultado de T-001; referencias con URL y captura con fecha. T-002 (Figma, Notion y Pinterest).
- [x] Crear notas, conexiones y posiciones persistentes. T-004.
- [x] Reabrir la mesa sin perder trabajo y distinguir caché de información actual. Cierre forzado probado 30 veces (T-006); fichas y miniaturas indican su fecha.
- [ ] Validar memoria del flujo sin agentes, cierre y recuperación. Pendiente con una mesa real; la fase se cerró igualmente por decisión del usuario ([D-018](decisions.md)).

Salida: una sesión de trabajo real que pueda retomarse, con resultados de uso y consumo registrados. No implica colaboración simultánea ni integración completa de agentes.

## Fase 2 · Terminal universal y contexto compartido

- [x] Integrar PTY y perfiles de arnés configurables. T-007: una sesión probada por el usuario; falta completar pruebas con los demás arneses reales.
- [ ] Probar al menos dos arneses disponibles con la autenticación oficial de cada usuario; uno alternativo a Codex/Claude Code si está disponible y autorizado.
- [x] Consultar contexto filtrado de Notion y entregar la selección explícita del lienzo. T-008 («Enviar al agente»), T-009 (contenido completo filtrado y elegible) y T-010 (MCP de Notion opcional por mesa).
- [x] Ofrecer exportación temporal para arneses sin MCP. T-008/T-009 (`TABLE.md` y `notion/`).
- [x] Registrar resultados como tarjetas con sus fuentes mediante contrato explícito o importación. T-008 los registra desde `resultados/`; T-011 añade el contrato explícito: `table_add_result` registra el archivo y lo conecta con sus fuentes (falta la prueba del usuario con un arnés real).
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

El siguiente hito es validar T-007 a T-012 con los arneses reales y completar los pendientes de T-006: autorizar Figma y, si la mesa lo permite, Notion; revisar el contexto del piloto por modo `view`; pedir a un agente que lea la selección, añada una nota conectada a sus fuentes, devuelva un resultado y borre algo con confirmación; que abra el frame V1 y diga qué ve en Table, y que levante una web de prueba y la enseñe en la mesa. Incluir dos sesiones, cierre y consumo de memoria; los umbrales de C aún deben fijarse. No se ha creado ni cerrado una tarea adicional de validación de Fase 2.

La verificación integrada tras la auditoría del 2026-10-27 (tipos, tests y smoke Electron) está registrada en [T-012](tasks/012-el-agente-trabaja-en-table.md). Es anterior al ajuste de interfaz del 28 de octubre: actividad persistente con «Ver», modo de Notion visible y distinción entre MCP configurado y autorizado. No acredita una nueva ejecución sobre ese ajuste ni las pruebas con cuentas reales.

No ejecutar toda la hoja de ruta de forma automática. Cada sesión debe terminar con un resultado verificable y el estado real de su tarea.
