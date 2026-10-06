import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const extension = fileURLToPath(new URL("./extension", import.meta.url));

// Chrome executeScript needs a standalone classic script, even when views share core.
export default defineConfig({
  root: extension,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    copyPublicDir: false,
    target: "chrome116",
    lib: { entry: `${extension}/content.ts`, formats: ["iife"], name: "InterpreterCaptions", fileName: () => "content.js" },
  },
});
