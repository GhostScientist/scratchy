import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // Offline app shell + installability. autoUpdate: a new service worker
    // activates on the next launch — never an update prompt mid-lesson. All
    // user data is IndexedDB/localStorage and untouched by the SW; the app
    // makes no post-load network requests, so precaching the built asset
    // graph is the whole story. devOptions stays off: the dev server (and
    // the default e2e suite) runs without any service worker.
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Scratchy Studio',
        short_name: 'Scratchy',
        description:
          'Local-first whiteboard teaching studio — draw, record, and export lessons entirely in the browser.',
        display: 'standalone',
        orientation: 'any',
        background_color: '#101114',
        theme_color: '#101114',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        // The compiled app is small; precache everything the build emits.
        // mjs covers the pdf.js worker chunk so PDF import works offline.
        globPatterns: ['**/*.{js,mjs,css,html,png,svg,webmanifest}'],
        // The pdf.js library + worker are ~1-2 MB each — above workbox's
        // 2 MiB default cap, and they must precache for offline import.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  // pdfjs-dist only loads via dynamic import on first PDF use; pre-bundle it
  // so dev doesn't discover it mid-import and force-reload the page.
  optimizeDeps: {
    include: ['pdfjs-dist/legacy/build/pdf.mjs'],
  },
  server: {
    host: true,
    port: 5173,
  },
});
