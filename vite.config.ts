import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  /*
   * The compression worker is created with `{ type: 'module' }`, so it must be BUILT as one.
   *
   * Vite's default worker format is `iife`, which cannot express a dynamic import and so
   * inlines it — that pulled the wasm WebP encoder's emscripten glue into the worker chunk,
   * making every admin download it whether or not their browser needs it. `es` keeps the
   * fallback encoder in its own chunk, fetched only where the native one does not work.
   */
  worker: { format: 'es' },
  // Fixture photos live outside src/ and are served in dev only. They are
  // gitignored and never part of a production build.
  publicDir: 'public',
  server: {
    fs: { allow: ['.'] },
  },
});
