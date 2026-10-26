# Resultados de T-002 · Mesa libre y enlaces

Fecha: 2026-10-26. Estado: **implementada, revisada por Codex en dos rondas y comprobada de forma automática (smoke 19/19); pendiente de prueba manual con el usuario, login de Notion y medición de memoria.**

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

## Pendiente

- ~~Repetir el smoke con la pantalla desbloqueada~~ Hecho: **19/19** con la pantalla desbloqueada; la captura se guarda al salir y se ve en la tarjeta.
- Prueba manual con el usuario: aspecto, interacción, tarjeta descargada «en acción» (D-016).
- Notion como tarjeta web: login y edición.
- Memoria con 1, 3 y 6 tarjetas en condiciones controladas.

### Dato informal: 3 tarjetas cargadas en uso real

Instantánea con `footprint` mientras el usuario usaba Table con 3 tarjetas abiertas (2026-10-26). **No es una medición del escenario B:** presión de memoria en aviso, swap con ~18 GiB usados y otras apps abiertas (Chrome, Notion, Figma de escritorio, Discord, ChatGPT).

| Proceso | `phys_footprint` |
| --- | --- |
| GPU | 1 128 MB |
| Renderers de las webs (3 mayores) | 879 + 441 + 177 MB |
| Interfaz, proceso principal y resto | ~360 MB |
| **Total** | **2 984 MB** |

Lectura: cada web cargada (activa o conservada) suma su renderer y aumenta el proceso GPU. Con tres webs conservadas, Table ya supera a Figma de escritorio solo (2 582 MiB estable en T-001). Descargar las tarjetas que no se usan es lo que mantiene el consumo bajo; queda por decidir si Table debe ayudar a hacerlo (aviso o límite de webs conservadas), siempre sin descargar sola una web con cambios.
