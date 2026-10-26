# Tarea 003 · Ajustes y ficha de Notion por API

Estado: en curso desde el 2026-10-26. Fase: 1.

Aplica [D-012](../decisions.md) («el servicio reconocido añade capacidades») y el contrato de [contexto de Notion](../notion-context.md).

## Resultado esperado

Una persona del equipo guarda una vez el token de la integración de Notion y elige la base de proyectos en Ajustes. Desde entonces, una tarjeta de Notion cuya página es una ficha de esa base muestra en el lienzo los datos autorizados del proyecto, leídos por la API, con su fecha y origen. Sin conexión, muestra la última copia como caché fechada.

## Alcance

- **Ajustes** (configuración global, fuera de las mesas y de Git): botón en el carril lateral → diálogo.
  - Token de Notion guardado cifrado con el llavero del sistema (`safeStorage` de Electron, Keychain en macOS). Nunca se muestra entero, no se registra ni se envía al renderer.
  - «Comprobar conexión» lista las bases compartidas con la integración y se elige la de proyectos.
- **Ficha del proyecto**: una tarjeta de Notion se reconoce como ficha si su página pertenece a la base elegida. La tarjeta muestra la ficha en lugar de la captura; entrar sigue abriendo la web de Notion.
- **Lista de campos permitidos**, resuelta por nombre y tipo según el esquema comprobado: `Title`, `Status`, `Services`, `Start Date`, `Due Date`, `Remaining days`. Ausentes o de otro tipo se muestran como tales, sin inventar datos.
- **Caché fechada**: la última ficha leída se guarda en local (datos de usuario de Table, no en Git) con su fecha. Se actualiza al abrir la mesa y con «Actualizar». Si falla, se muestra la copia con su fecha y el motivo.

## Fuera de alcance

- Cuerpo de la página, páginas hijas y relaciones (`Account`, `Opportunity`): no se leen.
- Entregar contexto a agentes (Fase 2) y escribir en Notion.
- Campos configurables por el usuario (P-006): la lista es fija en esta tarea.
- Token de Figma: llega con [T-005](005-frames-figma.md).

## Decisiones dentro de la tarea

- `Leaders` queda fuera: leer nombres exige la capacidad de usuarios, no concedida. `Preview` queda fuera hasta decidir si sirve de miniatura.
- Versión de la API: `2022-06-28`, la del esquema comprobado.

## Criterios de aceptación

- [ ] Ajustes guarda, sustituye y borra el token de Notion; el archivo de ajustes no contiene el token en claro y el renderer nunca lo recibe.
- [ ] «Comprobar conexión» informa de token inválido, sin bases compartidas o la lista de bases, y permite elegir la de proyectos.
- [ ] Una tarjeta de una ficha de la base elegida muestra los campos permitidos, con fecha de lectura y origen; una página de Notion que no es ficha sigue como tarjeta web normal.
- [ ] Un fixture con `Budget`, `Opportunity`, `Lead`, `Notion Link`, `Account` y `Leaders` no saca ninguno de esos campos de la ficha (test).
- [ ] Sin conexión o con error, la tarjeta muestra la caché con su fecha y el motivo, sin declarar que está actualizada.
- [ ] Ni logs ni errores imprimen el token ni contenido de la ficha.
- [ ] Probado con la ficha real del piloto en el equipo del usuario.
