import { defineConfig } from "vite";
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
    define: {
        BUILD_DATE: JSON.stringify(new Date().toISOString())
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
    // }
});

