# Notion como contexto del proyecto

Estado: contrato propuesto sobre un principio aceptado. Esquema y uso comprobados contra la API el 2026-10-26, con la integración conectada a la base de proyectos. La ficha con lista cerrada está implementada en [T-003](tasks/003-ajustes-y-ficha-notion.md) (solo para la interfaz; la entrega a agentes es de la Fase 2).

## Fuente de verdad

La ficha y las páginas del proyecto en Notion contienen el contexto duradero: brief, objetivos, alcance, estado, responsables, decisiones y enlaces. Todos los arneses deben poder trabajar a partir de esa misma fuente autorizada.

El contexto de una tarea suma una selección explícita del lienzo. Mover el zoom o el encuadre no debería cambiar silenciosamente lo que se entrega al agente.

## Esquema comprobado

Fuente: API de Notion (`Notion-Version: 2022-06-28`), integración interna de solo lectura conectada a la base de proyectos. Primero se leyó la ficha del proyecto piloto; después la base completa (157 proyectos), contando valores sin leerlos. Los IDs de propiedad y de la base se guardan fuera del repositorio (`.local/notion-schema.json`); el repositorio solo lleva nombres, tipos y recuentos.

| Propiedad | Tipo real | Uso previsto | Exposición al agente | Proyectos con valor (de 157) |
| --- | --- | --- | --- | --- |
| `Title` | `title` | Nombre del proyecto. | Permitido en el contexto acordado. | — |
| `Status` | `status` | Situación del proyecto. | Permitido. | 157 |
| `Services` | `multi_select` (19 opciones) | Tipo de encargo. | Permitido. | 24 |
| `Start Date`, `Due Date` | `date` | Plazos. | Permitido si es pertinente para la tarea. | No contado |
| `Remaining days` | `formula` | Cuenta atrás derivada. | Permitido. | — |
| `Leaders` | `people` | Responsables. | Solo datos necesarios para la tarea. Leer nombres requiere la capacidad de usuarios, no concedida. | 63 |
| `Account` | `relation` | Cliente, en otra base. | Solo datos necesarios para la tarea. Invisible en el esquema de la base porque la base relacionada no está compartida; aparece en la ficha sin valores accesibles. | No accesible |
| `WORK Figma File` | `url` | Archivo del proyecto. | Fuera del flujo de enlaces (D-012). | **0** |
| `Pinterest Link` | `url` | Tablero de referencias. | Fuera del flujo de enlaces (D-012). | 1 |
| `Pinterest` | `url` | Duplicado del anterior. | Fuera del flujo de enlaces (D-012). | 1 |
| `Preview` | `files` | Imagen del proyecto; candidata a miniatura de la tarjeta. | Por decidir. | No contado |
| `Budget` | `rich_text` | Información económica interna, como texto libre (no número). | **Excluido.** | 2 |
| `Opportunity` | `relation` | Oportunidad comercial, en otra base. Mismo caso que `Account`. | Excluido por defecto hasta aclarar su contenido. | No accesible |
| `Lead` | `url` | Sin uso relevante según el usuario. | Excluido. | No contado |
| `Notion Link` | `url` | Sin uso relevante según el usuario. | Excluido. | No contado |

Diferencias con el documento guía: `Account` es una relación con otra base, no un texto; `Budget` es texto libre, así que un filtro no puede depender de su formato; hay cinco propiedades no descritas (`Remaining days`, `Preview`, `Opportunity`, `Lead`, `Notion Link`).

**Los campos de enlaces casi no se usan:** `WORK Figma File` está vacío en los 157 proyectos, y cada campo de Pinterest tiene valor en uno. El piloto tampoco los tiene; el archivo de T-001 se configuró a mano. Confirma [D-012](decisions.md): los enlaces se añaden en Table.

