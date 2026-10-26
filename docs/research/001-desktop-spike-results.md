# Resultados de T-001 · Navegador de escritorio

Fecha: 2026-10-26. Estado: **completada. Conclusión: apto para continuar, con los límites indicados al final.** Incrementos A, B y C hechos.

Ficha de la tarea: [T-001](../tasks/001-desktop-spike.md).

## Entorno

| Dato | Valor |
| --- | --- |
| Equipo | Apple M2 Pro, 16 GiB. No está confirmado que sea el equipo de referencia del piloto. |
| Sistema | macOS 27.2, arm64 |
| Node / npm | 22.22.3 / 10.9.8 |
| Electron | 44.9.3 (Chromium 152.0.7977.167) |
| Build | electron-vite 6.0.0, Vite 8.3.5, TypeScript 5.9.3 |
| Interfaz | React 19.3.1 |

Se eligió Electron 44 en lugar de 45.0.0, publicado como `latest` en la fecha de la prueba, para no estrenar una versión mayor `.0.0` en el ensayo. Versiones fijadas sin rango en `package.json` y `package-lock.json`.

## Comandos

Desde `spikes/desktop-001/`:

| Comando | Qué hace |
| --- | --- |
| `npm install` | Instala las versiones fijadas. |
| `npm run dev` | Abre el ensayo con recarga en caliente. |
| `npm run typecheck` | Comprueba tipos. |
| `npm run smoke` | Compila y recorre el incremento A sin intervención; código de salida 0 si todo pasa. |
| `npm start` | Abre la build compilada. |

La sesión web persistente vive en la partición `persist:table-t001`, dentro de los datos de usuario de Electron para esta app (`~/Library/Application Support/table-desktop-spike-001` en macOS). No se guarda en el repositorio.

## Incremento A · Ventana y navegación

### Qué se construyó

- Una ventana con barra de dirección, una tarjeta web y un panel lateral con nota local y estado.
- `WebContentsView` fuera del DOM, colocada sobre el cuerpo de la tarjeta. El renderer envía la geometría con `ResizeObserver`, `resize` y cada cambio de estado; el proceso principal llama a `setBounds`.
- **Entrar:** botón «Entrar» o doble clic en la tarjeta. La vista se muestra y recibe el foco.
- **Salir:** botón visible «Volver a Table» en la cabecera de la tarjeta, o `⌘⇧Esc` (`Ctrl+Shift+Esc` fuera de macOS) interceptado en `before-input-event`. Al salir se toma una captura, se oculta la vista y el foco vuelve a la interfaz local. La captura se rotula como «no es la web activa».
- `Esc` no se reserva: llega a la página.
- Zoom de la web con botones propios (25–300 %). El menú no define atajos de zoom para no robar `⌘+`/`⌘−` a la página. La interfaz local tiene el zoom bloqueado: si cambiara, `getBoundingClientRect()` y `setBounds()` dejarían de coincidir (lección tomada de OpenCove).

### Aislamiento

| Superficie | Medida |
| --- | --- |
| Interfaz local | `sandbox`, `contextIsolation`, sin Node; CSP en `index.html`; navegación limitada a la propia app; popups denegados. |
| Contenido remoto | `sandbox`, `contextIsolation`, sin Node ni preload; navegación y redirecciones solo `http(s)`; popups registrados por origen (denegados en A, ventana hija desde B); `<webview>` prohibido en toda la app. |
| IPC | Cada canal comprueba que el emisor es el documento principal de la interfaz local (`senderFrame`, proceso y URL de la app). URL, límites y zoom se validan en el proceso principal. |
| Permisos y descargas | Incremento A: denegados y registrados. Desde la preparación de B, cada permiso se pregunta al usuario y la decisión se recuerda por origen hasta cerrar Table. Descargas bloqueadas. |
| Registros | Solo orígenes, nunca rutas ni parámetros de URL. |

