# Instrucciones del proyecto

## Propósito y autoridad

Table es una herramienta interna de FLOC*: un lienzo por proyecto con contexto de Notion, diseño de Figma, referencias y una terminal universal.

Las instrucciones actuales del usuario tienen prioridad. Para el producto Table, `docs/product.md` define el alcance y `docs/decisions.md` registra las decisiones. `docs/roadmap.md` recoge las fases. Si los documentos se contradicen, identifica la discrepancia y corrígela con evidencia; no inventes una decisión.

Notion es la fuente de verdad del **contexto de los proyectos que usen Table**. Los documentos de este repositorio definen **cómo desarrollar Table**. Son responsabilidades distintas.

## Reglas de trabajo

- Claude Code y Codex colaboran en el desarrollo. Ambos pueden construir y revisar. Comparte el estado mediante el repositorio y las tareas; no dependas de lo que solo se habló en una sesión.
- Escribe documentación y comunicaciones en español claro. Usa identificadores de código consistentes con el stack que se adopte.
- Empieza por una tarea pequeña con criterio de aceptación. No conviertas una prueba técnica en toda la aplicación.
- Respeta el orden: proyecto reunido → agentes integrados → publicación. Una prueba aislada de una dependencia futura no adelanta toda esa fase.
- No reabras decisiones aceptadas sin nueva evidencia o instrucción del usuario. Conserva el motivo del cambio.
- No conviertas recomendaciones del asistente en decisiones del usuario. Registra por separado propuestas, resultados medidos y decisiones.
- Los arneses son intercambiables. No bases el dominio del producto en formatos privados o pantallas concretas de Claude Code o Codex.
- Reutiliza convenciones de FLOC* cuando estén disponibles y sean pertinentes. No inventes una arquitectura heredada ni importes una aplicación web entera como base de escritorio.
- Ejecuta las comprobaciones apropiadas al cambio. Para documentación, revisa enlaces, coherencia y diff; no añadas tests que solo repitan el texto.
- Usa una revisión separada para cambios relevantes cuando sea posible. Uno puede construir y el otro revisar, sin roles fijos. Indica si la revisión la hizo otro agente o fue una autorrevisión; no finjas independencia.
- Haz commits acotados. No fuerces ramas ni sobrescribas trabajo ajeno. Sigue las reglas existentes del repositorio y la autorización de la sesión.

## Límites del producto

- Separar arranque de un arnés y su integración avanzada: un programa puede funcionar en el terminal sin saber leer tarjetas o crear resultados.
- El contexto de Notion se entrega filtrado y con procedencia. Omitir `Budget` en un prompt no impide que un MCP amplio lo consulte.
- Una terminal local tiene los permisos del proceso que ejecuta. Un filtro del lienzo no puede garantizar exclusión de datos si el arnés tiene otra credencial o herramienta con acceso a ellos. Documenta ese límite.
- Guardar credenciales con mecanismos del proveedor o del sistema. No imprimirlas, copiarlas al contexto ni incluirlas en Git.
- Contenido web remoto aislado del acceso al sistema y de la terminal. Si se usa Electron: sin Node en contenido remoto, con aislamiento y sandbox; validar las llamadas entre procesos.
- No descargar una sesión de edición sin resolver trabajo pendiente. Ocultar, ralentizar y cerrar una web tienen efectos distintos sobre memoria y estado.
- No afirmar ahorros de RAM, compatibilidad de login, costes o estabilidad sin una prueba o fuente pertinente.
- Mostrar aprobaciones y errores del arnés; la integración no debe responder afirmativamente a sus permisos de forma automática.
- Publicar al portal del cliente es una acción explícita sobre un destino y contenido concretos. Una nota interna o un resultado del agente no se publica automáticamente.

## Datos y documentación pública

Este repositorio es público. Usa fixtures sintéticos. No subas fichas reales, nombres de clientes vinculados a datos privados, URLs privadas, presupuestos, prompts con contenido de proyecto, logs de sesión, capturas ni bases de datos locales.

No añadas una licencia por tu cuenta. La licencia está pendiente de decisión.

## Cierre de una tarea

Entrega el comportamiento o documento cambiado, las comprobaciones realizadas y lo que sigue pendiente. Actualiza la tarea afectada y añade decisiones solo cuando estén realmente tomadas. No marques una fase terminada por haber escrito su documentación.
