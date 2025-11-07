import { defineConfig } from "vite";
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
// import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
    define: {
        BUILD_DATE: JSON.stringify(new Date().toISOString()),
    },
    plugins: [
        tailwindcss()
    ],
    build: {
        rollupOptions: {
            input: {
                host: path.resolve(__dirname, 'index.html'),
                user: path.resolve(__dirname + "/m_src", 'index.html'),
            }
        }
    },
    // plugins: [
    //     basicSsl({
    //         // optional configuration: name, domains, certDir
    //     })
    // ],
    server: {
        // https: true,              // enable HTTPS
        host: '0.0.0.0',          // if you need network access
        port: 5173,
    }
});