Al cerrar la ventana con una web cargada, se cierra su contenido con `waitForBeforeUnload: true`. Si la página avisa de trabajo pendiente, Table pregunta al usuario y no descarta cambios por su cuenta. Este camino no se ha ejercitado con una página que bloquee el cierre; corresponde al incremento C.

### Comprobación automática

`npm run smoke` carga una página sintética servida en `127.0.0.1` y usa `webContents.sendInputEvent` para el teclado y la rueda.

| Comprobación | Resultado |
| --- | --- |
| La interfaz local no tiene Node | Correcto |
| El IPC rechaza una URL `file://` | Correcto |
| La página se abre en `WebContentsView` | Correcto |
| El contenido remoto no tiene Node | Correcto |
| La vista coincide con la tarjeta (±1 px) | Correcto: 970×657 en (17, 114) |
| La web recibe el foco al entrar | Correcto |
| La web recibe las teclas | Correcto (ver incidencia) |
| `Esc` llega a la web y no saca de la tarjeta | Correcto |
| `⌘⇧Esc` vuelve a Table y no llega a la web | Correcto |
| Se genera una captura al salir | Correcto |
| El foco vuelve a la interfaz local | Correcto |
| La vista sigue a la tarjeta tras redimensionar | Correcto: 690×549 |
| La rueda desplaza la web | Correcto: `scrollY` 549 |
| El zoom se aplica a la web y no a la interfaz | Correcto: 150 % / 100 % |
| El IPC rechaza un zoom fuera de rango | Correcto |
| Popup http(s) abierto como ventana hija con la misma sesión | Correcto (desde la preparación de B) |
| Popup con esquema no web (`figma://`) no abre nada | Correcto |

Resultado: 18/18 en seis ejecuciones consecutivas del incremento A; 19/19 en cuatro ejecuciones tras preparar B. Tras cada una no quedaron procesos del ensayo.

**Incidencia.** En la primera ejecución las teclas enviadas inmediatamente después de entrar no llegaron a la página (16/18). Tras añadir dos consultas a la página antes de enviarlas, no se ha repetido. `[INFERENCIA]` Las teclas sintéticas enviadas antes de que el renderer procese el foco se pierden. Hay que vigilar si ocurre con teclado real al entrar y escribir enseguida.

### Prueba manual pendiente

Las entradas sintéticas no recorren el foco del sistema operativo ni los atajos reales. Falta comprobar con teclado, ratón y trackpad, en `npm run dev`:

- [ ] Escribir en un campo de una web tras entrar, sin hacer clic antes.
- [ ] `Esc` en la web no saca de la tarjeta; `⌘⇧Esc` y el botón sí.
- [ ] Tras salir, el teclado escribe en la nota local.
- [ ] Clic directo sobre la web cuando está visible: recibe el foco.
- [ ] Scroll con trackpad y gesto de pellizco dentro de la web.
- [ ] `⌘C`/`⌘V` dentro de la web.
- [ ] Redimensionar la ventana con la web dentro: sin desajustes visibles.
- [ ] La interfaz local responde mientras la web carga.

### Limitaciones conocidas del incremento A

- Navegar desde la barra de dirección reutiliza la vista sin consultar `beforeunload`.
- Una sola tarjeta; sin lienzo, pan ni zoom de lienzo.
- Sin medición de memoria: corresponde al incremento C y requiere los umbrales del escenario A.

## Incremento B · Sesión y edición real

En curso. Archivo del piloto configurado fuera del repositorio con la variable `TABLE_SPIKE_START_URL`:

```sh
TABLE_SPIKE_START_URL='<url-del-archivo-de-figma>' npm run dev
```

Cambios respecto al incremento A, motivados por la [evaluación de OpenCove](opencove-evaluation.md):

