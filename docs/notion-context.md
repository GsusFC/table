# Notion como contexto del proyecto

Estado: contrato propuesto sobre un principio aceptado. No se ha consultado el workspace privado para validar el esquema.

## Fuente de verdad

La ficha y las páginas del proyecto en Notion contienen el contexto duradero: brief, objetivos, alcance, estado, responsables, decisiones y enlaces. Todos los arneses deben poder trabajar a partir de esa misma fuente autorizada.

El contexto de una tarea suma una selección explícita del lienzo. Mover el zoom o el encuadre no debería cambiar silenciosamente lo que se entrega al agente.

## Esquema conocido por el documento guía

Los nombres siguientes proceden del usuario; no se han comprobado contra la API. El mapeo configurable es una propuesta pendiente. Los IDs deben resolverse y validarse contra el tipo real de cada propiedad.

| Campo descrito | Uso previsto | Exposición al agente |
| --- | --- | --- |
| `Title` | Nombre del proyecto. | Permitido en el contexto acordado. |
| `Status` | Filtro y situación del proyecto. | Permitido. |
| `Services` | Tipo de encargo. | Permitido. |
| `Start Date`, `Due Date` | Plazos. | Permitido si es pertinente para la tarea. |
| `Leaders`, `Account` | Responsables y cliente. | Solo datos necesarios para la tarea. |
| `WORK Figma File` | Archivo único del proyecto. | Referencia autorizada. |
| `Pinterest Link` | Tablero de referencias. | Referencia autorizada. |
| `Pinterest` | Posible propiedad duplicada. | No elegir automáticamente entre ambas. |
| `Budget` | Información económica interna. | Excluido. |

Estados descritos: `Not started`, `Blocked`, `In progress`, `Done`, `Archive`. El filtro de proyectos activos es configurable; no se fija su semántica sin validar la base.

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
