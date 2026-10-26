# Tarea 004 · Notas y conexiones

Estado: completada el 2026-10-26; lo que falta probar a mano pasa a [T-006](006-validacion-fase-1.md). Fase: 1.

## Resultado esperado

En una mesa se pueden escribir notas internas y conectar tarjetas y notas entre sí, por ejemplo una referencia con el frame al que inspira. Todo se conserva al cerrar y reabrir Table.

## Alcance

- **Nota**: tarjeta de texto propia de Table (no es web: no carga nada ni tiene captura). Se crea con clic derecho en el lienzo → «Añadir nota». Doble clic para editar; el texto se guarda solo.
- **Conexión**: línea entre dos elementos (tarjetas o notas). Se crea arrastrando desde el borde de uno a otro; se selecciona y se borra con `⌫`. Borrar un elemento borra sus conexiones.
- La selección múltiple, ordenar, alinear y el imán de [T-002](002-mesa-y-enlaces.md) funcionan también con notas.
- **Esquema de la mesa versión 2**, con migración automática de las mesas de la versión 1.

## Fuera de alcance

- Texto con formato, etiquetas en las conexiones, colores de nota, grupos.
- Entregar notas o selección a agentes (Fase 2).

## Criterios de aceptación

- [ ] Crear, editar, mover, redimensionar y borrar notas; el texto se conserva tras reabrir. *Verificado con el smoke salvo redimensionar con el ratón (el guardado del tamaño sí está en los tests) y reabrir Table entera (el smoke recarga la interfaz y lee del disco).*
- [x] Conectar tarjeta↔tarjeta, tarjeta↔nota y nota↔nota; no se duplica una conexión ni se conecta un elemento consigo mismo.
- [x] Borrar un elemento borra sus conexiones; borrar una conexión no toca los elementos.
- [x] Una mesa guardada con la versión 1 se abre sin pérdida y se guarda como versión 2.
- [ ] Selección múltiple, ordenar, alinear e imán funcionan con notas. *Verificado: `⌘A`, «Alinear arriba» y «Ordenar en cuadrícula» con una nota (smoke) y el imán y la cuadrícula con tamaños de nota (tests). Falta probar a mano el imán arrastrando una nota y `⇧`+clic.*
- [x] Tests del guardado y la migración; smoke de punta a punta.

## Comprobaciones (2026-10-26)

- Tests: notas (crear, editar, borrar), conexiones (los tres tipos, autoconexión, duplicado en ambos sentidos, IDs ajenos o inexistentes, borrado en cascada de tarjeta y nota en la misma escritura), migración de una mesa sintética de la versión 1 y archivos de la versión 2 dañados, que no se tocan. Geometría de las conexiones y cuadrícula/imán con notas.
- Smoke: clic derecho → «Añadir nota», escribir con `⌘A`/`⌫` sin afectar al lienzo, `Esc` guarda, arrastrar nota→tarjeta y tarjeta→tarjeta, rechazo de duplicado y autoconexión, `⌘A` + alinear y ordenar con la nota, clic en una línea + `⌫`, recarga con texto y conexión conservados, borrar la nota con su conexión.
- Prueba del usuario: conectó tarjetas con el ratón real (encontró que solo funcionaba soltando en el centro; corregido, ahora vale cualquier punto y las asas) y su nota se conservó al cerrar y reabrir Table. Pasan a T-006: redimensionar una nota con el ratón, el imán arrastrando una nota y `⇧`+clic con notas.
