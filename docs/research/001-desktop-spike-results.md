# Resultados de T-001 · Navegador de escritorio

Fecha: 2026-10-26. Estado: **incremento A implementado y comprobado con entradas sintéticas; falta la prueba manual. Incremento B en curso: preparado, pendiente de login y edición. Incremento C sin empezar.** No hay conclusión de la tarea.

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

Observado al cargar el archivo sin sesión: Figma carga y consulta el permiso `background-sync` (denegado por defecto).

Pendiente: login, edición reversible, persistencia tras reiniciar y Pinterest.

## Incremento C · Conservación, descarga y memoria

No empezado. Requiere fijar los umbrales del escenario A en [validación de memoria](../memory-validation.md).