- Los popups `http(s)` y `about:blank` se abren como ventana hija real, con `window.opener` y la misma partición, para no romper logins como el de Google. Cada popup tiene las mismas restricciones de navegación; otros esquemas se bloquean.
- Permisos preguntados al usuario en vez de denegados, para descubrir qué pide Figma sin concederlo a ciegas.
- No se modifica el user agent: si Google rechaza el login por detectar un navegador integrado, se registra como bloqueo; suplantar a Chrome no es una vía admitida por el proveedor.

### Login en Figma (2026-10-26)

**Funciona.** El usuario confirma que trabaja en el archivo del piloto dentro de la tarjeta. Por los orígenes registrados, el login fue con Google `[INFERENCIA]`. Secuencia (solo orígenes):

1. Figma abre un popup (`popup-opened`, `https://www.figma.com`) que pasa por `accounts.google.com`. Se cierra al terminar, aproximadamente un minuto después.
2. Un segundo popup de Figma se abre y se cierra; después la tarjeta carga `verify.figma.com` y vuelve a `www.figma.com` con sesión.
3. Google no bloqueó el login por ser un navegador integrado, con el user agent de Electron sin modificar.

Con el bloqueo de popups del incremento A este login no habría sido posible: el popup es imprescindible.

Permisos observados:

| Tipo | Origen | Permiso | Resultado |
| --- | --- | --- | --- |
| Solicitud | `www.figma.com` | `persistent-storage` | Concedido por el usuario |
| Solicitud | `www.google.com` (dentro de un popup de encuesta de `research.rallyuxr.com`) | `storage-access` | Concedido por el usuario |
| Consulta | `www.figma.com` | `clipboard-read`, `notifications`, `media`, `loopback-network`, `window-management`, `background-sync` | Denegado (sin solicitud explícita) |
| Consulta | `verify.figma.com` | `sensors`, `notifications`, `media`, `storage-access`, `persistent-storage`, `background-fetch`, `payment-handler`, `background-sync` | Denegado |

Las consultas son comprobaciones silenciosas, no peticiones al usuario. `clipboard-read` denegado puede afectar al pegado desde otras aplicaciones: hay que comprobarlo.

Mensajes de Chromium en consola sin efecto observado: `sandbox_extension_issue_file … Operation not permitted`, `task_policy_set … invalid argument` y `error messaging the mach port for IMKCFRunLoopWakeUpReliable` (método de entrada de macOS).

**Copiar y pegar:** funciona, según el usuario, con texto dentro de Figma, texto copiado en otra aplicación y un frame copiado y pegado dentro del archivo. El registro no muestra ninguna solicitud de permiso nueva: Figma no necesitó `clipboard-read`.

Pegar el frame es la primera edición real hecha desde Table. Falta comprobar que el cambio persiste al salir y volver a entrar, y deshacerlo si se hizo en el archivo original.

**Cierre con Figma cargado:** el usuario cerró Table con el archivo abierto, tras salir y volver a entrar en la tarjeta. Figma no bloqueó el cierre (no hubo `will-prevent-unload`), el proceso terminó con código 0 y no quedaron procesos del ensayo. La partición `persist:table-t001` quedó en disco.

**Reapertura:** Table se volvió a abrir con la misma partición. El usuario confirma que entró en Figma **sin volver a iniciar sesión** y que el frame pegado en la sesión anterior **seguía en el archivo**. El registro lo corrobora: no hubo popups de login, `accounts.google.com` ni `verify.figma.com`. Figma volvió a pedir `persistent-storage`, que el usuario concedió: las decisiones de permisos solo se recuerdan mientras Table está abierto. Cierre limpio (código 0), sin procesos restantes.

Resultado para Figma: autenticación, edición guardada y sesión persistente tras reiniciar comprobadas en el entorno descrito.

### Pinterest (2026-10-26)

Abierto desde la barra de dirección en la misma partición (`https://es.pinterest.com`). Registro de la primera sesión:

