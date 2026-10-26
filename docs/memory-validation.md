# Validación de memoria

Fecha: 26 de octubre de 2026. Estado: protocolo propuesto; mediciones no ejecutadas.

## Objetivo

Comprobar si Table permite trabajar con el proyecto, el editor de Figma, referencias y agentes dentro de un presupuesto de memoria útil para el equipo. Comparar el mismo trabajo en Table y en las aplicaciones separadas. Reunir herramientas en una ventana no garantiza ahorrar RAM.

La RAM del equipo de referencia todavía no se ha identificado. No hay cifras de consumo verificadas ni una mejora atribuible a Electron, Tauri o Rust.

## Qué se mantiene cargado

| Elemento | Propuesta inicial | Qué medir |
| --- | --- | --- |
| Ficha de Notion | Datos filtrados por API y componentes propios; editor completo solo bajo demanda. | Coste de la ficha y de cada refresco, separado del navegador completo. |
| Figma | Un editor del proyecto en uso; otros frames como miniaturas limitadas en resolución. | Apertura, edición, retorno al lienzo, conservación y cierre seguro. |
| Pinterest y referencias web | Navegación bajo demanda; captura y enlace cuando se descarga la página. | Pico al abrir, recursos retenidos y coste de volver a cargar. |
| Lienzo | Renderizar los elementos necesarios para la vista y limitar imágenes decodificadas. | Coste según tarjetas visibles, imágenes y desplazamiento. |
| Terminales | Historial visible acotado; registros persistidos en disco. | Renderizado, salida abundante, sesión ociosa y proceso asociado. |
| Arneses | Sesiones iniciadas por el usuario, con autenticación propia de cada herramienta. | Árbol completo de procesos y herramientas que lanza cada arnés. |
| Otros proyectos | Guardar datos y distribución; no iniciar sus editores o arneses al arrancar Table. | Coste residual tras cambiar o cerrar un proyecto. |

Estas medidas son hipótesis de diseño. La implementación y el resultado deben demostrarse.

## Estados de una tarjeta web

1. **Activa:** contenido web cargado y disponible para interacción.
2. **Conservada:** sigue cargada para preservar el estado, aunque muestre una captura o esté fuera de vista. Sigue consumiendo memoria.
3. **Descargada:** contenido web cerrado; quedan el enlace, la captura y el estado que pueda restaurarse de forma fiable. Volver a usarla requiere cargar la página.

Solo una tarjeta puede recibir la interacción principal, pero eso no impide tener varias páginas conservadas en memoria. Hay que registrar ambos recuentos por separado.

Reducir temporizadores y animaciones en segundo plano no descarga la página. Cerrar su contenido web libera recursos asociados, pero no garantiza que toda la memoria del proceso compartido o sus cachés desaparezca inmediatamente.

Una captura no conserva formularios, selección ni trabajo pendiente. No cerrar automáticamente un editor por tiempo de inactividad o presión de memoria si no podemos asegurar que no pierde trabajo. Respetar las señales de cierre de la página. Si no hay una señal fiable de guardado, mantener la sesión y ofrecer el cierre manual dentro del producto. El umbral de memoria no autoriza a descartar cambios.

## Escenarios por fase

| Escenario | Momento | Carga |
| --- | --- | --- |
| A. Navegador mínimo | Fase 0, tarea 001 | Shell de escritorio y una vista web; probar Figma y Pinterest por separado. |
| B. Proyecto en un sitio | Fase 1 | Ficha de Notion por API, conjunto fijo de miniaturas y referencias, editor de Figma y navegación puntual en Pinterest. |
| C. Trabajo con agentes | Fase 2 | Escenario B, terminales y dos arneses con tareas representativas y autenticación propia. |

El escenario C no convierte los agentes en un requisito para terminar la Fase 1. Puede hacerse antes un ensayo aislado de procesos para estimar su coste, documentado como experimento y sin desarrollar aún la integración completa.

Usar dos arneses con modelos en la nube no implica cargar dos modelos en el Mac. Sí implica ejecutar clientes, conectores y herramientas locales. Registrar navegadores, servidores y compilaciones que estos lancen. Las pruebas con modelos locales forman un escenario distinto y deben indicar modelo, cuantización y memoria de GPU o memoria unificada; no mezclarlas con la comparación de agentes en la nube.

## Preparación reproducible

Antes de comparar, registrar:

- Equipo, RAM, sistema operativo, arquitectura y pantallas utilizadas.
- Versiones de Table, runtime, aplicaciones, arneses y herramientas adicionales.
- Proyecto piloto y carga fija: complejidad del archivo de diseño, número y resolución de miniaturas, referencias y páginas abiertas. Usar identificadores sintéticos en el repositorio público.
- Tareas exactas de los arneses y límite de procesos simultáneos. No cambiar modelo o carga entre ejecuciones comparables.
- Aplicaciones ajenas a la prueba, presión de memoria y swap al comenzar.
- Condiciones de caché y arranque: distinguir primera apertura de reapertura con caché.

