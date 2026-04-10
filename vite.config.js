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
                host: path.resolve(__dirname, 'index.html'),
                user: path.resolve(__dirname + '/m_src', 'index.html'),
            },
        },
    },
    server: {
        host: '0.0.0.0',
        port: 5173,
        // HTTPS is handled by Caddy; Vite runs plain HTTP internally
    },
});
