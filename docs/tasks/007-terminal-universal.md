# Tarea 007 · Terminal universal: sesiones de arnés

Estado: en curso desde el 2026-10-27; implementada, falta la prueba del usuario con los arneses reales. Fase: 2. Primera tarea de la fase ([D-018](../decisions.md)).

Aplica [terminal universal y arneses](../harnesses.md) y la propuesta P-004 (xterm.js + node-pty).

## Resultado esperado

Desde una mesa se abre una sesión con el arnés que elija la persona (Claude Code, Codex, Gemini CLI, OpenCode, omp, pi, una terminal normal u otro configurado) y se trabaja con él en un panel a la derecha del lienzo, viendo la mesa a la vez. La sesión se puede desacoplar como tarjeta flotante en el lienzo y volver al panel sin perder nada.

## Decisiones del usuario (2026-10-27)

- **Panel lateral derecho, con opción de desacoplarse como tarjeta** flotante en el lienzo («¿y si al panel lateral le añadimos la opción de ser flotante convirtiéndose en una card?»).
- **Arneses:** todos los instalados y los que se quieran añadir: «Claude Code, Codex, Gemini CLI y OpenCode, omp, pi… muchas posibilidades».

## Alcance

- **Perfiles de arnés**: catálogo con los conocidos (se ofrecen los que estén instalados, buscados con el `PATH` del shell de inicio de sesión) más una terminal normal; perfiles propios en Ajustes (nombre y comando).
- **Sesiones** con node-pty en el proceso principal, dentro del shell de inicio de sesión del usuario para tener su `PATH` y su autenticación. Inicio manual, nunca automático. Cada sesión pertenece a una mesa y trabaja en su carpeta.
- **Carpeta de trabajo por mesa**: propuesta `~/Table/<nombre de la mesa>`, creada al abrir la primera sesión; cambiarla queda para otra tarea.
- **Panel derecho**: plegable y redimensionable, con pestañas por sesión y «+» para abrir otra con un perfil. Muestra el estado (en marcha, terminada con su código).
- **Desacoplar**: la sesión pasa a una tarjeta flotante en el lienzo y vuelve al panel; es la misma terminal, sin reiniciar el proceso ni perder lo escrito. Las tarjetas de terminal no se guardan en la mesa: las sesiones no sobreviven a cerrar Table.
- **Cierre**: cerrar una sesión en marcha pide confirmación; cerrar Table avisa de las sesiones abiertas y termina sus procesos (y los hijos) sin dejar huérfanos.

## Fuera de alcance

- Entregar contexto de la mesa al agente (ficha filtrada, selección de tarjetas, MCP de Table) y registrar resultados como tarjetas: siguiente tarea.
- Reanudar conversaciones tras cerrar Table.
- Adaptadores específicos de un arnés.

## Límites que se documentan

- La sesión tiene los permisos del usuario: el arnés puede leer y escribir lo que el usuario puede. Table no filtra lo que hace ([harnesses](../harnesses.md)).
- Table no responde por el agente a sus peticiones de permiso: se ven y se contestan en la terminal.

## Criterios de aceptación

- [ ] Abrir una sesión de cada arnés instalado y de una terminal normal; escribir, redimensionar y ver la salida con colores.
- [ ] Varias sesiones a la vez en pestañas; cada una con su estado y código de salida al terminar.
- [ ] Desacoplar una sesión a tarjeta y devolverla al panel sin reiniciar el proceso ni perder la salida.
- [ ] Perfil propio añadido en Ajustes y usado para abrir una sesión.
- [ ] Cerrar una sesión en marcha pide confirmación; cerrar Table termina todos los procesos de las sesiones, sin huérfanos.
- [ ] La salida en memoria está acotada (historial limitado) y se mide el consumo con dos sesiones abiertas.
- [ ] Tests y smoke de punta a punta con una terminal normal (los arneses reales se prueban a mano).


## Comprobaciones (2026-10-27)

- Tests (166 en total): nombres de carpeta de trabajo, catálogo de perfiles, perfiles propios en Ajustes y gestor de sesiones con procesos reales (códigos de salida, historial acotado a 256 KiB, cerrar mata también los hijos, cerrar las sesiones de una mesa).
- Smoke 66/66: sesión de terminal por la API y por la interfaz (escribir con eventos reales y ver la salida), redimensionar, historial, cerrar sin dejar procesos (también un `sleep` en segundo plano), perfil propio, código de salida, carpeta de trabajo, sesiones de una mesa borrada, desacoplar a tarjeta y volver al panel con la misma sesión y su salida, el panel no se solapa con la web, confirmación al cerrar una pestaña en marcha y al salir de Table con sesiones abiertas.
- Detección: los seis arneses del catálogo están instalados en el equipo de referencia y se detectan con el `PATH` del shell de inicio de sesión. Las sesiones arrancan con `$SHELL -l -c`: un comando que solo está en el `PATH` de `.zshrc` no se detecta ni arranca desde un perfil (sí desde la terminal normal).
- Las sesiones no heredan las variables que `npm run` añade al arrancar Table en desarrollo (avisaban a nvm).
- Revisión separada de Codex: 5 hallazgos (2 altos, 3 medios), corregidos. Altos: dos mesas podían acabar en la misma carpeta de trabajo (ahora la asignación se guarda por mesa y nunca reutiliza una carpeta existente), y el cierre podía enviar señales a un PID reutilizado tras salir el proceso (ahora se identifica por PID y hora de inicio y no se señaliza tras la salida). Medios: un arranque en curso sobrevivía al cierre de su mesa; la salida rápida no tenía control de flujo (ahora se pausa el proceso por encima de 1 MiB sin pintar); el zoom del lienzo desplazaba los clics en la tarjeta de terminal (ahora la terminal se pinta sin escala).
- Tests 173; smoke 65/66 con la pantalla bloqueada (la comprobación que falla es la captura de una web de T-002, que necesita la pantalla desbloqueada; todas las de la terminal pasan).
- Prueba del usuario (2026-10-27): la sesión arranca con su cuenta y «se ve muy bien».
- Sin comprobar: cada uno de los demás arneses reales, desacoplar con el ratón real, arrastrar el borde del panel con el ratón, la pausa por salida masiva en uso real y la medición de memoria con dos sesiones.