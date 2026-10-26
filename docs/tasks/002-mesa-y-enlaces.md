# Tarea 002 · Mesa libre y enlaces con «Añadir URL»

Estado: implementada y revisada (Codex, dos rondas); pendiente de prueba manual, login de Notion y memoria. Resultados en [002-mesa-y-enlaces-results.md](../research/002-mesa-y-enlaces-results.md). Fase: 1. Fecha: 26 de octubre de 2026.

Primera tarea de producto. Construye la base de la aplicación sobre [D-010](../decisions.md) y aplica D-012, D-013 y D-015.

## Resultado esperado

Una persona del equipo crea una mesa con un nombre, añade enlaces con clic derecho → «Añadir URL», ve que Table reconoce Figma, Notion, Pinterest u otra web, trabaja en ellos sobre un lienzo y, al cerrar y reabrir Table, encuentra la mesa como la dejó.

## Alcance

- **Aplicación base** en `app/` (Electron + React + TypeScript). Se reescriben las piezas validadas en T-001 (gestión de `WebContentsView`, IPC validado, aislamiento, popups, permisos, menú contextual, ciclo de vida); el ensayo `spikes/desktop-001/` queda como evidencia y no se convierte en la aplicación.
- **Mesas** (D-013, D-015): crear con nombre, listar, abrir, renombrar y borrar. Guardado local con IDs estables y versión de esquema.
- **Lienzo** con pan y zoom. Candidato: React Flow (P-002); esta tarea aporta la evidencia para decidirlo.
- **«Añadir URL»** (D-012): clic derecho en el lienzo → diálogo → tarjeta en esa posición. También al crear la mesa.
- **Servicios** (P-013): catálogo con Figma, Notion, Pinterest y web genérica. Reconocimiento por URL, icono y nombre del servicio en la tarjeta. Añadir un servicio nuevo es añadir una entrada al catálogo.
- **Tarjeta web**: mismo ciclo de vida que en T-001 (activa, conservada, descargada). Al abrir una mesa, todas las tarjetas empiezan descargadas con su última captura; no se cargan webs automáticamente.
- **Persistencia**: posición, tamaño, URL, servicio, título y captura de cada tarjeta.

## Fuera de alcance

- Leer Notion o Figma por API (ficha, frames, miniaturas): siguiente tarea.
- Configuración global y credenciales: entra con la primera integración por API.
- Notas, conexiones, agentes, terminal, publicación.
- Varios usuarios o sincronización (D-015).

## Decisiones dentro de la tarea

Estas elecciones se toman al implementar, se registran en el informe y no fijan el producto:

- Formato de guardado local: un archivo JSON por mesa o SQLite (P-005). Criterio: lo más simple que permita migrar el esquema.
- Interfaz según [diseño](../design.md) ([D-016](../decisions.md)): carril lateral, barra superior y lienzo en panel.

## Riesgo principal

Con la opción B (D-016) la web no sigue el pan y zoom del lienzo: al entrar ocupa el panel principal y al salir se oculta. El riesgo pasa a ser la coordinación entre la vista nativa y la interfaz local: que la barra superior siga usable con la web abierta, que ningún menú o diálogo del lienzo quede debajo de la web y que el foco vuelva bien al lienzo.

## Criterios de aceptación

- [ ] Inicio con la lista de mesas y «Nueva mesa»; abrir, renombrar y borrar mesas; borrar pide confirmación.
- [ ] Clic derecho en el lienzo → «Añadir URL» crea la tarjeta en la posición del clic; también con `+` en la barra superior y pegando una URL sobre el lienzo.
- [ ] URLs de Figma, Notion, Pinterest y otra web se reconocen y se muestran como tal. Las URL no `http(s)` se rechazan.
- [ ] Añadir un servicio nuevo al catálogo no requiere cambiar el modelo de tarjetas ni el lienzo (comprobado añadiendo uno de prueba).
- [ ] Entrar en una tarjeta abre la web en el panel principal; editar en Figma y volver al lienzo con el botón o `⌘⇧Esc`, como en T-001.
- [ ] Notion abierto como tarjeta web: login y edición probados, o bloqueo registrado.
- [ ] Con una web abierta, la barra superior sigue usable y ningún menú ni diálogo queda debajo de la web.
- [ ] Cerrar y reabrir Table conserva mesas, tarjetas, posiciones y capturas; las webs abren descargadas.
- [ ] Descargar y cerrar respetan `beforeunload` como en T-001.
- [ ] Memoria registrada con 1, 3 y 6 tarjetas (una activa y el resto descargadas), como dato para fijar los umbrales del escenario B; no se declara validado B.
- [ ] Ningún dato de cliente en el repositorio: pruebas con URLs sintéticas o configuradas en local.

## Entregables

- Código en `app/` con comandos documentados.
- Informe en `docs/research/002-mesa-y-enlaces-results.md` con las decisiones internas tomadas, pruebas, mediciones y límites.
- Decisión propuesta sobre P-002 (lienzo) y P-005 (guardado), con evidencia.
