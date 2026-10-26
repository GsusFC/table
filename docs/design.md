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
| Carril lateral | Inicio (lista de mesas). | Agentes, contexto, configuración global. |
| Panel principal | Inicio: lista de mesas y «Nueva mesa». Mesa: lienzo abierto con tarjetas. | — |

## Interacción

- **Inicio:** lista de mesas, más recientes primero, y «Nueva mesa» con nombre.
- **Lienzo:** abierto, con desplazamiento y zoom. Las tarjetas muestran captura, icono y nombre del servicio, y título.
- **Añadir URL:** clic derecho en el lienzo abre un campo pequeño en el punto del clic; también desde `+` en la barra superior; pegar una URL sobre el lienzo crea la tarjeta directamente.
- **Seleccionar y ordenar:** arrastrar en vacío dibuja una selección (como en Figma); `⇧`/`⌘`+clic añade tarjetas y `⌘A` selecciona todas. El lienzo se mueve con dos dedos, la rueda o `Espacio` + arrastrar. Con dos o más tarjetas seleccionadas aparece una barra abajo: «Ordenar en cuadrícula», alinear a la izquierda y alinear arriba. Pedido por el usuario el 2026-10-26.
- **Imán:** al arrastrar una tarjeta sola, se alinea con los bordes o centros de las demás (con una guía azul) y, si no hay ninguna cerca, con la rejilla de 24 px de los puntos del fondo. Un grupo se mueve por la rejilla conservando sus distancias. Con `⌥` pulsado se arrastra sin imán.
- **Entrar en una web (opción B):** la web ocupa el panel principal, como en un navegador, para usar una app, navegar o diseñar a tamaño normal. La barra superior muestra el servicio y «Volver al lienzo» (`⌘⇧Esc`); `Esc` llega a la web.
- **Tarjeta descargada:** web cerrada para liberar memoria; queda una captura fija con su fecha y la sesión se mantiene para volver a cargarla. Estados: abierta (en el panel), en memoria (cargada y oculta, vuelve al instante) y descargada.
- **Descarga automática:** como mucho 2 webs cargadas a la vez (la abierta incluida). Al entrar en otra, Table descarga la menos usada recientemente. Si esa web avisa de cambios sin guardar, se queda cargada sin preguntar y se prueba con la siguiente. Aceptado por el usuario el 2026-10-26.

## Principios visuales

- Fondo de ventana gris muy claro; panel principal blanco con borde suave y esquinas redondeadas.
- Tipografía del sistema; jerarquía con peso y color, no con tamaños grandes.
- Iconos de trazo fino, monocromos; un único color de acento para el estado activo.
- Colores, radios y espaciados en variables de un solo archivo, para cambiar la identidad sin tocar componentes.
