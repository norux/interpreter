import { fileURLToPath } from "node:url";
import { copyFile } from "node:fs/promises";
import { build, defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL("./apps/chrome", import.meta.url)),
  base: "./",
  worker: { format: "es" },
  plugins: [{
    name: "chrome-selected-page-host",
    async writeBundle(options) {
      const outDir = options.dir;
      if (!outDir) throw new Error("Chrome build requires an output directory");
      await copyFile(fileURLToPath(new URL("./packages/media-web/pcm-worklet.js", import.meta.url)), `${outDir}/pcm-worklet.js`);
      await build({ configFile: false, logLevel: "warn", build: { outDir, emptyOutDir: false,
        lib: { entry: fileURLToPath(new URL("./apps/chrome/tab-content.ts", import.meta.url)), formats: ["iife"],
          name: "InterpreterTabOverlay", fileName: () => "tab-content.js" } } });
      await build({ configFile: false, root: fileURLToPath(new URL("./apps/chrome", import.meta.url)),
        logLevel: "warn", build: { outDir, emptyOutDir: false, copyPublicDir: false, target: "chrome138",
          lib: { entry: fileURLToPath(new URL("./apps/chrome/content.ts", import.meta.url)), formats: ["iife"],
            name: "InterpreterSelectedVideo", fileName: () => "content.js" } } });
    },
  }],
  build: {
    outDir: "dist", emptyOutDir: true, target: "chrome116",
    rollupOptions: {
      input: { preparation: fileURLToPath(new URL("./apps/chrome/preparation.html", import.meta.url)),
        "tab-host": fileURLToPath(new URL("./apps/chrome/tab-host.html", import.meta.url)),
        host: fileURLToPath(new URL("./apps/chrome/host.html", import.meta.url)),
        "service-worker": fileURLToPath(new URL("./apps/chrome/service-worker.ts", import.meta.url)),
        composition: fileURLToPath(new URL("./apps/chrome/composition.ts", import.meta.url)) },
      preserveEntrySignatures: "strict",
      output: { entryFileNames: "[name].js" },
    },
  },
});
