import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { agentApi } from './tools/vite-plugin-agent-api.ts'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    agentApi(),
    VitePWA({
      // Not 'autoUpdate': that reloads the tab the moment a new build is detected,
      // which would discard an in-flight conversation. A new version instead takes
      // over once every tab has been closed.
      registerType: 'prompt',
      manifest: {
        name: 'Jarvis — on-device AI chat',
        short_name: 'Jarvis',
        description:
          'A chat agent whose language model runs entirely on your own GPU. Works offline once the model is installed.',
        theme_color: '#0B1120',
        background_color: '#0B1120',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Deliberately no wasm: Transformers.js loads the ONNX runtime from its
        // own CDN, so the copy Vite emits into the bundle is never requested.
        // Our OPFS cache stores the runtime alongside the weights at install time,
        // which is what actually makes the app work offline.
        //
        // PNGs are omitted too: the plugin already precaches the manifest icons,
        // and globbing them as well produces duplicate precache entries.
        globPatterns: ['**/*.{js,css,html,svg}'],
        navigateFallback: 'index.html',
        // Model weights are managed by Transformers.js in its own cache; Workbox
        // must not try to take them over or clean them up.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname === 'huggingface.co' || url.hostname.endsWith('.hf.co'),
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
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
