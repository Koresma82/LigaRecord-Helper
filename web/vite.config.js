import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // O SDK do Firebase e maior do que a app toda. Separa-lo faz o
        // ecra de entrada aparecer sem esperar pelo Firestore.
        manualChunks: {
          'firebase-auth': ['firebase/app', 'firebase/auth'],
          'firebase-db': ['firebase/firestore'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
