# Tarea 005 · Páginas y frames de Figma

Estado: completada el 2026-10-26, salvo la prueba sin conexión, que pasa a [T-006](006-validacion-fase-1.md). Fase: 1.

## Resultado esperado

Desde una tarjeta de un archivo de Figma se eligen frames y aparecen en la mesa como tarjetas con miniatura. Entrar en una abre el editor del archivo en ese frame, sin cargar otro editor por cada frame.

## Decisiones del usuario (2026-10-26)

- **Token personal**, pegado una vez en Ajustes. Figma no permite conectar con un botón: su MCP oficial solo acepta clientes aprobados y rechazó el registro de Table (respuesta `Forbidden` del registro dinámico). La alternativa de botón (app OAuth propia con un servidor que guarde su clave) se descartó por las piezas que añade.
- Asiento **Full**: la API admite de 10 a 20 peticiones por minuto en las consultas de archivo e imágenes ([Figma, límites de la API](https://developers.figma.com/docs/rest-api/rate-limits/)).

## Alcance

- **Ajustes → Figma**: token (`figd_…`) comprobado con `/v1/me` antes de guardarlo, cifrado en el llavero; muestra el usuario y «Quitar», que borra también las miniaturas.
- **«Añadir frames…»** en el menú de una tarjeta de archivo (`/design/` o `/file/`): lista las páginas con sus frames de primer nivel (`FRAME`, `SECTION`, `COMPONENT`, `COMPONENT_SET`; una consulta `depth=2`) y crea las elegidas en cuadrícula a la derecha del archivo. Los frames que ya están en la mesa salen marcados.
- **Tarjeta de frame**: tarjeta web de Figma con `node-id`. Muestra la miniatura (una petición de imágenes por archivo y lote, reducida a JPEG de 640 px y guardada en local), el nombre del frame y su página. «Actualizar miniatura» en su menú.
- **Un editor por archivo**: entrar en un frame reutiliza el editor ya cargado del mismo archivo y lo lleva a ese frame; la tarjeta que lo tenía pasa a descargada. Si la página avisa de cambios sin guardar, no se navega ni se descarta nada.

## Criterios de aceptación

- [x] Elegir frames de un archivo y crear sus tarjetas con miniatura. *Smoke con una API de Figma falsa.*
- [x] Entrar en un frame abre el editor en ese nodo sin cargar un segundo editor del mismo archivo. *Smoke con páginas locales que simulan dos URL del mismo archivo; falta con Figma real.*
- [ ] Sin conexión o al llegar al límite, se muestra la miniatura guardada con su fecha y el motivo. *Por código: la miniatura solo se sustituye si la nueva llega bien, y el fallo se avisa. Se prueba en T-006.*
- [x] Ningún token ni miniatura de cliente en Git ni en logs.
- [x] Probado con un archivo real del usuario. *Token, «Añadir frames» con miniaturas y entrar en un frame con el editor del archivo: «fue perfecto».*

## Comprobaciones (2026-10-26)

- Tests de las claves de archivo y nodo en URLs de Figma (también hosts no permitidos).
- Smoke 47/47, con una API de Figma falsa y páginas locales: token rechazado y aceptado (cifrado, fuera del renderer), «Añadir frames» con miniaturas visibles, quitar el token borra las miniaturas, un frame reutiliza el editor del archivo, otro archivo carga el suyo, y si el editor avisa de cambios se queda en su frame sin preguntar; al volver a entrar, cede el editor.
- Revisión separada de Codex: 6 hallazgos (5 medios, 1 bajo), todos corregidos. El traspaso de editor solo se confirma si la navegación sigue adelante; una vista destruida tras un cierre fallido ya no queda registrada; quitar el token invalida las descargas en curso; la ayuda pide los dos permisos del token (`file_content:read` y `current_user:read`); las miniaturas se piden en lotes; dos lecturas seguidas de un archivo comparten la consulta.
- Arreglado de paso un fallo intermitente de T-002: si Chromium ignoraba un cierre pedido justo después de que la página lo frenara con `beforeunload`, la cola de webs se quedaba bloqueada. Ahora se vuelve a pedir y, sin respuesta tras 3 intentos, la web se da por conservada (nunca se descarta).
