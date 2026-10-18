import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  // NO_HMR=1 gives a stable test server that never reloads under you
  server: { port: 5173, hmr: !process.env.NO_HMR },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        audioLab: resolve(import.meta.dirname, 'audio-lab.html'),
      },
    },
  },
});
