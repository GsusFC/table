# Terminal universal y arneses

Estado: principio aceptado, integración por implementar.

## Qué significa «trae tu arnés»

La terminal forma parte permanente de Table. Ejecuta el arnés que elija el usuario, incluido uno propio, siempre que funcione en el entorno local y sea compatible con una terminal. No se limita a Codex y Claude Code.

El arnés conserva su bucle de trabajo, selección de modelos, autenticación, permisos y herramientas. Table aporta la mesa, el contexto autorizado y la organización de resultados.

Una terminal universal no convierte cualquier suscripción en una API universal. Cada combinación arnés/proveedor tiene mecanismos de acceso y condiciones propios.

## Niveles de compatibilidad

| Nivel | Qué puede hacerse | Qué no se presupone |
| --- | --- | --- |
| Terminal | Arrancar e interactuar con el programa. | Que entienda tarjetas, MCP o artefactos de Table. |
| Archivos | Leer una exportación de contexto y escribir artefactos en una carpeta definida. | Que un texto libre de terminal tenga estructura fiable. |
| Herramientas | Consultar contexto filtrado y crear resultados mediante MCP u otro contrato explícito. | Que todos los arneses tengan el mismo soporte o autorización. |
| Adaptador opcional | Mostrar estado, permisos o resultados estructurados de un arnés concreto. | Que su formato sea estable ni común a otros proveedores. |

No interpretar códigos de color ni texto de terminal como fuente fiable de estado o de decisiones. Priorizar mecanismos documentados o importación explícita cuando no haya integración estructurada.

## Perfil de ejecución propuesto

- Nombre visible, ejecutable y argumentos separados.
- Directorio de trabajo del proyecto.
- Variables necesarias y referencias seguras a credenciales, sin guardar sus valores en la mesa.
- Capacidades declaradas: terminal, archivos, MCP y adaptador opcional.
- Política de inicio: manual por defecto; no iniciar todos los arneses al abrir la app.

Un perfil no equivale a una sesión. Cada sesión tiene su proceso, estado, registros y relación con el proyecto. Reanudar una conversación solo se ofrece si el arnés lo soporta; no basta con volver a abrir su terminal.

## Sesiones

Implementación de [T-007](tasks/007-terminal-universal.md). Cada sesión es un proceso en un pseudoterminal (node-pty) del proceso principal; la interfaz solo envía teclas y recibe salida. Se abre a mano desde una mesa y no sobrevive a cerrar Table.

