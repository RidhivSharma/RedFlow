import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {},
  preload: {
    build: {
      // Electron's sandboxed preloads cannot require relative chunks. Build
      // each preload as a standalone bundle so shared IPC code is inlined.
      isolatedEntries: true,
      externalizeDeps: false,
      rollupOptions: {
        input: {
          settings: resolve('src/preload/settings.ts'),
          recorder: resolve('src/preload/recorder.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          settings: resolve('src/renderer/settings/index.html'),
          recorder: resolve('src/renderer/recorder/index.html')
        }
      }
    }
  }
})
