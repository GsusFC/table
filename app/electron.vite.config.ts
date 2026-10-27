import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // Puente stdio del MCP de Table (T-011): lo arranca cada arnés con el ejecutable de Table en modo Node.
          mcpBridge: resolve(__dirname, 'src/main/agent/mcpBridge.ts'),
        },
      },
    },
  },
  preload: {},
  renderer: {},
})
