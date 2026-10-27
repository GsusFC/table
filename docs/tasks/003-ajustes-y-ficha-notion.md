# Tarea 003 · Ajustes y ficha de Notion

Estado: completada el 2026-10-26. Fase: 1.

Aplica [D-012](../decisions.md) («el servicio reconocido añade capacidades») y el contrato de [contexto de Notion](../notion-context.md).

## Resultado esperado

Una persona del equipo pulsa «Conectar con Notion» en Ajustes y autoriza a Table en el navegador con su cuenta. Desde entonces, una tarjeta de Notion cuya página es una ficha de una base de proyectos muestra en el lienzo los datos autorizados del proyecto, con su fecha y origen. Sin conexión, muestra la última copia como caché fechada.

## Cambio de enfoque (2026-10-26)

La primera versión usaba el token de una integración interna pegado en Ajustes y elegir la base de proyectos. Al usuario le resultaba engorroso y eligió conectar con el **MCP oficial de Notion** (`https://mcp.notion.com/mcp`): OAuth con PKCE y registro dinámico, sin token pegado ni servidor propio. Ensayo previo con la cuenta del usuario:

- La autorización en el navegador funciona; el token dura 8 h y se renueva solo.
- `notion-fetch` devuelve la ficha como JSON dentro de un texto pensado para IA (`<properties>{…}</properties>`) y la base a la que pertenece. Estado, servicios y fechas se leen bien; los colores salen del esquema de la base.
- **`Remaining days` no se puede leer**: es una fórmula y el MCP solo devuelve una referencia (`formulaResult://…`), ni siquiera en consultas. La tarjeta muestra en su lugar cuánto falta para la fecha de entrega.
- Ya no hace falta elegir la base: una página es ficha de proyecto si su base tiene los campos de proyecto.

## Alcance

- **Ajustes** (configuración global, fuera de las mesas y de Git): botón en el carril lateral → diálogo con «Conectar con Notion» y, una vez conectado, quién está conectado y «Desconectar».
  - Credenciales OAuth cifradas con el llavero del sistema (`safeStorage`, Keychain en macOS). Nunca se registran ni llegan al renderer. Las renovaciones pertenecen a la revisión de conexión que las inició: una respuesta antigua no sustituye las credenciales de una cuenta nueva.
  - El código de autorización llega a un puerto local de un solo uso en `127.0.0.1`; se comprueba `state`. La cancelación y el plazo de cinco minutos abarcan también el intercambio de tokens y la consulta de identidad. Cancelar antes del reemplazo atómico de los ajustes evita guardarlos y retira el temporal; un reemplazo ya iniciado es el punto de confirmación y no se revierte.
- **Vincular proyecto de Notion** (añadido el 2026-10-26 a petición del usuario): clic derecho en el lienzo → buscar por nombre → la tarjeta de la ficha elegida se crea sin copiar la URL. Usa `notion-search` y solo muestra páginas de bases con el esquema de proyectos; una vez conocida la base, busca dentro de ella.
- **Ficha del proyecto**: la tarjeta muestra la ficha en lugar de la captura; entrar sigue abriendo la web de Notion.
- **Lista de campos permitidos**, comprobada por nombre y tipo en el esquema de la base: `Title`, `Status`, `Services`, `Start Date`, `Due Date`. Cada actualización o búsqueda vuelve a consultar el esquema; solo se comparten peticiones de esquema que aún estén en curso, y una búsqueda lo consulta una vez por base.
- **Caché fechada** en local; se borra al desconectar. Un esquema incompatible invalida la ficha: si falla la eliminación de su copia, Table comunica el error y no vuelve a servirla durante esa ejecución. Solo una lectura válida guardada correctamente levanta ese bloqueo; un fallo de red sin invalidez conocida conserva el respaldo offline.

## Fuera de alcance

- Cuerpo de la página, páginas hijas y relaciones: no se copian (la respuesta del MCP trae el cuerpo; Table lo descarta).
- Entregar contexto a agentes (Fase 2) y escribir en Notion: Table solo llama a `notion-fetch`, aunque el permiso de la conexión permite escribir.
- Campos configurables por el usuario (P-006).

## Criterios de aceptación

- [x] Conectar y desconectar desde Ajustes; las credenciales no aparecen en `settings.json` ni llegan al renderer. *Guardado cifrado y desconexión comprobados en el smoke; la autorización real en el navegador falta probarla desde la app.*
- [x] Una tarjeta de una ficha de proyecto muestra los campos permitidos, con fecha de lectura y origen; una página de otra base sigue como tarjeta web normal.
- [x] Un fixture con `Budget`, `Lead`, `Notion Link`, `Preview`, la fórmula y un cuerpo con importes no saca nada de eso de la ficha (test y smoke).
- [x] Sin conexión o con error, la tarjeta muestra la caché con su fecha y el motivo, sin declarar que está actualizada.
- [x] Ni logs ni errores imprimen credenciales ni contenido de la ficha.
- [x] Probado con la ficha real del piloto desde la app, con la cuenta del usuario. *El usuario conectó Notion, vinculó el proyecto y vio la ficha: «funciona».*

## Comprobaciones (2026-10-26)

- Tests: lectura del formato de `notion-fetch` con respuestas sintéticas (fixtures en `app/src/main/notion/fixtures.ts`), lista cerrada, esquema de proyectos, tipos inesperados, formatos no reconocidos y caché alterada.
- Smoke contra un MCP falso local: conexión cifrada, «Vincular proyecto» desde el menú del lienzo (búsqueda que solo devuelve fichas de proyecto y sin extractos, tarjeta creada con su ficha), ficha con los 4 campos y sin datos excluidos, página de otra base como web, caché sin conexión y desconexión que borra la caché.
- Contra el Notion real del usuario: lectura de dos fichas (estado con color, servicios y fechas, sin campos excluidos) y búsqueda acotada a la base de proyectos, que también devuelve subpáginas de las fichas; el filtro por esquema las descarta.
- Revisión separada de Codex sobre la versión con token: 6 hallazgos, 5 corregidos (siguen aplicando: escrituras de ajustes en cola, lecturas atadas a la conexión vigente, caché tardía ignorada, caché reconstruida con la lista cerrada) y 1 límite documentado: las capturas de páginas de Notion pueden mostrar `Budget` y no son aptas para agentes ([contexto de Notion](../notion-context.md)).

## Correcciones de auditoría (2026-10-27)

- Regresiones de renovación OAuth tardía tras cambiar de cuenta, cancelación durante el intercambio de tokens y la consulta de identidad, y cancelación esperando la cola o la escritura del temporal de ajustes.
- Regresiones de cambio de tipo de `Status`, eliminación fallida de una caché inválida, consulta offline y recuperación posterior con un esquema válido.
- Verificación integrada: comprobación de tipos y suite de tests; recorrido Electron contra el MCP sintético, manteniendo ficha filtrada, respaldo offline y desconexión. No se repitió OAuth con una cuenta real.
