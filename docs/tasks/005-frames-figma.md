# Tarea 005 · Páginas y frames de Figma

Estado: propuesta. Fase: 1. Requiere un token personal de Figma del usuario.

## Resultado esperado

Desde una tarjeta de un archivo de Figma se eligen páginas o frames y aparecen en la mesa como tarjetas ligeras con miniatura. Entrar en una abre el editor del archivo en ese frame, sin cargar otro editor por cada frame.

## Alcance

- Token personal de Figma en Ajustes (alcance `file_content:read`), cifrado como el de Notion ([T-003](003-ajustes-y-ficha-notion.md)).
- Listar páginas y frames de primer nivel del archivo (`GET /v1/files/:key?depth=2`).
- Tarjeta de frame: miniatura por API (`GET /v1/images/:key`), nombre y página; se guarda en local con su fecha.
- Entrar en un frame reutiliza el editor del archivo si ya está cargado y navega al nodo; si no, lo carga en ese nodo.

## Límite conocido

La API de Figma limita las peticiones de archivo e imágenes según el asiento del dueño del token: con asiento Full o Dev, de 10 a 20 por minuto según el plan; con View o Collab, unas 6 al mes ([Figma, límites de la API](https://developers.figma.com/docs/rest-api/rate-limits/)). Las miniaturas se cachean y se piden en lote, solo bajo demanda.

## Criterios de aceptación

- [ ] Elegir frames de un archivo y crear sus tarjetas con miniatura.
- [ ] Entrar en un frame abre el editor en ese nodo sin cargar un segundo editor del mismo archivo.
- [ ] Sin conexión o al llegar al límite, se muestra la miniatura cacheada con su fecha y el motivo.
- [ ] Ningún token ni miniatura de cliente en Git ni en logs.
