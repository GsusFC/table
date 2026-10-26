# Producto

Estado: definición inicial. Fecha: 2026-10-26.

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
3. Un archivo de Figma vinculado a cada proyecto.
4. Terminal universal: el usuario elige el arnés. No hay una IA cerrada propia.
5. Cada arnés utiliza sus mecanismos de autenticación y el acceso que permita su proveedor.
6. Desarrollo colaborativo con Claude Code y Codex, con documentación e instrucciones compartidas y roles asignados por tarea.
7. Proyecto reunido, después integración de agentes y finalmente publicación.

## Experiencia prevista

1. Crear o abrir la mesa de un proyecto activo. Pendiente: si se elige desde la base de Notion o se crea libremente.
2. Añadir los enlaces a medida que se tienen: clic derecho → «Añadir URL». Table reconoce el servicio (Figma, Notion, Pinterest u otra web) y crea la tarjeta ([D-012](decisions.md)).
3. Añadir notas y conexiones.
4. Abrir una sesión con el arnés elegido y entregarle el contexto pertinente.
5. Pedir una comparación o propuesta a partir de frames y referencias seleccionados.
6. Revisar resultados; editar en Figma y conservar las decisiones aceptadas.
7. Publicar un resultado concreto en el portal del cliente cuando corresponda.

Este flujo describe el producto objetivo. No está implementado.

## Tarjetas

| Tipo | Contenido previsto |
| --- | --- |
| Web | Cualquier URL añadida por el usuario: Figma, Notion, Pinterest u otra web. Mismo ciclo de vida para todas (activa, conservada, descargada) y captura con fecha. El servicio reconocido añade capacidades: contexto de Notion por API, miniaturas y nodos de Figma por API. |
| Proyecto | Datos autorizados de la ficha de Notion enlazada, con su origen. |
| Frame | Miniatura, enlace y referencia estable a un nodo de Figma. |
| Referencia | Captura, URL, fecha y anotación. |
| Nota | Texto interno del proceso. |
| Sesión | Terminal del arnés, identidad visible y estado de ejecución. |
| Resultado | Artefacto o propuesta y vínculos a las entradas que utilizó. |

Está propuesto añadir una tarjeta de decisión con motivo, autor y estado. No es un requisito aprobado del primer prototipo.

## Contenido conectado y memoria

«Vivo» significa vinculado al origen y con una política de actualización visible. No significa mantener todas las aplicaciones ejecutándose continuamente.

La ficha de Notion puede representarse con datos de API. El navegador completo se activa cuando hace falta. Las referencias conservan una captura fechada para poder explicar qué se revisó, aunque el origen cambie.

Mostrar una captura en lugar de una web no demuestra que se haya liberado su memoria. El producto debe distinguir tarjeta, contenido cargado y proceso activo. Ver [validación de memoria](memory-validation.md).

## Interacción por validar

La propuesta inicial usa doble clic para entrar en una tarjeta y Esc para regresar. Debe probarse contra los atajos del editor y del terminal; no se interceptará Esc indiscriminadamente. Se evaluará un control visible de salida y un modo ampliado para trabajar en una web.

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