Por [D-012](decisions.md), los enlaces no se leen de estos campos: el usuario los añade en Table y Table reconoce el servicio. Los campos `url` de la base (`WORK Figma File`, `Pinterest`, `Pinterest Link`, `Lead`, `Notion Link`) quedan fuera del flujo de enlaces, y la duda entre `Pinterest` y `Pinterest Link` deja de bloquear.

El cuerpo de la ficha contiene contenido propio (19 bloques de primer nivel: párrafos, columnas, una cita y un aviso destacado). La exclusión de información económica debe cubrir también el cuerpo, como indica la sección de exclusión.

Estados de `Status`, comprobados: `Not started` y `Blocked` (grupo To-do), `In progress` (grupo In progress), `Done` y `Archive` (grupo Complete). Reparto: 9 en curso, 7 sin empezar, 107 terminados y 34 archivados. Con las mesas libres (D-013), el estado sirve como contexto, no para crear mesas.

El portal descrito contiene Project Tracker, En marcha, Entregables, Resumen/Live Process y una cuenta atrás. Esas etiquetas no se usan como IDs ni se presupone que correspondan a un mismo tipo de bloque.

## Entrega a arneses

1. Seleccionar el proyecto y resolver su identidad estable en Notion.
2. Leer solo propiedades y bloques autorizados y necesarios.
3. Entregar el contexto a un arnés que soporte MCP mediante herramientas acotadas.
4. Para otros arneses, generar un archivo temporal de contexto legible, con fecha, procedencia y límites.
5. Incluir la selección visual elegida y referencias concretas a los artefactos que el arnés pueda leer.
6. Registrar qué versión del contexto se entregó. El historial de conversación de un proveedor no es el contexto compartido del proyecto.

Una exportación es una copia de trabajo. Nunca sustituye a Notion ni se sube a este repositorio. Sin conexión, mostrar su fecha y condición de caché; no declarar que se ha actualizado.

## Exclusión real de información

La lista de campos permitidos es preferible a enviar toda la ficha y borrar una propiedad. La política debe cubrir propiedades, bloques, páginas hijas, relaciones y resultados de herramientas: un presupuesto también podría estar escrito en el cuerpo de una página.

Una conexión MCP directa con permisos amplios puede recuperar datos excluidos del prompt. Para garantizar el filtro, el arnés debe usar una vía filtrada y no disponer de una ruta alternativa hacia esos datos dentro del entorno controlado.

Límite explícito: Table no puede asegurar que un arnés arbitrario, ejecutado con los permisos y credenciales generales del usuario, nunca acceda a información por otros medios. Si se necesita esa garantía, habrá que definir un entorno restringido, credenciales acotadas y pruebas negativas. «No lo incluyas en el prompt» no cumple ese requisito.

**Capturas de páginas de Notion.** Una tarjeta web guarda una captura de lo que se vio al salir; si la página muestra `Budget`, la captura lo contiene. Es una copia local para el usuario, que ya ve esa página en Notion. Por eso las capturas de páginas de Notion no pueden formar parte del contexto ni de la selección visual que se entregue a un agente; hasta que la Fase 2 defina esa entrega, solo la ficha filtrada es apta (hallazgo de la revisión de Codex del 2026-10-26).

## Escritura y decisiones

El agente propone; las decisiones aceptadas se consolidan en Notion mediante una acción definida. No guardar automáticamente cada salida de terminal en el portal del cliente.

El contexto interno y la publicación tienen destinos y permisos distintos. Confirmar la estructura privada antes de añadir bloques o páginas. La autorización de escribir documentación en GitHub no autoriza modificar los proyectos de Notion.

## Criterios para validar la integración

- Detectar propiedades ausentes y tipos incompatibles sin inventar datos.
- Tratar explícitamente el conflicto entre los campos de Pinterest.
- Mostrar fecha y origen del contexto.
- Probar que un fixture con campos y bloques económicos no los entrega por ninguna herramienta del adaptador.
- Registrar el límite si el arnés mantiene acceso externo al adaptador.
- Evitar que errores o logs impriman secretos o contenido privado.
