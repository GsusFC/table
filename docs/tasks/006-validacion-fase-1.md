# Tarea 006 · Validación de la Fase 1

Estado: preparada el 2026-10-26. Fase: 1. Cierra la fase.

## Resultado esperado

Una sesión de trabajo real con una mesa completa (ficha de Notion, archivo y frames de Figma, referencias, notas y conexiones) se puede cerrar y retomar sin perder trabajo, y el consumo cumple los umbrales del escenario B ([D-017](../decisions.md)).

## Sesión con el usuario

Una mesa de un proyecto real, en el Mac de referencia:

1. Vincular la ficha de Notion, añadir el archivo de Figma y 3 o 4 frames, una referencia de Pinterest y otra web.
2. Escribir dos notas y conectar cada una con la tarjeta a la que se refiere.
3. Trabajar como siempre durante un rato: entrar en Figma y en un frame, editar, volver al lienzo, abrir Pinterest.
4. Cerrar Table con `⌘Q` y reabrirlo: todo debe estar igual, y las webs abren descargadas con su captura.
5. Forzar el cierre (Monitor de Actividad → Forzar salida) con una nota a medio escribir y reabrir.
6. Sin wifi: abrir la mesa; la ficha y las miniaturas deben decir que son caché y de cuándo.
7. Pendientes de T-004: redimensionar una nota con el ratón, el imán arrastrando una nota y `⇧`+clic con notas.

## Medición (asistente)

Con las demás apps cerradas, el modo de medición de T-002 con las URLs de la mesa real (guardadas solo en `.local/`): tarjetas de la sesión, límite de 2 webs, estable y pico. Además, una prueba de cierre forzado automatizada: matar el proceso durante escrituras y comprobar que todas las mesas siguen legibles.

## Criterios de aceptación

- [ ] Cierre normal y forzado sin pérdida de mesas, posiciones, notas, conexiones ni capturas. En el forzado se admite perder como mucho el último medio segundo de texto de una nota.
- [ ] Ficha y miniaturas muestran si son caché y de cuándo.
- [ ] Escenario B: estable ≤ 2 048 MiB y pico ≤ 3 584 MiB con el límite de 2 webs, presión normal.
- [ ] Pendientes de T-004 y T-005 comprobados.
- [ ] Sesión real del usuario con su resultado registrado; la Fase 1 se declara cerrada solo si se cumple todo lo anterior.

## Resultados

- **Cierre forzado automatizado (2026-10-26):** un proceso escribe sin parar en una mesa (notas con texto, posiciones, conexiones, borrados) con el almacén real y se mata con `SIGKILL` en un momento al azar, 30 veces seguidas. Las 30 veces la mesa sigue legible y válida. Cada cierre dejaba un temporal sin renombrar en `mesas/`; ahora se borran al arrancar.
