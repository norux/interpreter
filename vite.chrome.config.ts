import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL("./apps/chrome", import.meta.url)),
  base: "./",
  worker: { format: "es" },
  build: {
    outDir: "dist", emptyOutDir: true, target: "chrome116",
    rollupOptions: { input: fileURLToPath(new URL("./apps/chrome/preparation.html", import.meta.url)) },
  },
});
