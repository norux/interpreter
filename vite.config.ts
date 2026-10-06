import { fileURLToPath } from "node:url";
import { build, defineConfig } from "vite";

const extension = fileURLToPath(new URL("./extension", import.meta.url));

export default defineConfig({
  root: extension,
  base: "./",
  plugins: [{
    name: "standalone-content",
    async writeBundle() {
      // Also runs on watch rebuilds; content remains in the graph for file watching.
      await build({ configFile: fileURLToPath(new URL("./vite.content.config.ts", import.meta.url)) });
    },
  }],
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
