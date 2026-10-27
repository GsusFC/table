# Tarea 008 · Contexto para el agente y resultados en la mesa (archivos)

Estado: en curso desde el 2026-10-27; implementada, falta la prueba del usuario con un arnés real. Fase: 2.

## Resultado esperado

Un agente abierto en el panel conoce el proyecto sin explicárselo: lee el contexto de la mesa en su carpeta de trabajo. La persona selecciona tarjetas y notas y las envía al agente con un botón. Lo que el agente guarda en `resultados/` aparece en la mesa como tarjeta.

## Decisión del usuario (2026-10-27)

**Archivos primero, MCP después**: el nivel «Archivos» de [harnesses](../harnesses.md) funciona con cualquier arnés; el MCP de Table (P-009, P-014) llega en una tarea posterior para lo más rico.

## Alcance

- **`TABLE.md`** en la carpeta de trabajo de la mesa, escrito por Table al abrir una sesión, al enviar una selección y con «Actualizar contexto»: nombre de la mesa y fecha; ficha del proyecto con la lista cerrada de campos (de la caché de T-003); enlaces de la mesa (servicio, título, URL; frames de Figma con nombre y página); notas y conexiones; la última selección enviada; y cómo devolver resultados. Nunca campos excluidos, capturas ni contenido de páginas.
- **Punteros para cada arnés**: si no existen, Table crea `AGENTS.md` (Codex, OpenCode y otros), `CLAUDE.md` y `GEMINI.md` con una línea que remite a `TABLE.md`. Si ya existen, no los toca.
- **«Enviar al agente»**: con tarjetas o notas seleccionadas (barra de selección y menú de la tarjeta), pega en la sesión activa del panel un bloque con la selección (lo mismo que se añade a `TABLE.md`), sin pulsar Intro: la persona escribe su petición. Abre el panel si está plegado; si no hay sesión, lo dice.
- **Resultados**: Table vigila `resultados/` en la carpeta de la mesa mientras está abierta y al abrirla. Cada archivo nuevo es una **tarjeta de resultado** (esquema de mesa versión 3): imagen con vista previa, texto o Markdown con las primeras líneas, otros con icono y nombre. Doble clic lo abre con la app del sistema. Borrar la tarjeta no borra el archivo. Si el archivo desaparece, la tarjeta lo indica.

## Fuera de alcance

- MCP de Table, herramientas estructuradas y fuentes de cada resultado.
- Que el agente lea Notion o Figma con sus propias conexiones (Table no lo controla; se documenta).

## Límites

- `TABLE.md` es una copia de trabajo con fecha, no la fuente: Notion lo es. Si el agente tiene otra vía a Notion (su propio MCP), puede leer lo que Table excluye ([contexto de Notion](../notion-context.md#exclusión-real-de-información)).
- El agente puede escribir en toda su carpeta; solo `resultados/` llega a la mesa.

## Criterios de aceptación

- [ ] Al abrir una sesión, `TABLE.md` existe y está al día; `AGENTS.md`, `CLAUDE.md` y `GEMINI.md` se crean solo si faltan.
- [ ] Un fixture con campos excluidos y capturas no los saca a `TABLE.md` (test).
- [ ] «Enviar al agente» pega la selección en la sesión activa sin enviarla y la anota en `TABLE.md`.
- [ ] Un archivo nuevo en `resultados/` aparece como tarjeta en segundos; imagen y Markdown con vista previa; doble clic lo abre.
- [ ] Mesas de la versión 2 se abren sin pérdida y se guardan como versión 3.
- [ ] Tests y smoke de punta a punta con una terminal normal; probado por el usuario con un arnés real.

## Comprobaciones (2026-10-27)

- Tests (222 en total): esquema v3 y migración desde v1 y v2, nombres de archivo de resultado, `TABLE.md` con un fixture que inyecta campos excluidos y texto malicioso (no sale nada excluido; las notas van en bloques que su contenido no puede cerrar; arriba se avisa de que todo son datos, no instrucciones), punteros que nunca se sobrescriben, vigilancia de `resultados/` (archivos a medio escribir, duplicados, desaparecidos, cambios, carpeta como enlace simbólico, vigilancias solapadas), limpieza de lo que se pega en la terminal.
- Smoke 81/81: `TABLE.md` con la ficha de un Notion falso sin `SECRETO`, punteros creados sin sobrescribir, «Enviar al agente» pega la selección sin ejecutarla (también con una nota que intenta cerrar el pegado protegido con una secuencia de escape), resultados de texto e imagen como tarjetas con vista previa, quitar una tarjeta conserva el archivo y no vuelve a aparecer, y un archivo borrado deja la tarjeta marcada.
- Revisión separada de Codex: 9 hallazgos (1 alto, 8 medios), corregidos. El alto: una nota con una secuencia de escape podía terminar el pegado protegido y ejecutar un comando en la terminal sin Intro; ahora se eliminan los caracteres de control antes de pegar. Medios: carpeta `resultados` como enlace simbólico, carreras entre comprobar y leer archivos (lecturas por descriptor; queda documentada la de abrir, que no es una escalada), estructura Markdown inyectada por nombres externos, vigilancias solapadas, tarjetas quitadas que volvían, estabilidad de archivos, vistas previas desactualizadas y envío de una nota antes de guardarse.
- Sin comprobar: un arnés real leyendo `TABLE.md` y escribiendo en `resultados/`, y abrir un archivo con la app del sistema.
