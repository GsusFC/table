# Tarea 001 · Validar el navegador de escritorio

Estado: completada el 2026-10-26. Conclusión: **apto para continuar**, con límites documentados en los [resultados](../research/001-desktop-spike-results.md#conclusión). Fase: 0.

Esta ficha define la primera prueba de implementación. Resultados en [001-desktop-spike-results.md](../research/001-desktop-spike-results.md).

## Resultado esperado

Obtener evidencia de que una ventana de Table puede abrir y editar el Figma del proyecto piloto, conservar la sesión, volver a la vista local y cerrar contenido sin perder trabajo. Medir el coste del navegador mínimo antes de comprometer la arquitectura del producto.

Electron + React + TypeScript es la opción recomendada para este ensayo, todavía propuesta. Utilizar `WebContentsView` como candidato de integración web. Registrar las versiones seleccionadas en el informe de resultados y la conclusión en [Decisiones](../decisions.md). Una prueba favorable de esta pieza no valida por sí sola el lienzo completo ni su consumo con agentes.

## Alcance

- Una ventana con interfaz local mínima y una superficie web activa.
- Figma y Pinterest, probados por separado; una referencia web de prueba cuando ayude a comprobar navegación o cierre.
- Entrada a la superficie web y salida mediante un control visible de Table. Comprobar el conflicto de atajos antes de reservar `Esc`.
- Persistencia de sesión mediante los mecanismos del runtime, sin copiar cookies del navegador del sistema.
- Captura de la superficie y cierre real del contenido cuando sea seguro.
- Medición del escenario A de [Validación de memoria](../memory-validation.md).

Quedan para tareas posteriores el lienzo infinito, la lista de proyectos, Notion, la terminal universal, la ejecución de arneses y la publicación al portal. La ficha de Notion se planteará como lectura filtrada por API, sin exigir que su editor completo permanezca cargado. La prueba de dos arneses corresponde al escenario C de Fase 2.

## Preparación

1. Leer [CLAUDE.md](../../CLAUDE.md), [Arquitectura](../architecture.md), [Decisiones](../decisions.md) y el protocolo de memoria.
2. Elegir un proyecto piloto accesible con la cuenta de prueba. Sus enlaces y datos se configuran localmente; no se incorporan al repositorio público.
3. Identificar equipo, RAM y herramientas de medición. Completar los umbrales del escenario A antes de medir. Si el entorno bloquea la consulta, registrar la limitación; no inventar valores ni cambiar permisos para evitarla.
4. Acordar una edición reversible de prueba y cómo verificar su guardado. Puede usarse un archivo de diseño específico para el ensayo.

## Referencias de implementación

La [evaluación de OpenCove](../research/opencove-evaluation.md) (commit `e10604b9`) identifica soluciones aplicables. Se estudian y reescriben a escala del ensayo; no se copia código sin conservar su aviso MIT.

| Incremento | Qué estudiar en OpenCove | Qué corregir respecto a OpenCove |
| --- | --- | --- |
| A | `WebContentsView` en una vista anfitriona con geometría sincronizada desde el renderer (`src/app/main/websiteWindow/`); zoom de página de la ventana principal desactivado para no descuadrar `setBounds` (`src/app/main/index.ts`). Contenido remoto sin Node ni preload, con `sandbox` y `contextIsolation`. | Validar emisor (`senderFrame`) y argumentos de cada IPC; definir CSP en la interfaz local. |
| B | Particiones `persist:` por perfil (`websiteWindowSessions.ts`); prompt de permisos con decisión recordada por origen. | No convertir popups en tarjetas: comprobar si el login de Figma o Google necesita `window.opener`. Particionar por proyecto si procede. |
| C | Estados activa/templada/fría, presupuesto de vistas activas, captura con `capturePage` y descarte temporizado (`websiteWindowLifecycle.ts`, `websiteWindowPolicy.ts`). | No cerrar con `waitForBeforeUnload: false`; respetar `will-prevent-unload` y el guardado pendiente. |

## Trabajo en incrementos

### A. Ventana y navegación

- Crear el mínimo shell necesario para la prueba y documentar sus comandos reales de instalación y ejecución.
- Abrir una URL de prueba en `WebContentsView`.
- Mantener el contenido remoto aislado de Node.js, credenciales y funciones privilegiadas de la aplicación.
- Probar foco, teclado, scroll, zoom, redimensionado y retorno a la interfaz local.

**Salida comprobable:** la ventana abre la web y se puede entrar y salir de ella sin bloquear la interfaz.

### B. Sesión y edición real

- Iniciar sesión en Figma por una vía admitida por el proveedor y editar el archivo de prueba.
- Cerrar y reabrir Table para comprobar qué parte de la sesión se conserva.
- Probar Pinterest con la cuenta de prueba y registrar navegación, inicio de sesión y persistencia.
- Si un inicio de sesión externo falla, registrar el punto exacto y el error saneado. Abrir el navegador del sistema no demuestra que la sesión se haya transferido a Table.

**Salida comprobable:** existe evidencia de autenticación y edición reales, o un bloqueo reproducible que permite decidir el siguiente paso.

### C. Conservación, descarga y memoria

- Mostrar una captura y distinguir el estado conservado del descargado.
- Verificar el guardado de la edición antes de cerrar su contenido web. Respetar las señales de prevención de cierre.
- Si no puede determinarse de forma fiable si hay trabajo pendiente, mantener el editor cargado y documentar el cierre manual como límite del ensayo.
- Cerrar realmente el contenido descargable, reabrirlo y comprobar qué estado se recupera.
- Medir reposo, pico, recuperación y ciclos de apertura y cierre según el protocolo.

**Salida comprobable:** registro de memoria reproducible y descripción precisa de lo que se conserva, se pierde o requiere recarga.

Cada incremento debe poder revisarse por separado. Detener la ampliación cuando la evidencia del incremento anterior señale una dependencia no resuelta; documentar el bloqueo concreto y continuar solo con trabajo independiente útil.

## Criterios de aceptación

- [x] La prueba usa versiones y comandos documentados que otra persona puede reproducir.
- [x] Figma permite autenticación y edición real en el entorno elegido, o queda registrado un bloqueo reproducible.
- [x] Pinterest permite el flujo de navegación probado, o queda registrado un bloqueo reproducible.
- [x] Se han comprobado foco, teclado, scroll y retorno a Table. Con entradas sintéticas y durante el uso real; pellizco en trackpad sin confirmar.
- [x] La persistencia de sesión se ha probado tras reiniciar la aplicación.
- [x] La captura no se presenta como garantía de conservar la sesión de edición.
- [x] No se fuerza el cierre de contenido con trabajo pendiente o estado de guardado desconocido.
- [x] Se distinguen páginas activas, conservadas y descargadas en los resultados.
- [x] Hay mediciones del escenario A con equipo, método, umbrales y limitaciones; no se extrapolan al escenario C.
- [x] El cierre no deja procesos del ensayo sin explicación y no afecta a procesos ajenos.
- [x] La evidencia publicada no contiene datos de clientes ni credenciales.

Los puntos con un bloqueo documentado cierran el informe de la prueba, pero no aprueban esa capacidad para el producto.

## Entregables y decisión

El prototipo mínimo está en `spikes/desktop-001/` y el informe en [`docs/research/001-desktop-spike-results.md`](../research/001-desktop-spike-results.md).

El informe debe incluir: entorno, versiones, pasos, resultados observados, métricas, incidencias y una recomendación razonada. Clasificar la conclusión como:

- **Apto para continuar:** edición, cierre seguro y memoria cumplen los criterios fijados para el escenario A.
- **Apto con límites:** funciona una parte; indicar qué promesa del producto queda pendiente y su alternativa concreta.
- **No apto en este entorno:** conservar la evidencia y proponer la siguiente prueba acotada.

Registrar la conclusión y cualquier cambio de decisión en [Decisiones](../decisions.md). El siguiente trabajo de producto sigue el orden del [Roadmap](../roadmap.md): proyecto en un sitio, después agentes, después publicación.
