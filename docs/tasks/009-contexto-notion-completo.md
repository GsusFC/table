# Tarea 009 · Contexto completo de Notion para el agente

Estado: en curso desde el 2026-10-27. Fase: 2.

## Problema

`TABLE.md` (T-008) solo lleva cuatro campos de la ficha. El trabajo de marca vive en el contenido de la ficha y, sobre todo, en sus bases: en el piloto, el cuerpo de la ficha es corto (portal del cliente) y «Resumen» es la base «Live Process» con 63 páginas («hay un montón de páginas que son necesarias», el usuario). Sin eso, el agente pierde el contexto que importa.

## Decisión del usuario (2026-10-27)

**Table lee la ficha entera y filtra**, y enseña lo que recibe el agente. Se descartó que el agente lea Notion por su cuenta (sin filtro) y elegir páginas a mano.

## Comprobado contra el Notion real (2026-10-27)

- `notion-fetch` de la ficha devuelve su cuerpo como Markdown con etiquetas; las bases incrustadas aparecen como `<database url=… data-source-url="collection://…">` y las vistas enlazadas sin `data-source-url` (se resuelven con `notion-fetch` de su URL, que da la `collection://` de origen).
- `notion-query-data-sources` en modo `rows` devuelve hasta 100 filas por petición con sus propiedades y su `url` (63 en «Live Process»).
- Cada fila es una página: su contenido se lee con `notion-fetch`.

## Alcance

- **Recorrido** de la ficha de cada tarjeta de proyecto de la mesa: su cuerpo, las filas de sus bases incrustadas o enlazadas (sin repetir una base vista dos veces) y el contenido de cada fila. Dos niveles; límites de páginas y tamaño con aviso si se alcanzan.
- **Filtro de propiedades** genérico, porque cada base tiene su esquema: entran título, texto, selección, selección múltiple, estado, fecha, URL y casilla; nunca personas, relaciones, archivos, rollups, fórmulas, números, correos ni teléfonos, ni propiedades cuyo nombre indique dinero o comercial (`Budget`, `Opportunity`, `Account`, `Lead`, `Leaders`, `Preview`, `Notion Link`, presupuesto, precio, coste, tarifa, factura, fee, invoice, price, cost…).
- **Filtro de importes** en textos: cada línea, celda o elemento de lista con importes o palabras económicas (€, EUR, $ con cifras, «k€», presupuesto, precio, tarifa, factura, honorarios, coste, budget, fee, invoice) se sustituye por «[omitido: posible información económica]». Es heurístico; el índice dice cuántas líneas se omitieron por página.
- **Archivos**: `notion/` en la carpeta de la mesa, un Markdown por página (con su URL, fecha de edición y propiedades filtradas) y un índice; `TABLE.md` enlaza el índice. Mismas reglas anti-inyección que T-008.
- **Caché incremental**: solo se vuelven a leer las páginas editadas desde la última lectura.
- **Cuándo**: en segundo plano al abrir una sesión (la sesión no espera) y con «Actualizar contexto». El panel muestra el progreso («Leyendo Notion: 34/64») y los avisos.
- **«Ver contexto»**: abre `TABLE.md` y la carpeta `notion/` para revisar exactamente lo que recibe el agente.

## Fuera de alcance

- Páginas enlazadas o mencionadas fuera del árbol de la ficha.
- Un filtro de importes que no dependa de patrones (no existe con garantía).

## Criterios de aceptación

- [ ] Con una ficha sintética con cuerpo, una base incrustada y una vista enlazada, se generan sus páginas en `notion/` con el índice y sin repetir la base.
- [ ] Ninguna propiedad excluida (por tipo o nombre) ni línea con importes sale a `notion/` (test con fixture lleno de trampas).
- [ ] Una segunda lectura sin cambios no vuelve a pedir las páginas no editadas.
- [ ] El progreso y los avisos (límites, omisiones) se ven en el panel; la sesión no espera al recorrido.
- [ ] Probado con la ficha real del piloto: las 63 páginas de «Resumen» llegan al agente y el usuario lo revisa con «Ver contexto».
