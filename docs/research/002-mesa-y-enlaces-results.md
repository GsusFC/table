# Resultados de T-002 · Mesa libre y enlaces

Fecha: 2026-10-26. Estado: **completada.** Implementada, revisada por Codex en dos rondas, smoke 22/22, prueba manual del usuario y memoria medida con 1, 3 y 6 tarjetas.

Ficha de la tarea: [T-002](../tasks/002-mesa-y-enlaces.md).

## Cómo se construyó

Contratos escritos primero (`app/src/shared/`, interfaces de `app/src/main/store/types.ts` y `app/src/main/web/types.ts`, integración en `app/src/main/index.ts`). Después, cuatro partes en paralelo por subagentes de Claude Code, cada una contra esos contratos:

| Parte | Archivos | Verificación del autor |
| --- | --- | --- |
| Guardado | `app/src/main/store/mesaStore.ts` | 17 tests (Vitest) |
| Servicios | `app/src/shared/services.ts` | 72 tests (Vitest) |
| Superficie web | `app/src/main/web/` | Tipos; sin ejecutar |
| Interfaz | `app/src/renderer/` | Tipos y build; sin ejecutar |

La integración y el smoke de punta a punta los hizo el integrador (Claude Code).

## Revisión independiente (Codex)

Codex (`codex exec`, solo lectura) revisó el commit `eadaa81` sin haber escrito el código. Sin bloqueantes; 6 hallazgos importantes y 2 menores. Se corrigieron en `5721321`, `6b523d2` y `0561a3b`; una segunda revisión de Codex confirmó cada corrección y señaló tres puntos más, también corregidos.

| Hallazgo | Corrección |
| --- | --- |
| Los popups se destruían sin `beforeunload` | Se cierran con el mismo flujo que la web; si uno se mantiene, la tarjeta no se descarga. |
| El cierre no esperaba a los guardados | Cierre coordinado: la interfaz guarda lo pendiente, se esperan capturas, títulos y colas; si algo falló o la interfaz no confirma a tiempo, Table pregunta antes de cerrar. |
| Archivos con URL o geometría inválidas pasaban la lectura | Validación completa al leer (sin depender del orden de claves) y `http(s)` exigido de nuevo antes de cargar. |
| Una entrada retrasada podía abrir una web de otra mesa | La superficie registra la mesa abierta y rechaza entradas de otra; si falla abrir o borrar una mesa, se restaura la anterior. |
| Dos instancias podían pisarse cambios | Bloqueo de instancia única. |
| «Guardado» podía ocultar fallos | Fallos por operación y por tarjeta; solo se resuelven al guardar bien esa misma operación. |
| Mesas ilegibles desaparecían sin aviso | Aviso en Inicio con los archivos afectados, que no se tocan. |
| Foco en controles aún ocultos | Foco tras posicionar el menú y el campo «Añadir URL». |

Revisiones guardadas fuera del repositorio en `.local/codex-review-t002-result.md` y `.local/codex-rereview-t002-result.md`.

## Comandos

Desde `app/`:

| Comando | Qué hace |
| --- | --- |
| `npm install` | Dependencias. Si `electron-vite dev` dice «Electron uninstall», ejecutar `node node_modules/electron/install.js` (ocurrió una vez). |
| `npm run dev` | App en desarrollo. |
| `npm test` | Tests de guardado y servicios. |
| `npm run typecheck` | Tipos. |
| `npm run smoke` | Recorrido de punta a punta con datos temporales; `TABLE_SMOKE_SHOTS=<carpeta>` guarda capturas de la interfaz. |

Las mesas se guardan en `~/Library/Application Support/table/` (`mesas/<id>.json`, `captures/<mesaId>/<cardId>.jpg`). El smoke usa una carpeta temporal y no toca esas mesas.

## Decisiones internas

- **Guardado (P-005):** un JSON por mesa con escritura atómica y cola por mesa. No se necesitó SQLite para este alcance.
- **Lienzo (P-002):** React Flow 12. Tarjetas arrastrables y redimensionables, pan con dos dedos, pellizco para zoom; sin zoom con doble clic.
- **Servicios (P-013):** reconocimiento solo por hostname exacto o subdominio; Pinterest con lista cerrada de dominios locales. Añadir un servicio es añadir un objeto a `SERVICES`.
- **Opción B (D-016):** la web ocupa el panel principal; las demás cargadas quedan ocultas y en memoria. El lienzo queda `inert` debajo. Menús, campo «Añadir URL» y diálogos se cierran o no se pintan con una web abierta.
- **Superficie:** operaciones en cola (entrar, salir, descargar, cambiar de mesa); al cambiar de mesa se descargan las webs de la anterior respetando `beforeunload`.

## Smoke de punta a punta

Build compilada, página sintética local y URLs inventadas de Figma, Pinterest y Notion (no se cargan; solo se reconocen).

| Comprobación | Resultado |
| --- | --- |
| La interfaz local no tiene Node | Correcto |
| El IPC rechaza `file://` al añadir tarjeta | Correcto |
| Reconoce web, Figma y Pinterest | Correcto |
| Abre la mesa con sus tarjetas desde el inicio | Correcto |
| Clic derecho → «Añadir URL» crea una tarjeta Notion, añadiendo `https://` | Correcto |
| Entrar carga la web en el panel | Correcto (73–99 ms) |
| Barra con «Volver al lienzo» con la web abierta | Correcto |
| Captura al salir | **Fallo de entorno**: la pantalla estaba bloqueada (`CGSSessionScreenIsLocked` = 1) y Chromium no compone ni captura. El smoke de T-001, que antes pasaba, falla igual en ese estado. Repetir con la pantalla desbloqueada. |
| Título de la página guardado en la tarjeta | Correcto |
| Descargar la web | Correcto |
| Recargar conserva la mesa y sus 4 tarjetas | Correcto |
| Al abrir una mesa no se carga ninguna web | Correcto |
| Borrar la mesa | Correcto |
| Procesos tras cerrar | 0 |
| `beforeunload` en la web: mantener / descartar | Correcto / Correcto |
| `beforeunload` en un popup: mantener deja la tarjeta cargada; descartar cierra popup y tarjeta | Correcto / Correcto |
| Cerrar la ventana antes del retardo guarda la vista del lienzo | Correcto |

