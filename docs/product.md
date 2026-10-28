# Producto

Estado a 2026-10-28: prototipo funcional; Fase 1 cerrada por decisión del usuario (D-018) y Fase 2 en curso, con T-007 a T-012 implementadas y pruebas reales pendientes. La publicación pertenece a Fase 3. Ver [fases y estado](roadmap.md).

## Qué es Table

Una aplicación de escritorio donde cada proyecto de FLOC* tiene una mesa visual: contexto de Notion, archivo de Figma, referencias de Pinterest y webs, notas y sesiones de agentes. Se valida dentro del estudio antes de valorar un producto para terceros.

El nombre de trabajo es Table; la propuesta original se denominaba Lienzo FLOC*.

## Problemas que aborda

| Problema | Comportamiento buscado |
| --- | --- |
| El proyecto está repartido entre herramientas. | Abrir una mesa que reúna sus vínculos y contexto. |
| Las referencias pierden relación con el diseño. | Colocarlas junto al frame relevante y conectarlas. |
| Hay que volver a explicar el proyecto a cada agente. | Consultar el mismo contexto autorizado de Notion, independientemente del arnés. |
| El portal del cliente se actualiza a mano. | Publicar resultados elegidos en destinos definidos, en Fase 3. |

## Principios acordados

1. FLOC* primero: resolver un flujo real antes de generalizar.
2. Notion conserva el contexto persistente del proyecto. Table muestra y utiliza ese contexto.
3. Lo habitual es un archivo de Figma por proyecto, con muchas páginas; la mesa admite varios archivos (D-003).
4. Terminal universal: el usuario elige el arnés. No hay una IA cerrada propia.
5. Cada arnés utiliza sus mecanismos de autenticación y el acceso que permita su proveedor.
6. Desarrollo colaborativo con Claude Code y Codex, con documentación e instrucciones compartidas y roles asignados por tarea.
7. Proyecto reunido, después integración de agentes y finalmente publicación.

## Experiencia y estado de implementación

1. Crear una mesa libremente, como un proyecto de Claude, y añadir en ese momento los enlaces que se tengan ([D-013](decisions.md)).
2. Añadir los enlaces a medida que se tienen: clic derecho → «Añadir URL». Table reconoce el servicio (Figma, Notion, Pinterest u otra web) y crea la tarjeta ([D-012](decisions.md)).
3. Añadir notas y conexiones.
4. Abrir una sesión con el arnés elegido y entregarle el contexto pertinente.
5. Pedir una comparación o propuesta a partir de frames y referencias seleccionados.
6. Revisar resultados; editar en Figma y conservar las decisiones aceptadas.
7. Publicar un resultado concreto en el portal del cliente cuando corresponda.

Los pasos 1 a 4 tienen implementación en el prototipo (T-002 a T-012), con validaciones de uso todavía abiertas. Los pasos 5 y 6 son el flujo real de Fase 2 que falta probar de extremo a extremo con arneses autorizados. El paso 7 no está implementado: corresponde a Fase 3.

El agente recibe `TABLE.md`, contenido filtrado en `notion/` y la selección enviada desde el lienzo. Los arneses compatibles reciben además el MCP de Table para leer y modificar la mesa y usar sus webs. Figma se edita con su MCP oficial; Notion completo es opcional por mesa (D-019). Con D-021 se retiró el MCP de Chrome: el trabajo web ocurre en Table, con actividad visible y «Seguir al agente». Table no observa las llamadas directas al MCP de Figma; el agente debe anunciar esa actividad.

El modo filtrado limita lo que Table entrega y permite en sus herramientas web, pero no impide el acceso mediante herramientas externas del arnés. El MCP completo de Notion puede leer presupuestos e importes; cambiar el modo de la mesa no retira ese MCP de una sesión ya abierta. Ver [exclusión real de información](notion-context.md#exclusión-real-de-información).

## Tarjetas

| Tipo | Comportamiento implementado |
| --- | --- |
| Web | Cualquier URL añadida por el usuario: Figma, Notion, Pinterest u otra web. Mismo ciclo de vida para todas (activa, conservada, descargada) y captura con fecha. El servicio reconocido añade capacidades: contexto de Notion por API, miniaturas y nodos de Figma por API. |
| Proyecto | Datos autorizados de la ficha de Notion enlazada, con su origen. |
| Frame | Frame o nodo seleccionable de un archivo de Figma: miniatura por API y referencia estable al nodo. Reutiliza el editor del archivo (T-005); la actividad del agente puede mantener editores adicionales, según T-012. |
| Referencia web | Tarjeta web con captura, URL y fecha; puede conectarse a notas. No es un tipo separado de tarjeta. |
| Nota | Texto interno del proceso. |
| Sesión | Terminal del arnés, perfil y estado de ejecución en el panel o desacoplada como tarjeta flotante. No se guarda como elemento persistente de la mesa ni sobrevive al cierre de Table (T-007). |
| Resultado | Archivo de `resultados/` importado como tarjeta (T-008); el MCP de Table permite conectarlo con sus fuentes mediante `table_add_result` (T-011). Quitar la tarjeta conserva el archivo. |

Está propuesto añadir una tarjeta de decisión con motivo, autor y estado. No es un requisito aprobado del primer prototipo.

## Contenido conectado y memoria

«Vivo» significa vinculado al origen y con una política de actualización visible. No significa mantener todas las aplicaciones ejecutándose continuamente.

La ficha de Notion puede representarse con datos de API. El navegador completo se activa cuando hace falta. Las referencias conservan una captura fechada para poder explicar qué se revisó, aunque el origen cambie.

Mostrar una captura en lugar de una web no demuestra que se haya liberado su memoria. El producto debe distinguir tarjeta, contenido cargado y proceso activo. Ver [validación de memoria](memory-validation.md).

## Interacción y validación pendiente

Entrar en una tarjeta web abre su contenido en el panel principal, junto al panel de agentes si está abierto (D-016). Se vuelve al lienzo con el control visible o `⌘⇧Esc`; no se captura Esc indiscriminadamente. Las sesiones pueden desacoplarse sin reiniciarse. Detalle de interacción en [diseño](design.md).

Quedan las pruebas reales de T-007 a T-012, los pendientes de T-006 y la medición de memoria con dos agentes. Implementación y smoke sintético no equivalen a validar ese flujo de trabajo.

## Fuera del primer alcance

- Colaboración simultánea entre miembros del estudio.
- Interfaz gráfica propia para cada proveedor de IA.
- Orquestación automática de varios arneses.
- Un motor de dibujo equivalente al de Figma.
- Modelo propio, alojamiento de modelos o servicio de inferencia.
- Publicación automática de todos los cambios de diseño.
- Integración del escáner de evidencia de marca.

La colaboración, distribución y futura integración del escáner se mantienen abiertas. Antes de integrar el escáner se revisarán su tecnología, metodología e interfaz actuales.

## Señales para continuar

- Recuperar el contexto y las referencias de un proyecto con menos pasos que hoy.
- Poder explicar una decisión de diseño a partir de sus fuentes.
- Cambiar de arnés sin reconstruir manualmente todo el contexto del proyecto.
- Mantener una experiencia fluida en el equipo real, con un consumo medido y un ciclo de cierre fiable.

No se declara una ventaja competitiva exclusiva. Existen productos con lienzos, navegadores y conexiones con agentes; la hipótesis de valor es su encaje en el flujo de FLOC*.
