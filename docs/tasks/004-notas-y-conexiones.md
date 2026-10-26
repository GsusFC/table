# Tarea 004 · Notas y conexiones

Estado: en curso desde el 2026-10-26. Fase: 1.

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

- [ ] Crear, editar, mover, redimensionar y borrar notas; el texto se conserva tras reabrir.
- [ ] Conectar tarjeta↔tarjeta, tarjeta↔nota y nota↔nota; no se duplica una conexión ni se conecta un elemento consigo mismo.
- [ ] Borrar un elemento borra sus conexiones; borrar una conexión no toca los elementos.
- [ ] Una mesa guardada con la versión 1 se abre sin pérdida y se guarda como versión 2.
- [ ] Selección múltiple, ordenar, alinear e imán funcionan con notas.
- [ ] Tests del guardado y la migración; smoke de punta a punta.
