import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    // Output bundled files directly into chrome-extension/ (alongside popup.html, etc.)
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background.js"),
      },
      output: {
        // Single flat file per entry — no chunking for extension compatibility
        entryFileNames: "[name].js",
        format: "es",
      },
    },
    // Don't minify for easier debugging in extension dev
    minify: false,
    // Target modern Chrome (service workers support ES2022+)
    target: "chrome120",
  },
});