- Consultas denegadas: `notifications` y `background-sync` en `es.pinterest.com`, y `background-sync` en `accounts.google.com`.
- Solicitud concedida por el usuario: `storage-access` para `www.recaptcha.net`.
- No se abrió ningún popup: el paso por `accounts.google.com` ocurrió dentro de la página. `[INFERENCIA]` Login con Google integrado en la página o por redirección.
- Cierre limpio (código 0).

**Resultado (confirmado por el usuario):** el login y la navegación por Pinterest funcionan. Al reabrir Table directamente en `es.pinterest.com`, el registro no muestra paso por `accounts.google.com`: la sesión se conservó.

**Hallazgo: copiar imágenes.** El usuario no encontró cómo copiar una imagen. Electron no incluye menú contextual, así que no existía «Copiar imagen». Se añadió un menú contextual mínimo en la web y sus popups: copiar imagen (`copyImageAt`), copiar la dirección de la imagen, copiar enlace y cortar/copiar/pegar en campos editables. No incluye «Guardar imagen»: las descargas siguen bloqueadas.

Comprobado: dos imágenes copiadas desde `i.pinimg.com` (`image-copied` en el registro) se pegaron en la app de escritorio de Figma. Resolución de la imagen pegada sin verificar.

### Conclusión del incremento B

En este equipo, con Electron 44.9.3 y el user agent sin modificar:

| Capacidad | Figma | Pinterest |
| --- | --- | --- |
| Login (Google) | Funciona; requiere popup como ventana hija | Funciona; sin popup |
| Uso real | Edición guardada (frame pegado) | Navegación y copia de imágenes a Figma |
| Sesión tras reiniciar | Se conserva | Se conserva |
| Copiar y pegar | Texto en ambos sentidos y capas | Imágenes con menú contextual |
| Permisos solicitados | `persistent-storage` | `storage-access` (`recaptcha.net`) |

Lo que cambió respecto al incremento A para que funcionara: popups como ventana hija, permisos preguntados al usuario y menú contextual. Las decisiones de permisos no persisten entre reinicios: Figma vuelve a pedir `persistent-storage` cada vez.

## Incremento C · Conservación, descarga y memoria

Hecho. Umbrales fijados en [validación de memoria](../memory-validation.md) el 2026-10-26.

### Estados y cierre seguro

| Estado | Qué ocurre | Memoria |
| --- | --- | --- |
| Activa | Vista visible con la interacción. | Cargada |
| Conservada | Al salir: captura con hora y vista oculta, sin cerrar. La interfaz lo indica: «la web sigue cargada en memoria». | Cargada |
| Descargada | Botón «Descargar»: cierra el contenido con `waitForBeforeUnload: true`. Quedan URL y captura fija con su hora. «Recargar» vuelve a abrirla y mide la carga. | Liberada (a medir) |

- La descarga es siempre manual: nunca por tiempo ni por presión de memoria.
- Si la página declara cambios con `beforeunload`, Table pregunta «Mantener cargada» o «Descargar sin guardar». Mismo criterio al cerrar la ventana.
- Abrir otra dirección descarga antes la actual por el mismo camino; en el incremento A se navegaba sin consultar `beforeunload`.
- Smoke: 23/23. Comprobaciones nuevas: descarga con URL y captura conservadas, recarga con duración medida, y una página sintética con `beforeunload` que se mantiene si el usuario elige mantener y se descarga si acepta descartar.

### Arnés de medición

| Pieza | Función |
| --- | --- |
| Modo ciclos (`TABLE_SPIKE_CYCLES`, `TABLE_SPIKE_ACTIVE_SECONDS`) | Reposo del shell 30 s; por ciclo: cargar, activa, conservada 5 s, descargar, observar 30 s. Marcadores `[t001-cycle]` con hora. Sin intervención: permisos denegados y cambios pendientes mantenidos (aborta el ciclo). |
| `scripts/sample-memory.mjs` | Suma de `phys_footprint` de los procesos cuya línea de comandos contiene un texto, presión de memoria y swap, cada 2 s, en JSONL. |
| `scripts/summarize-cycles.mjs` | Cruza muestras y marcadores: reposo del shell, pico, memoria conservada y tras descargar por ciclo, pendiente residual, presión máxima y variación de swap. |

