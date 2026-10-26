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
- **Carpeta de trabajo.** `~/Table/<nombre de la mesa>`, creada al abrir la primera sesión. El nombre se reduce a un solo segmento de ruta (sin `/`, `:`, caracteres de control ni punto inicial); si no queda nada se usa el ID de la mesa. La carpeta se asigna a la mesa la primera vez y se guarda en `work-folders.json` (datos de Table): nunca es la de otra mesa ni una que ya exista en disco (en ese caso se añade el inicio del ID de la mesa). La mesa la conserva aunque cambie de nombre. Al borrar la mesa se olvida la asignación, pero la carpeta y sus archivos se quedan, y ninguna mesa nueva la reutiliza.
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
