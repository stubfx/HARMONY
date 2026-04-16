import { defineConfig } from 'vite';
import tailwindcss      from '@tailwindcss/vite';
import path             from 'path';

export default defineConfig({
    // MPA mode: disables Vite's SPA catch-all so each HTML file is served at
    // its own path (/remote/ → remote/index.html, / → index.html).
    appType: 'mpa',
    define: {
        BUILD_DATE: JSON.stringify(new Date().toISOString()),
    },
    plugins: [tailwindcss()],
    build: {
        rollupOptions: {
            input: {
                main:   path.resolve(__dirname, 'index.html'),
                remote: path.resolve(__dirname, 'remote/index.html'),
                admin:  path.resolve(__dirname, 'admin/index.html'),
            },
        },
    },
    server: {
        host: '0.0.0.0',
        port: 5173,
        // Dev: proxy server endpoints to Express so Vite dev server works standalone.
        // In prod these are same-origin — no proxy needed.
        proxy: {
            // Socket.IO connects directly to Express (no proxy) — see sim.js / remote/main.js.
            '/rndImage':       'http://localhost:3000',
            '/n8n-sim-update': 'http://localhost:3000',
            '/admin-auth':     'http://localhost:3000',
        },
    },
});
