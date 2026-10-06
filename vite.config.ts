import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const extension = fileURLToPath(new URL("./extension", import.meta.url));

export default defineConfig({
  root: extension,
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome116",
    rollupOptions: {
      input: {
        popup: `${extension}/popup.html`,
        offscreen: `${extension}/offscreen.html`,
        transcript: `${extension}/transcript.html`,
        "service-worker": `${extension}/service-worker.ts`,
        content: `${extension}/content.ts`,
        worklet: `${extension}/worklet.ts`,
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
