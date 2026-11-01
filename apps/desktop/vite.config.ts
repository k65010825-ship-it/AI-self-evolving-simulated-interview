import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('./src/renderer', import.meta.url)), base: './',
  plugins: [react(), tailwindcss()],
  build: { outDir: fileURLToPath(new URL('./dist/renderer', import.meta.url)), emptyOutDir: false },
});
