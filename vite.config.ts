import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwind()],
  build: { outDir: '../dist-web', emptyOutDir: true },
  server: {
    port: 3180,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3181' },
  },
});
