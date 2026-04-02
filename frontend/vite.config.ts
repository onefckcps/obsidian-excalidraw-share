import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          // Excalidraw 0.17.6 loads fonts from two paths:
          // 1. Webpack chunks: {ASSET_PATH}/excalidraw-assets/Virgil.woff2
          // 2. CSS @font-face (SVG export): {ASSET_PATH}/Virgil.woff2
          // Copy to excalidraw-assets/ for webpack chunk loading (canvas rendering)
          src: 'node_modules/@excalidraw/excalidraw/dist/excalidraw-assets-dev/*.woff2',
          dest: 'excalidraw-assets'
        },
        {
          // Copy to root for CSS @font-face loading (SVG export)
          src: 'node_modules/@excalidraw/excalidraw/dist/excalidraw-assets-dev/*.woff2',
          dest: '.'
        }
      ]
    }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      workbox: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // Exclude Excalidraw font assets from precache (they're loaded on demand)
        globIgnores: ['excalidraw-assets/**', '*.woff2'],
        runtimeCaching: [
          {
            // Only cache public API routes — exclude authenticated endpoints
            // (/api/drawings, /api/upload, /api/collab/start, /api/collab/stop, /api/collab/sessions)
            urlPattern: /\/api\/(?:view|public|health|collab\/status)\/.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      },
      manifest: {
        name: 'ExcaliShare Viewer',
        short_name: 'ExcaliShare',
        description: 'Self-hosted Excalidraw Sharing Viewer',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ],
  base: '/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  server: {
    port: 5173,
  },
})
