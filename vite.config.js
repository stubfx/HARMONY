import { defineConfig } from "vite";

export default defineConfig({
    define: {
        BUILD_DATE: JSON.stringify(new Date().toISOString())
    },
    // build: {
    //   rollupOptions: {
    //     output: {
    //       assetFileNames: "[name][extname]", // disable hashing
    //     }
    //   }
    // }
});

