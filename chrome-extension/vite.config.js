import { defineConfig } from "vite";
import { resolve } from "path";
import { cpSync } from "fs";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  // Static assets (manifest.json, icons/, blocked page) copied from public/ → dist/
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background/background.js"),
        popup: resolve(__dirname, "popup.html"),
        onboarding: resolve(__dirname, "onboarding.html"),
        "ollama-setup": resolve(__dirname, "ollama-setup.html"),
      },
      output: {
        // background.js stays flat (referenced by manifest); UI assets go in assets/
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === "background") return "background.js";
          return "assets/[name].js";
        },
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]",
        format: "es",
      },
    },
    minify: false,
    target: "chrome120",
  },
  plugins: [
    svelte(),
    {
      name: "copy-content-scripts",
      writeBundle() {
        // Copy YouTube Smart Lock content scripts into dist/
        cpSync(resolve(__dirname, "src/content"), resolve(__dirname, "dist"), {
          recursive: true,
        });
      },
    },
  ],
});