La comparación tiene dos ejecuciones separadas: flujo actual en aplicaciones independientes y flujo equivalente en Table. No dejar abierta una segunda copia del mismo Figma durante la prueba de Table salvo que ese sea el escenario medido. Un ensayo con mocks sirve para el desarrollo, pero no valida el consumo del trabajo real.

## Procedimiento

1. Medir el equipo en reposo y el shell sin proyecto.
2. Abrir cada componente de forma incremental y anotar el incremento y el pico.
3. Ejecutar la misma secuencia de navegación, edición y selección en ambos flujos.
4. En Fase 2, repetir con uno y dos arneses; registrar también las herramientas que abren.
5. Completar o guardar el trabajo y cerrar las superficies que puedan descargarse con seguridad.
6. Repetir el número de ciclos definido antes del ensayo y observar si el consumo vuelve a un nivel estable o crece de forma sostenida.
7. Cerrar el proyecto y después Table. Comprobar los procesos que siguen activos y justificar cada uno; no terminar procesos ajenos a la aplicación.

Usar el árbol de procesos completo: proceso principal, renderers, GPU, utilidades, PTY, arneses, servidores MCP y herramientas hijas. Medir por componente y el total del flujo. No presentar una suma de RSS como memoria física exclusiva: puede contar páginas compartidas varias veces. En macOS, registrar también presión de memoria y variación de swap. Anotar la herramienta y la definición exacta de cada métrica.

## Criterios cuantitativos antes del ensayo

Antes de cada ensayo, completar los criterios aplicables al escenario que se va a medir. Los presupuestos de fases posteriores pueden seguir pendientes. Los valores se fijan para el equipo mínimo elegido y el trabajo real del piloto; no se deducen del nombre del lenguaje o framework.

| Criterio | Valor fijado | Unidad / método | Estado |
| --- | --- | --- | --- |
| RAM del equipo mínimo | — | GiB | Pendiente |
| Presupuesto del shell en reposo | — | MiB, métrica declarada | Pendiente |
| Presupuesto del escenario A | — | MiB estable y pico | Pendiente |
| Presupuesto del escenario B | — | MiB estable y pico | Pendiente |
| Presupuesto del escenario C | — | MiB estable y pico | Pendiente |
| Incremento máximo frente al flujo separado | — | MiB o porcentaje, con base declarada | Pendiente |
| Ciclos de apertura y cierre | — | Número | Pendiente |
| Ventana de observación tras cerrar contenido | — | Segundos | Pendiente |
| Crecimiento residual permitido entre ciclos | — | MiB por ciclo o pendiente | Pendiente |
| Tiempo máximo de apertura y recuperación | — | Milisegundos o segundos | Pendiente |
| Criterio de presión de memoria y swap | — | Herramienta y umbral | Pendiente |

No declarar validado un escenario sin completar sus criterios o con mediciones no comparables. Aprobar A no valida B ni C. Una pérdida de trabajo, una interfaz que deja de responder o procesos huérfanos sin justificación son fallos aunque el total de RAM entre en el presupuesto.

## Registro de resultados

| Ejecución | Escenario | Equipo / versiones | Reposo | Pico | Tras descarga | Presión / swap | Apertura / recuperación | Resultado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | A | — | — | — | — | — | — | No ejecutado |
| — | B | — | — | — | — | — | — | No ejecutado |
| — | C | — | — | — | — | — | — | No ejecutado |

Separar en el informe los datos medidos, su interpretación y la decisión propuesta. Guardar en el repositorio solo métricas y evidencias saneadas: nunca capturas de clientes, URLs privadas, cookies, tokens, prompts completos ni dumps de memoria.

Si el peso está en las páginas cargadas, revisar su ciclo de vida. Si está en imágenes del lienzo, revisar resolución y caché. Si está en procesos lanzados por los arneses, revisar concurrencia y cierre. Considerar Rust para una parte del motor local solo si una medición identifica ahí un coste que justifique la complejidad añadida.

## Referencias

- [Decisiones](decisions.md).
- [Arquitectura propuesta](architecture.md).
- [Tarea 001: prueba de escritorio](tasks/001-desktop-spike.md).
- [Fuentes técnicas y fecha de consulta](research/sources.md).
- [Electron: cierre y actividad de webContents](https://www.electronjs.org/docs/latest/api/web-contents).
- [Electron: rendimiento](https://www.electronjs.org/docs/latest/tutorial/performance).
