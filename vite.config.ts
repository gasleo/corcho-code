import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // 127.0.0.1 y no localhost: en Windows, localhost resuelve a ::1 y a
      // 127.0.0.1 a la vez, y el proxy termina tirando ENOBUFS al reintentar
      // sobre la pila equivocada.
      '/api': 'http://127.0.0.1:5174',
    },
  },
});
