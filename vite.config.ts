import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // Fixture photos live outside src/ and are served in dev only. They are
  // gitignored and never part of a production build.
  publicDir: 'public',
  server: {
    fs: { allow: ['.'] },
  },
});
