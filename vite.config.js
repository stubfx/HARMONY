import { defineConfig } from 'vite';
import tailwindcss      from '@tailwindcss/vite';
import path             from 'path';

export default defineConfig({
    define: {
        BUILD_DATE: JSON.stringify(new Date().toISOString()),
    },
    plugins: [tailwindcss()],
    build: {
        rollupOptions: {
            input: {
                main: path.resolve(__dirname, 'index.html'),
            },
        },
    },
    server: {
        host: '0.0.0.0',
        port: 5173,
        // Dev: proxy server endpoints to Express so Vite dev server works standalone.
        // In prod these are same-origin — no proxy needed.
        proxy: {
            '/uuid':              'http://localhost:3000',
            '/rndImage':          'http://localhost:3000',
            '/simulation-events': { target: 'http://localhost:3000', changeOrigin: true },
            '/n8n-sim-update':    'http://localhost:3000',
        },
    },
});
