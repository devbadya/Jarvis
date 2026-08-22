import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { agentApi } from './tools/vite-plugin-agent-api.ts'

export default defineConfig({
  plugins: [react(), tailwindcss(), agentApi()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    // The ONNX runtime ships prebuilt wasm/worker assets that Vite must not pre-bundle.
    exclude: ['@huggingface/transformers'],
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
})
