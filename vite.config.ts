import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { CSP } from './csp';
import { opencvNoEval, opencvNoEvalEsbuild } from './build/opencvNoEval';
import { cspHeadersPlugin } from './build/cspHeaders';

export default defineConfig({
  plugins: [
    preact(),
    opencvNoEval(),
    cspHeadersPlugin(), // dist/_headers: CSP as a response header on hosts that read it
    VitePWA({
      registerType: 'autoUpdate',
      // External /registerSW.js: the CSP has no 'unsafe-inline', so no inline registration script.
      injectRegister: 'script',
      includeManifestIcons: false, // icons/*.png are already matched by globPatterns
      workbox: {
        // Take control of the page that installed the SW, so the first visit is already offline-ready.
        // No skipWaiting: a new SW waits until every tab of the old version is closed. Activating it
        // under open tabs would delete the old precache while those tabs still lazy-load their
        // (old-hash) chunks (cv.worker, pdf, tesseract), which would then 404. Updates apply on next launch.
        clientsClaim: true,
        // Everything the app needs offline: JS (incl. the CV worker chunk with OpenCV inlined), CSS,
        // HTML, icons, and the self-hosted Tesseract worker/cores/wasm/language data (.gz).
        globPatterns: ['**/*.{js,css,html,wasm,png,svg}', 'vendor/**/*'],
        // The CV worker chunk embeds OpenCV (~10 MB); stay well above it.
        maximumFileSizeToCacheInBytes: 15_000_000,
      },
      manifest: {
        name: 'Scanner',
        short_name: 'Scanner',
        description: 'Scan documents on your device. Nothing leaves your phone.',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        theme_color: '#1c1c1e',
        background_color: '#1c1c1e',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  worker: { format: 'es', plugins: () => [opencvNoEval()] },
  optimizeDeps: { esbuildOptions: { plugins: [opencvNoEvalEsbuild] } },
  server: { headers: { 'Content-Security-Policy': CSP } },
  preview: { headers: { 'Content-Security-Policy': CSP } },
});
