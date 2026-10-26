# Notion como contexto del proyecto

Estado: contrato propuesto sobre un principio aceptado. Esquema comprobado contra la API el 2026-10-26 a partir de la ficha del proyecto piloto; la base todavía no está compartida con la integración.

## Fuente de verdad

La ficha y las páginas del proyecto en Notion contienen el contexto duradero: brief, objetivos, alcance, estado, responsables, decisiones y enlaces. Todos los arneses deben poder trabajar a partir de esa misma fuente autorizada.

El contexto de una tarea suma una selección explícita del lienzo. Mover el zoom o el encuadre no debería cambiar silenciosamente lo que se entrega al agente.

## Esquema comprobado

Fuente: API de Notion (`Notion-Version: 2022-06-28`), integración interna de solo lectura conectada a la **ficha del proyecto piloto**. Leer la base devuelve `object_not_found`: la integración no está conectada a ella. Por eso no se han podido leer las opciones de `Status` ni recorrer otros proyectos. Los IDs de propiedad se resolvieron y se guardan fuera del repositorio (`.local/notion-schema.json`); el repositorio solo lleva nombres y tipos.

| Propiedad | Tipo real | Uso previsto | Exposición al agente | En el piloto |
| --- | --- | --- | --- | --- |
| `Title` | `title` | Nombre del proyecto. | Permitido en el contexto acordado. | Con valor |
| `Status` | `status` | Filtro y situación del proyecto. | Permitido. | Con valor |
| `Services` | `multi_select` | Tipo de encargo. | Permitido. | Vacío |
| `Start Date`, `Due Date` | `date` | Plazos. | Permitido si es pertinente para la tarea. | Vacíos |
| `Remaining days` | `formula` | Cuenta atrás derivada. | Permitido. | Con valor |
| `Leaders` | `people` | Responsables. | Solo datos necesarios para la tarea. Leer nombres requiere la capacidad de usuarios, no concedida. | Vacío |
| `Account` | `relation` | Cliente, en otra base. | Solo datos necesarios para la tarea; la base relacionada no está compartida. | Vacío |
| `WORK Figma File` | `url` | Archivo único del proyecto. | Referencia autorizada. | **Vacío** |
| `Pinterest Link` | `url` | Tablero de referencias. | Referencia autorizada. | **Vacío** |
| `Pinterest` | `url` | Duplicado del anterior, mismo tipo. | No elegir automáticamente entre ambas. | **Vacío** |
| `Preview` | `files` | Imagen del proyecto; candidata a miniatura de la tarjeta. | Por decidir. | Con valor |
| `Budget` | `rich_text` | Información económica interna, como texto libre (no número). | **Excluido.** | Vacío |
| `Opportunity` | `relation` | Oportunidad comercial, en otra base. | Excluido por defecto hasta aclarar su contenido. | Vacío |
| `Lead` | `url` | Sin uso documentado. | Excluido por defecto hasta aclarar. | Vacío |
| `Notion Link` | `url` | Sin uso documentado. | Excluido por defecto hasta aclarar. | Vacío |

Diferencias con el documento guía: `Account` es una relación con otra base, no un texto; `Budget` es texto libre, así que un filtro no puede depender de su formato; hay cinco propiedades no descritas (`Remaining days`, `Preview`, `Opportunity`, `Lead`, `Notion Link`).

**El piloto no tiene enlazado ni el archivo de Figma ni Pinterest.** El archivo usado en T-001 se configuró a mano. Fase 1 debe tratar la ficha sin enlaces como caso normal: pedir el enlace o permitir asociarlo, sin inventarlo.

`Pinterest` frente a `Pinterest Link`: ambos son `url` y ambos están vacíos en el piloto, así que este proyecto no permite decidir. Con la base compartida se puede contar en cuántos proyectos tiene valor cada uno, sin leer los valores.

El cuerpo de la ficha contiene contenido propio (19 bloques de primer nivel: párrafos, columnas, una cita y un aviso destacado). La exclusión de información económica debe cubrir también el cuerpo, como indica la sección de exclusión.

Estados descritos por el usuario: `Not started`, `Blocked`, `In progress`, `Done`, `Archive`. No se han podido verificar sin acceso a la base. El filtro de proyectos activos es configurable; no se fija su semántica sin validar la base.

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
