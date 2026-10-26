# Tarea 006 · Validación de la Fase 1

Estado: propuesta. Fase: 1. Cierra la fase.

## Resultado esperado

Una sesión de trabajo real con una mesa completa (ficha de Notion, archivo y frames de Figma, referencias, notas y conexiones) se puede cerrar y retomar sin perder trabajo, y el consumo cumple los umbrales del escenario B ([D-017](../decisions.md)).

## Alcance

- Reabrir: tras cerrar Table normalmente y tras un cierre forzado, la mesa vuelve como estaba; lo que viene de caché se distingue de lo actualizado.
- Recuperación: si una web o el proceso de una tarjeta cae, la tarjeta lo indica y se puede recargar sin afectar a las demás.
- Memoria del escenario B completo con el modo de medición de T-002.

## Criterios de aceptación

- [ ] Cierre normal y forzado sin pérdida de mesas, posiciones, notas, conexiones ni capturas.
- [ ] Ficha y miniaturas muestran si son caché y de cuándo.
- [ ] Escenario B: estable ≤ 2 048 MiB y pico ≤ 3 584 MiB con el límite de 2 webs, presión normal.
- [ ] Sesión real del usuario con su resultado registrado; la Fase 1 se declara cerrada solo si se cumple todo lo anterior.