Comandos (build compilada, no modo desarrollo; los resultados quedan en `.local/`, ignorado por Git):

```sh
npm run build
node scripts/sample-memory.mjs --match 'spikes/desktop-001/node_modules/electron/dist' --out .local/samples.jsonl &
TABLE_SPIKE_START_URL='<url>' TABLE_SPIKE_CYCLES=10 npx electron . > .local/table.txt
kill %1
node scripts/summarize-cycles.mjs --samples .local/samples.jsonl --log .local/table.txt
```

Validación del arnés con una página sintética local, 2 ciclos: reposo del shell 115 MiB, pico 245 MiB, conservada 209 / 202 MiB, tras descargar 132 / 145 MiB, sin procesos restantes. Solo valida que el arnés funciona; no es una medición del escenario A.

### Condiciones del equipo antes de medir

El 2026-10-26, antes de cualquier medición, el equipo estaba en presión de memoria de **aviso** (`kern.memorystatus_vm_pressure_level` = 2) con **~24 000 de 24 576 MiB de swap usados**, con otras aplicaciones abiertas. En ese estado el criterio «presión normal y swap sin crecimiento» no se puede cumplir por causas ajenas a Table. La medición requiere cerrar aplicaciones pesadas y registrar el estado inicial.

Para medir, el usuario cerró todas las aplicaciones salvo Finder y el terminal. Estado inicial (2026-10-26 15:51 UTC): presión **normal** (1), swap 9 371 / 10 240 MiB usados; quedaba swap de la sesión anterior, que siguió bajando durante el ensayo.

### Medición de Table (escenario A)

Build compilada (`electron-vite build`), archivo de Figma del piloto, sesión iniciada, permisos denegados sin intervención y una sola tarjeta.

| Medida | Resultado | Umbral | Estado |
| --- | --- | --- | --- |
| Shell en reposo, sin web | 112–115 MiB | Sin umbral | Registrado |
| Figma activa, estable (mediana de los últimos 30 s de 60 s activa) | 1 585 MiB | ≤ 2 969 MiB (Figma de escritorio 2 582 + 15 %) | Cumple: −39 % |
| Pico durante carga y uso | 2 172 MiB (pasada de 60 s); 2 524 MiB máximo en 10 ciclos | ≤ 4 598 MiB (Figma de escritorio 3 998 + 15 %) | Cumple |
| Conservada (5 s tras salir) | 1 292–1 883 MiB | — | Registrado |
| 30 s tras descargar, ciclos 1–10 | 154, 153, 361, 234, 234, 232, 233, 234, 234, 232 MiB | — | Registrado |
| Crecimiento residual | 3,8 MiB por ciclo (mínimos cuadrados); estable en ~233 MiB desde el ciclo 4 | ≤ 20 MiB por ciclo, sin tendencia | Cumple |
| Carga hasta `did-stop-loading` | 2,0–2,7 s (10 ciclos); 4,0 s en la pasada de 60 s | ≤ 10 s | Cumple, con límite: el editor puede tardar más en quedar usable |
| Presión y swap | Presión normal en todas las muestras; swap −184 MiB | Normal, sin crecimiento | Cumple |
| Procesos tras cerrar | 0 | 0 | Cumple |
| Descargas bloqueadas por `beforeunload` | 0 de 11 | — | Registrado |

Descargar libera la mayor parte de la memoria de Figma (de ~1,8 GiB conservada a ~233 MiB). Respecto al shell en reposo quedan ~120 MiB retenidos tras el ciclo 4, sin crecimiento posterior. `[INFERENCIA]` Caché compartida de Chromium o de la partición.

### Base: Figma de escritorio

