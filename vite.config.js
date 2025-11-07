import { defineConfig } from "vite";
import tailwindcss from '@tailwindcss/vite'
// import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
    define: {
        BUILD_DATE: JSON.stringify(new Date().toISOString()),
    },
    plugins: [
        tailwindcss()
    ],
    // build: {
    //   rollupOptions: {
    //     output: {
    //       assetFileNames: "[name][extname]", // disable hashing
    //     }
    //   }
    // },
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