17/18 tras las correcciones; el único fallo es la captura con la pantalla bloqueada. Tests unitarios: 99 (guardado 25, servicios 74, incluido añadir un servicio de prueba al catálogo sin tocar nada más).

## Prueba con el usuario (2026-10-26)

- **Aspecto:** le gusta. Pidió seleccionar varias tarjetas y ordenarlas, rejilla e imán: implementado (selección con recuadro, `⌘A`, «Ordenar en cuadrícula», alinear, imán con guías y rejilla de 24 px; ver [diseño](../design.md)).
- **Notion como tarjeta web:** login y edición funcionan dentro de Table.
- **Memoria con varias webs:** pidió ayuda para no acumular webs cargadas; implementada la descarga automática (abajo).

## Pendiente

- ~~Repetir el smoke con la pantalla desbloqueada~~ Hecho: **19/19** con la pantalla desbloqueada (22/22 tras añadir ordenar y la descarga automática); la captura se guarda al salir y se ve en la tarjeta.
- ~~Confirmar a mano~~ Confirmado por el usuario: entrar y trabajar con la web abierta, «Añadir URL» con `+` y pegando, y la barra superior con la web abierta.
- ~~Memoria con 1, 3 y 6 tarjetas~~ Medida (abajo).

## Memoria con 1, 3 y 6 tarjetas (2026-10-26)

Condiciones: equipo de referencia (D-011), solo Finder y el terminal abiertos, presión **normal** en todas las muestras, swap estable o bajando. Build compilada, sesiones ya iniciadas. Modo `TABLE_MEASURE` (`app/src/main/measure.ts`): por pasada, mesa temporal con N tarjetas; se entra en cada una (carga y 15 s), se sale, y la última queda abierta; 30 s de asentamiento y mediana de 30 s. Métrica: suma de `phys_footprint` del árbol de procesos (`spikes/desktop-001/scripts/sample-memory.mjs`). Tarjetas, en este orden: archivo de Figma del piloto, ficha de Notion del piloto, inicio de Pinterest, inicio de Figma, base de proyectos de Notion, ideas de Pinterest (URLs solo en `.local/`).

| Tarjetas | Sin límite: estable | Sin límite: pico | Con límite de 2: estable | Con límite de 2: pico | Webs cargadas al final (con límite) |
| --- | --- | --- | --- | --- | --- |
| Ninguna (shell) | — | — | 127 MiB | 156 MiB | 0 |
| 1 | 1 288 MiB | no capturado* | 1 303 MiB | 1 844 MiB | 1 |
| 3 | 2 282 MiB | 2 948 MiB | 1 194 MiB | 2 782 MiB | 2 |
| 6 | 3 471 MiB | 4 168 MiB | **1 014 MiB** | **2 794 MiB** | 2 |

\* El muestreo de la primera pasada sin límite empezó tarde.

Lectura:
- Sin límite, cada web añadida suma entre 400 y 700 MiB en estable.
- Con el límite de 2, el estable deja de crecer con el número de tarjetas (−48 % con 3 y −71 % con 6) y el pico se queda por debajo de 2,8 GiB.
- El estable con límite depende de qué webs quedan cargadas: con Figma abierto (1 tarjeta) es mayor que con Pinterest y Notion (3 y 6).
- Con 1 tarjeta (Figma), Table queda en 1,3 GiB frente a 2,6 GiB de Figma de escritorio (T-001).

Propuesta para fijar el escenario B en [validación de memoria](../memory-validation.md), pendiente de aceptación: con el límite de 2 webs, estable ≤ 2 GiB y pico ≤ 3,5 GiB con cualquier número de tarjetas en el equipo de referencia, presión normal. El escenario B completo (ficha de Notion por API y miniaturas de Figma) aún no existe; se medirá cuando estén.

### Dato informal: 3 tarjetas cargadas en uso real

Instantánea con `footprint` mientras el usuario usaba Table con 3 tarjetas abiertas (2026-10-26). **No es una medición del escenario B:** presión de memoria en aviso, swap con ~18 GiB usados y otras apps abiertas (Chrome, Notion, Figma de escritorio, Discord, ChatGPT).

| Proceso | `phys_footprint` |
| --- | --- |
| GPU | 1 128 MB |
| Renderers de las webs (3 mayores) | 879 + 441 + 177 MB |
| Interfaz, proceso principal y resto | ~360 MB |
| **Total** | **2 984 MB** |

Lectura: cada web cargada (activa o conservada) suma su renderer y aumenta el proceso GPU. Con tres webs conservadas, Table ya supera a Figma de escritorio solo (2 582 MiB estable en T-001).

Respuesta, aceptada por el usuario: **descarga automática** con un máximo de 2 webs cargadas (la abierta incluida). Al entrar en otra se descarga la menos usada; si avisa de cambios sin guardar, se queda cargada sin preguntar. Smoke: 22/22, con dos comprobaciones nuevas (descarga de la menos usada y web con cambios conservada sin diálogo).
