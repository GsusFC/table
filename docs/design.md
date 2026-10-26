# Diseño de la interfaz

Estado: dirección acordada con el usuario el 2026-10-26 ([D-016](decisions.md)). Sin diseño visual definitivo: la identidad y el nombre siguen abiertos.

## Referencia

La app de escritorio de Codex es el punto de partida: ventana sobria, carril lateral de iconos, barra superior con la navegación y el nombre del proyecto, y el contenido principal en un panel claro con esquinas redondeadas. No se copia su identidad; se toma su estructura.

```
┌───────────────────────────────────────────────────────────────┐
│ ● ● ●  ← →  ▣  ✎  │ Nombre de la mesa · guardado    ···   +  │  barra superior
├────┬──────────────────────────────────────────────────────────┤
│ ⌂  │ ╭──────────────────────────────────────────────────────╮ │
│ ▦  │ │                                                      │ │
│    │ │                 lienzo de la mesa                    │ │
│    │ │                                                      │ │
│    │ │                                                      │ │
│ ●  │ ╰──────────────────────────────────────────────────────╯ │
└────┴──────────────────────────────────────────────────────────┘
 carril
```

| Zona | Contenido en T-002 | Más adelante |
| --- | --- | --- |
| Barra superior | Semáforos de macOS integrados; atrás y adelante; mostrar u ocultar el carril; nueva mesa; nombre de la mesa con estado de guardado; acciones de la mesa (`···`) y «Añadir URL» (`+`). | Compartir (D-015 lo deja para después), sesiones de agentes. |
| Carril lateral | Inicio (lista de mesas) arriba; Ajustes abajo (T-003). | Agentes, contexto. |
| Panel principal | Inicio: lista de mesas y «Nueva mesa». Mesa: lienzo abierto con tarjetas, notas (T-004) y conexiones entre ellas. | — |

## Interacción

- **Inicio:** lista de mesas, más recientes primero, y «Nueva mesa» con nombre.
- **Lienzo:** abierto, con desplazamiento y zoom. Las tarjetas muestran captura, icono y nombre del servicio, y título.
- **Añadir URL:** clic derecho en el lienzo abre un menú con «Añadir URL» y «Añadir nota»; «Añadir URL» abre un campo pequeño en el punto del clic. También desde `+` en la barra superior; pegar una URL sobre el lienzo crea la tarjeta directamente.
- **Seleccionar y ordenar:** arrastrar en vacío dibuja una selección (como en Figma); `⇧`/`⌘`+clic añade tarjetas o notas y `⌘A` selecciona todas. El lienzo se mueve con dos dedos, la rueda o `Espacio` + arrastrar. Con dos o más elementos seleccionados aparece una barra abajo: «Ordenar en cuadrícula», alinear a la izquierda y alinear arriba. Pedido por el usuario el 2026-10-26.
- **Imán:** al arrastrar una tarjeta o nota sola, se alinea con los bordes o centros de las demás (con una guía azul) y, si no hay ninguna cerca, con la rejilla de 24 px de los puntos del fondo. Un grupo se mueve por la rejilla conservando sus distancias. Con `⌥` pulsado se arrastra sin imán.
- **Notas y conexiones (T-004):**
  - Una nota es texto plano propio de Table, sobre un fondo gris muy claro para distinguirla de las tarjetas web. Se crea con clic derecho → «Añadir nota» y se abre ya para escribir. Doble clic o `Enter` la edita; `Esc` o hacer clic fuera termina. El texto se guarda solo mientras se escribe (y siempre antes de cerrar Table). Mientras se edita, `⌫`, `⌘A` y las flechas actúan sobre el texto, no sobre el lienzo. Se mueve y redimensiona como una tarjeta.
  - Al pasar por encima de una tarjeta o nota aparecen asas en el centro de cada lado. Arrastrar desde un asa y soltar sobre otro elemento los conecta con una línea fina; mientras se arrastra, el elemento de destino se marca en azul. No se conecta un elemento consigo ni se repite una conexión (en cualquier sentido). La línea une los lados enfrentados y se recoloca al mover los elementos; no tiene dirección ni etiqueta.
  - Clic en una línea la selecciona (en azul) y `⌫` la borra; los elementos no cambian. Borrar una tarjeta o nota borra sus conexiones; el diálogo de confirmación lo avisa.
  - Una nota se borra desde su menú (clic derecho → «Eliminar»); si tiene texto, se confirma antes. `⌫` no borra tarjetas ni notas: solo conexiones.
- **Entrar en una web (opción B):** la web ocupa el panel principal, como en un navegador, para usar una app, navegar o diseñar a tamaño normal. La barra superior muestra el servicio y «Volver al lienzo» (`⌘⇧Esc`); `Esc` llega a la web.
- **Tarjeta descargada:** web cerrada para liberar memoria; queda una captura fija con su fecha y la sesión se mantiene para volver a cargarla. Estados: abierta (en el panel), en memoria (cargada y oculta, vuelve al instante) y descargada.
- **Descarga automática:** como mucho 2 webs cargadas a la vez (la abierta incluida). Al entrar en otra, Table descarga la menos usada recientemente. Si esa web avisa de cambios sin guardar, se queda cargada sin preguntar y se prueba con la siguiente. Aceptado por el usuario el 2026-10-26.
- **Ajustes (T-003):** botón abajo en el carril. Notion: pegar el token de la integración (se guarda cifrado en el llavero y solo se ven sus 4 últimos caracteres), «Comprobar conexión» y elegir la base de proyectos. Solo se listan las bases con los campos de proyecto (`Title`, `Status`, `Services`, `Start Date`, `Due Date`, `Remaining days`): compartir la base de proyectos con la integración comparte también las bases que hay dentro de cada ficha (53 en el piloto), que no son proyectos. Como cualquier diálogo, cierra antes la web abierta.
- **Ficha del proyecto (T-003):** una tarjeta de Notion cuya página es una ficha de la base elegida muestra, en lugar de la captura, los campos permitidos: estado, servicios, inicio, entrega y días restantes. El pie dice «Ficha de Notion · leída hace…»; si no se pudo leer, «Caché de hace… · motivo» en ámbar. Se vuelve a leer al abrir la mesa, con el botón de la esquina y al cambiar los ajustes. «Entrar» sigue abriendo la web de Notion.

## Principios visuales

- Fondo de ventana gris muy claro; panel principal blanco con borde suave y esquinas redondeadas.
- Tipografía del sistema; jerarquía con peso y color, no con tamaños grandes.
- Iconos de trazo fino, monocromos; un único color de acento para el estado activo.
- Colores, radios y espaciados en variables de un solo archivo, para cambiar la identidad sin tocar componentes.
