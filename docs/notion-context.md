# Notion como contexto del proyecto

Estado: contrato propuesto sobre un principio aceptado. Esquema y uso comprobados contra la API el 2026-10-26, con la integración conectada a la base de proyectos. La ficha con lista cerrada está implementada en [T-003](tasks/003-ajustes-y-ficha-notion.md) (solo para la interfaz; la entrega a agentes es de la Fase 2). Table se conecta con el MCP oficial de Notion mediante OAuth con la cuenta de cada persona (decisión del usuario del 2026-10-26); la integración interna y su token quedan para el análisis del esquema hecho aquí.

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

## Contenido completo (T-009)

Implementación de [T-009](tasks/009-contexto-notion-completo.md). Decisión del usuario del 2026-10-27: Table lee la ficha entera, la filtra y enseña lo que recibe el agente; la persona puede elegir qué páginas entran.

**Qué se lee.** Para cada tarjeta de la mesa que es una ficha de proyecto (según la caché de T-003), con el MCP oficial y la cuenta de la persona:

1. La ficha (`notion-fetch`): su cuerpo y las bases que aparecen en él. Una base incrustada trae su `collection://`; una vista enlazada se resuelve con `notion-fetch` de su URL. Una base que aparece dos veces (incrustada y como vista enlazada, o en dos fichas de la misma mesa) se lee una sola vez.
2. Las filas de cada base (`notion-query-data-sources` en modo `rows`): título, URL y, si la base la tiene, la propiedad de última edición. El modo `rows` devuelve como mucho 100 filas y no da cursor; si hay más (`has_more`), Table lee las 100 primeras y lo avisa.
3. El contenido de cada fila elegida (`notion-fetch`). Dos niveles: las bases que haya dentro de una fila no se siguen (quedan como «no incluida»); tampoco las páginas enlazadas o mencionadas.

Los pasos 1 y 2 forman el árbol que muestra «Elegir páginas de Notion…» sin leer el contenido de las filas. El esquema de cada base se vuelve a leer en cada lectura: decide qué propiedades salen. Límites: 20 bases distintas por ficha (una base incrustada y su vista enlazada cuentan una; como mucho se examinan 60 etiquetas de base), 400 páginas por mesa contando los cuerpos de ficha (primero los cuerpos, luego las filas), 200 KB de texto por página y 2 MB en total; al alcanzarlos, Table lo dice en el índice, en `TABLE.md` y en el panel. Lecturas a Notion: como mucho tres a la vez.

**Filtro de propiedades.** Genérico, porque cada base tiene su esquema: solo salen las propiedades del esquema de tipo título (como encabezado), texto, selección, selección múltiple, estado, fecha, URL y casilla. Nunca personas, relaciones, archivos, rollups, fórmulas, números, correos, teléfonos ni fechas automáticas, ni una propiedad cuyo nombre, sin mayúsculas, tildes ni separadores, contenga `budget`, `opportunit`, `oportunidad`, `account`, `lead`, `preview`, `notionlink` o un término económico (presupuest, precio, price, pricing, cost, tarifa, factur, honorario, fee, invoic, pago, payment, importe). Se busca dentro del nombre entero, así que también caen `Budget2026`, `PrecioFinal` o `coste_interno`, y alguna propiedad inocente como `Leading` o `Feedback`: se prefiere excluir de más. Lo que no está en el esquema no sale. El cuerpo de la ficha no lleva propiedades: las de la ficha son las de la lista cerrada de `TABLE.md`.

**Filtro de importes.** El cuerpo se convierte a texto legible (sin etiquetas; sin contenido incrustado ni URLs firmadas de archivos e imágenes; las menciones de personas, sin nombre; cada tabla, una línea por fila). Para detectar, se quitan además el énfasis, el código y los enlaces de Markdown (`12.000 **€**`). Una línea, elemento de lista o fila de tabla es económica si tiene `€` o `£`; `$` junto a cifras; cifras con una moneda escrita o su código (`euros`, `dólares`, `libras`, `EUR`, `USD`, `GBP`, también con `k`, `m` o `mil`); un número escrito con palabras seguido de moneda («doce mil euros», «twelve thousand dollars»); o una palabra económica (presupuesto, precio, tarifa, factura, honorarios, coste, costo, importe, pago, budget, fee, invoice, price, cost, payment). Se sustituye por «[omitido: posible información económica]», y con ella sus hijos sangrados, la sección entera de un encabezado económico (hasta el siguiente de igual o mayor nivel), el resto de su tabla (una cabecera «Importe» arrastra las filas con cifras sin moneda) y todo el bloque que la contiene: aviso destacado, desplegable, columna o cita (así, «Diseño: 12000» junto a «Presupuesto» en el mismo aviso también sale). Los valores de propiedades pasan por el mismo filtro. Una página cuyo título es económico no se lee, y una base tampoco si su nombre en la ficha o su nombre propio lo es. Los avisos no muestran nombres económicos: un aviso que mencione algo económico se sustituye por uno genérico. Cada página dice cuántas líneas se omitieron.