**Intento 1, no comparable.** `open -a Figma <url>` con muestreo de 120 s dio 13 procesos (8 renderers, varios de 228 a 930 MB), 4 574 MiB estables, 5 652 MiB de pico y presión de aviso. `[INFERENCIA]` Figma restauró pestañas de sesiones anteriores.

**Intento 2, descartado.** El usuario cerró las pestañas y Figma volvió a abrirse antes de empezar el muestreo: no se capturó la carga. Estable: 2 589 MiB, coherente con el intento 3.

**Intento 3, válido.** Figma cerrado y comprobado durante 30 s, presión normal. Muestreo desde antes de `open -a Figma <url>` con solo el archivo del piloto, 120 s:

| Medida | Figma de escritorio 126.10.11 | Table |
| --- | --- | --- |
| Procesos | 11 (6 renderers) | 5 |
| Estable | 2 582 MiB (mediana de los últimos 30 s de 120 s) | 1 585 MiB (últimos 30 s de 60 s activa) |
| Pico | 3 998 MiB | 2 172 MiB (misma pasada); 2 524 MiB en 10 ciclos |
| Presión / swap | Normal / sin variación | Normal / bajando |

Mayor consumo de Figma de escritorio, desglosado al final del intento 3: un renderer de 710 MB, el proceso GPU de 572 MB y cinco renderers más de 27 a 359 MB. `[INFERENCIA]` La app carga interfaz propia (pestañas, inicio, servicios nativos) que Table no tiene. El agente de fuentes de Figma (`FigmaAgent.app`) queda fuera de ambas mediciones: corre aparte y da servicio a los dos flujos.

Límites de la comparación: una sola pasada por flujo; ventanas de estabilidad distintas (30–60 s tras cargar en Table, 90–120 s tras abrir en Figma de escritorio); Figma de escritorio incluye el arranque de la app; el editor en Table es la versión web de Figma, no la app de escritorio.

## Conclusión

**Apto para continuar** según los criterios de la tarea: en este equipo, la edición real de Figma, el cierre seguro y la memoria cumplen los criterios fijados para el escenario A.

| Capacidad | Resultado |
| --- | --- |
| Web integrada con `WebContentsView` | Funciona: geometría, foco, teclado, zoom y retorno a Table (automático y uso real). |
| Login y sesión | Figma y Pinterest con Google; sesión persistente tras reiniciar. Requiere popups como ventana real. |
| Edición y portapapeles | Edición guardada en Figma; texto, capas e imágenes de Pinterest. Requiere menú contextual propio. |
| Ciclo de vida | Activa, conservada y descargada; la descarga libera ~1,6 GiB y no se acumula entre ciclos. |
| Cierre seguro | Respeta `beforeunload` y pregunta al usuario; nunca descarga automáticamente. |
| Memoria (escenario A) | 39 % por debajo de Figma de escritorio en estable; 46 % en pico de la misma pasada (37 % con el máximo de los 10 ciclos). |

Límites que siguen abiertos:

- **`beforeunload` real de Figma no observado:** en 11 descargas y 4 cierres Figma nunca declaró cambios pendientes. El usuario indica que en el estudio no se edita Figma sin conexión; queda como riesgo una desconexión accidental durante la edición, cubierta por el mecanismo probado con una página sintética.
- **Carga medida hasta `did-stop-loading`**, no hasta que el editor responde.
- **Equipo de referencia:** el Mac del usuario ([D-011](../decisions.md)), con las demás aplicaciones cerradas para medir. La carga habitual con todo abierto no está medida.
- **Permisos no persistentes** entre reinicios.
- **Prueba manual del incremento A parcial:** pellizco en trackpad y escribir justo al entrar sin confirmar explícitamente.
- **Aprobar el escenario A no valida B ni C** de [validación de memoria](../memory-validation.md): lienzo con varias tarjetas, Notion y arneses siguen sin medir.

La adopción de Electron y `WebContentsView` (P-001, P-003) sigue siendo una decisión del usuario; este informe aporta la evidencia.
