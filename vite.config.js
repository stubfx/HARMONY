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
                user: path.resolve(__dirname + '/m_src', 'index.html'),
            },
        },
    },
    server: {
        host: '0.0.0.0',
        port: 5173,
        // In dev: proxy server endpoints so you don't need Caddy running.
        // When using Caddy (e.g. for iOS), Caddy handles the proxy instead.
        proxy: {
            '/socket.io': {
                target:      'http://localhost:3000',
                ws:          true,
                changeOrigin: true,
            },
            '/uuid':     'http://localhost:3000',
            '/rndImage': 'http://localhost:3000',
        },
    },
});