**Límite del filtro.** Es heurístico: una cifra sin moneda ni palabra económica en la misma línea o bloque (por ejemplo, «Diseño: 3.000» en un párrafo suelto después de un párrafo «Presupuesto:»), «12k» sin palabra económica, una moneda o un número en otro idioma, o un importe dentro de una imagen o un archivo no se detectan; y una línea inocente con «pago» o con «€» se omite. No hay filtro de importes que no dependa de patrones; por eso el índice cuenta las omisiones y «Ver contexto» permite revisar exactamente lo que recibe el agente. El límite de [la sección anterior](#exclusión-real-de-información) se mantiene: un agente con su propio acceso a Notion puede leer lo que Table excluye.

**Archivos.** En `notion/` de la carpeta de la mesa; el contrato está en [harnesses](harnesses.md#contenido-de-notion-t-009). Todo texto externo pasa por las mismas reglas anti-inyección que `TABLE.md`.

**Caché y lecturas incrementales.** En los datos de Table (`notion-content/`, fuera de la carpeta de la mesa) se guardan el árbol ya filtrado y cada página ya filtrada con su marca de edición y la clave de sus reglas (versión de los filtros y nombre y tipo de cada propiedad de su base). En cada lectura se vuelven a pedir la ficha, los esquemas y las filas (baratos); una fila cuya base tiene una propiedad de última edición (`last_edited_time`), no cambió y cuya base mantiene las mismas reglas sale de la caché sin volver a pedirse. Si el esquema cambia (una propiedad de texto pasa a fórmula, se renombra), sus páginas se vuelven a leer y filtrar. Las filas de bases sin propiedad de última edición se vuelven a leer siempre, porque el modo `rows` no da la fecha de edición de cada página y averiguarla exige leerla. Para que una base grande no se relea entera, basta con añadirle en Notion una propiedad «Última edición». Desconectar Notion borra esta caché.

**Selección de páginas.** «Elegir páginas de Notion…» guarda por mesa y ficha (en `notion-selection/` de los datos de Table, nunca en la mesa ni en Git) qué se deja fuera: el cuerpo de la ficha, páginas sueltas («todas salvo») o bases enteras («solo»). Por defecto entra todo. Cada casilla cambia solo lo que toca: marcar o desmarcar páginas no cambia el modo de la base, solo la casilla de la base lo hace, y las páginas que no aparecen en el árbol (p. ej. más allá de las 100 filas) conservan su estado. Una página nueva de una base incluida entra, salvo que la base esté en modo «solo»; una página desmarcada sigue fuera. Las páginas y bases con nombre económico no aparecen en el árbol (se avisa de cuántas). Guardar cancela la lectura en curso, aplica la selección enseguida con lo ya leído (lo desmarcado sale de `notion/` y `TABLE.md` se reescribe, sin esperar a Notion) y vuelve a leer en segundo plano para lo recién marcado.

**Cuándo y cancelación.** En segundo plano al abrir una sesión (la sesión no espera), con «Actualizar contexto» y al guardar una selección. El trabajo de una mesa va en cola, uno a la vez; peticiones seguidas se agrupan: como mucho una lectura más al terminar la actual. Cada trabajo comprueba antes de cada escritura (páginas, índice, caché, `TABLE.md`, progreso) que no se ha cancelado: desconectar o reconectar Notion, borrar la mesa o guardar otra selección lo cancela. Desconectar espera a que lo cancelado termine antes de borrar la caché. Una cancelación en mitad de la escritura puede dejar en `notion/` algunas páginas nuevas junto al índice anterior, pero no escribe nada después de cancelarse. Sin conexión, los archivos anteriores se quedan con su fecha y el panel dice el motivo.

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