- **Shell de inicio de sesión.** Se arranca `$SHELL -l` (terminal normal) o `$SHELL -l -c '<comando>'` (arnés o perfil propio), con el entorno del usuario más `TERM=xterm-256color` y `COLORTERM=truecolor`, sin variables de Electron ni de Table y sin credenciales de Table. Así el arnés tiene el `PATH` y la autenticación que el usuario tiene en su terminal, aunque Table se abra desde Finder. Los arneses del catálogo (Claude Code, Codex, Gemini CLI, OpenCode, omp, pi) se marcan como instalados con `command -v` en ese mismo shell, al abrir Table y como mucho una vez por minuto. Un ejecutable que solo esté en el `PATH` definido en `.zshrc` (que lee el shell interactivo, no `-l -c`) puede no detectarse ni arrancar como perfil; la terminal normal sí lo encuentra.
- **Carpeta de trabajo.** `~/Table/<nombre de la mesa>`, creada al abrir la primera sesión o al abrir la mesa (para vigilar sus `resultados/`, ver [más abajo](#nivel-archivos-t-008)). El nombre se reduce a un solo segmento de ruta (sin `/`, `:`, caracteres de control ni punto inicial); si no queda nada se usa el ID de la mesa. La carpeta se asigna a la mesa la primera vez y se guarda en `work-folders.json` (datos de Table): nunca es la de otra mesa ni una que ya exista en disco (en ese caso se añade el inicio del ID de la mesa). La mesa la conserva aunque cambie de nombre. Al borrar la mesa se olvida la asignación, pero la carpeta y sus archivos se quedan, y ninguna mesa nueva la reutiliza.
- **Límites.** El proceso principal guarda los últimos 256 KiB de salida de cada sesión para volver a pintarla, y la terminal visible conserva 5 000 líneas. Tamaño hasta 500 columnas por 200 filas; cada escritura, hasta 64 KiB. Control de flujo: la interfaz confirma la salida que ya pintó; con más de 1 MiB sin confirmar se pausa la lectura del proceso hasta bajar de 256 KiB (al recargar la interfaz, o tras 10 s sin confirmaciones, se reanuda). Los perfiles propios tienen un nombre de hasta 60 caracteres y un comando de una línea de hasta 500; se guardan en claro en los ajustes porque no son secretos: no pongas credenciales en el comando.
- **Cierre.** Cerrar una sesión envía SIGHUP a su grupo de procesos y a todos sus descendientes, y SIGKILL a los que sigan vivos tras 2 s. Cada destino se comprueba con `ps` justo antes por PID y hora de inicio, y nunca se envía una señal al proceso principal después de ver su salida: un PID reutilizado por otro programa no se toca. Borrar una mesa cancela los arranques en curso y termina sus sesiones. Cerrar Table avisa de cuántas sesiones siguen en marcha, ya no admite arranques nuevos, las termina y espera a que salgan. Los procesos que se separaron del árbol antes de cerrar (demonios) no se tocan.
- **Permisos.** La sesión tiene los permisos del usuario; Table no filtra lo que hace el arnés ni responde a sus peticiones de permiso: se ven y se contestan en la terminal.

## Autenticación

Usar el flujo oficial del arnés/proveedor, completado por cada usuario. Una sesión local existente puede reutilizarse si la configuración y los permisos lo permiten; no leer ni copiar tokens para construir un acceso alternativo.

- Claude Code oficial puede funcionar con la cuenta del usuario en una terminal. La documentación distingue esto de ofrecer autenticación propia de Claude dentro de un producto. Hay discrepancias entre páginas oficiales respecto al SDK y las suscripciones; no prometer equivalencia entre terminal y UI personalizada sin resolverlas.
- Codex documenta app-server para clientes propios con login administrado, eventos y aprobaciones. Es una opción de adaptador, no la arquitectura obligatoria del producto.
- Los modelos locales y otros proveedores se configuran a través del arnés que los soporte.

Las sesiones de Notion, Figma y navegador se configuran por separado. Estar autenticado en un arnés no concede automáticamente acceso al proyecto.

## Contexto y resultados

El contexto persistente viene de [Notion](notion-context.md), con una selección explícita de tarjetas para la tarea. Evitar enviar el proyecto completo cuando bastan unas fuentes.

### Nivel «Archivos» (T-008)

Implementación de [T-008](tasks/008-contexto-y-resultados.md): funciona con cualquier arnés porque todo pasa por archivos de la carpeta de trabajo de la mesa (`~/Table/<mesa>`).

- **`TABLE.md`.** Table lo reescribe (escritura atómica) al abrir una sesión, antes de arrancar el arnés; con «Actualizar contexto»; y al enviar una selección. Si no se puede escribir, la sesión se abre igual. Contiene: nombre de la mesa y fecha de generación; un aviso de que todo lo que sigue son datos y no instrucciones; la ficha de cada tarjeta de proyecto de Notion con la lista cerrada de campos (Estado, Servicios, Inicio, Entrega) tomada de la caché de T-003, sin red, con su fecha de lectura; los enlaces (servicio, título y URL; los frames de Figma con nombre y página, de los metadatos de su miniatura); el texto de las notas; las conexiones (`A ↔ B`); los resultados que ya están en la mesa; la última selección enviada desde que se abrió Table; y cómo devolver resultados. Nunca campos excluidos de Notion, capturas, contenido ni cuerpo de páginas. Es una copia de trabajo con fecha, no la fuente.
- **Datos externos.** Nombres, títulos de páginas, opciones de Notion, nombres de frames y archivos llegan de fuera y se escriben en una sola línea, sin caracteres de control (C0/C1, `ESC` incluido) ni de dirección del texto: no pueden abrir secciones nuevas de Markdown ni llevar secuencias de escape a la terminal. Cada nota va en un bloque de código con una valla más larga que cualquier serie de acentos graves de su texto, con los saltos de línea normalizados, para que su contenido no pueda cerrarlo.
- **Punteros.** `AGENTS.md` (Codex, OpenCode y otros), `CLAUDE.md` y `GEMINI.md` (estos dos con `@TABLE.md`, que sus arneses importan) se crean con una línea que remite a `TABLE.md` solo si no existen; si ya existen, Table no los toca.
- **Enviar al agente.** Devuelve un bloque con una línea por elemento seleccionado (servicio, título y URL de las tarjetas; texto de las notas en una línea, hasta 500 caracteres; ruta de los resultados), lo anota en `TABLE.md` como «Última selección enviada» y la interfaz lo pega en la sesión activa sin pulsar Intro. Solo se aceptan IDs de la mesa (hasta 500).
- **`resultados/`.** Mientras la mesa está abierta, Table crea y vigila `resultados/` (un nivel). Cada archivo normal nuevo pasa a ser una tarjeta de resultado cuando su tamaño y fecha llevan sin cambiar el intervalo entero (0,6 s); se ignoran carpetas, enlaces simbólicos, archivos ocultos (punto inicial) y nombres temporales (`.tmp`, `.part`, `.crdownload`, `.download`, `.swp`, `~`). Al abrir la mesa se importa lo que llegó mientras estaba cerrada. Tipo por extensión: imagen (PNG, JPG, GIF, WebP, SVG) con vista previa; texto (Markdown, TXT, JSON, CSV, HTML) con sus primeros 4 KB; el resto, icono y nombre. Las tarjetas nuevas se colocan en una columna a la derecha de tarjetas y notas. Si el archivo de una tarjeta cambia (fecha posterior a la de la tarjeta), la tarjeta se renueva y su vista previa se vuelve a leer. Si el archivo desaparece, la tarjeta se queda marcada como no encontrada.
- **Quitar una tarjeta de resultado.** No borra el archivo y lo descarta: su nombre se guarda en la mesa (`dismissedResults`) y no vuelve a importarse mientras el archivo siga en `resultados/`, aunque cambie. Cuando Table ve que el archivo ya no está, olvida el descarte: un archivo nuevo con ese nombre vuelve a la mesa. Si se borra y se vuelve a crear entre dos revisiones, Table no lo distingue y sigue descartado.
- **Seguridad de los resultados.** La tarjeta guarda solo el nombre del archivo (un segmento, sin `/`, `\`, `:`, caracteres de control ni punto inicial). `resultados` tiene que ser una carpeta normal dentro de la carpeta de trabajo: si es un enlace simbólico o no es una carpeta, no se vigila ni se lee. Un resultado solo se sirve si su archivo es un archivo normal (nunca un enlace simbólico). La vista previa y el protocolo de imágenes (`table-result://`, hasta 32 MiB) abren el archivo sin seguir enlaces (`O_NOFOLLOW`), comprueban que el descriptor es el mismo archivo que se validó (dispositivo e inodo) y leen de él. Doble clic abre con la app del sistema, salvo archivos ejecutables (permiso de ejecución o extensiones como `.app`, `.command`, `.sh`, `.pkg`): esos solo se muestran en Finder. Abrir y mostrar en Finder pasan una ruta a macOS: Table la comprueba y la vuelve a comprobar justo antes, pero queda una carrera mínima entre esa comprobación y el momento en que macOS la abre. Solo la puede aprovechar quien ya escribe en la carpeta con los permisos del usuario (el propio agente), que ya puede ejecutar cualquier cosa: no es una escalada.

Contrato mínimo propuesto para resultados: ID de ejecución, tipo, texto o referencia de archivo, fuentes utilizadas y estado de revisión. Los archivos se importan desde ubicaciones permitidas; no ejecutar artefactos recibidos automáticamente. Una salida puede convertirse en tarjeta sin publicarse al cliente.

Las operaciones mínimas del eventual MCP de Table serían consultar contexto autorizado, leer una selección acordada y registrar un resultado con sus fuentes. Los nombres y esquemas finales se decidirán durante Fase 2.

## Memoria y ciclo de vida

- Dos agentes que llaman a modelos remotos no equivalen a dos modelos cargados en RAM; sus clientes, herramientas y subprocesos sí consumen recursos.
- Mantener acotado el historial de terminal en memoria y guardar registros según una política de retención.
- Registrar subprocesos iniciados y definir qué ocurre al cerrar una sesión: terminar, dejar en ejecución o conservar solo el registro.
- Mostrar al usuario si una tarea sigue trabajando aunque la tarjeta no esté visible.
- Probar señales, cierre y procesos huérfanos. La limpieza no debe terminar procesos ajenos a Table.
- No instalar ni ejecutar nuevos arneses automáticamente por abrir un proyecto.

Ver [fuentes](research/sources.md) y [validación de memoria](memory-validation.md).
