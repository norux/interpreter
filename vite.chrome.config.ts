import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL("./apps/chrome", import.meta.url)),
  base: "./",
  worker: { format: "es" },
  build: {
    outDir: "dist", emptyOutDir: true, target: "chrome116",
    rollupOptions: {
      input: { preparation: fileURLToPath(new URL("./apps/chrome/preparation.html", import.meta.url)),
        composition: fileURLToPath(new URL("./apps/chrome/composition.ts", import.meta.url)) },
      preserveEntrySignatures: "strict",
      output: { entryFileNames: "[name].js" },
    },
  },
});
