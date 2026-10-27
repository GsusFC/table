# Tarea 010 · MCP de Figma, Notion y navegador para los agentes

Estado: en curso desde el 2026-10-27. Fase: 2. Aplica [D-019](../decisions.md).

## Resultado esperado

Al abrir una sesión, el agente ya tiene conectados los MCP que tocan: Figma (para ver y editar el diseño), un navegador con la sesión del usuario (para Pinterest y otras webs privadas) y, si la mesa lo permite, Notion sin filtro. Table los configura en cada arnés; cada arnés pide la autorización la primera vez con la cuenta de la persona. El panel muestra qué está conectado en la sesión.

## Alcance

- **Catálogo de MCP** en Table: Figma remoto (`https://mcp.figma.com/mcp`), Notion remoto (`https://mcp.notion.com/mcp`) y uno de navegador (por investigar: Chrome DevTools MCP con conexión al Chrome en uso, o Playwright MCP con su extensión; criterio: usa la sesión del navegador de la persona, pide permiso visible, mantenido por un proveedor serio).
- **Adaptador por arnés**, sin tocar su configuración global si se puede evitar: configuración por proyecto en la carpeta de la mesa o parámetros de arranque (`claude --mcp-config`, configuración de proyecto de Codex, `.gemini/settings.json`, `opencode.json`…; se investigan las versiones instaladas). Si un arnés no admite MCP o no se sabe configurar, el panel lo dice y la sesión funciona igual.
- **Notion por mesa**: ajuste de la mesa «Notion para el agente: archivos filtrados (por defecto) / MCP completo». Activar el MCP muestra un aviso claro de que el agente podrá leer presupuestos y oportunidades. Con archivos filtrados no se configura el MCP de Notion en esa sesión.
- **Estado en el panel**: por sesión, los MCP configurados y, si el arnés lo expone, si están autorizados; un enlace a cómo autorizarlos (por ejemplo `/mcp` en Claude Code).
- **`TABLE.md`**: dice qué MCP tiene la sesión y para qué usar cada uno (enlaces de Figma con `node-id`, URLs de Pinterest para el navegador).

## Fuera de alcance

- MCP propio de Table (selección, resultados con fuentes): tarea posterior.
- Copiar credenciales de Table al agente: nunca.

## Criterios de aceptación

- [ ] Claude Code y Codex arrancan con Figma y el navegador configurados sin que la persona edite nada; el resto de arneses, según admitan.
- [ ] Una mesa con «MCP completo» de Notion lo configura; una con «archivos filtrados», no. El aviso aparece al activarlo.
- [ ] La configuración de un arnés en otra carpeta o la global del usuario no cambia (o se documenta exactamente qué cambia y por qué).
- [ ] El panel muestra los MCP de cada sesión.
- [ ] Tests de los adaptadores (archivos y argumentos generados) y smoke con un arnés falso que registra su configuración.
- [ ] Probado por el usuario: el agente lee un frame de Figma y un tablero privado de Pinterest.
