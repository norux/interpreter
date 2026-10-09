import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const directory = new URL("../apps/chrome/public/icons/", import.meta.url);
const svg = await readFile(new URL("jamak.svg", directory), "utf8");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>body{margin:0}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
    await page.screenshot({ path: fileURLToPath(new URL(`icon-${size}.png`, directory)), omitBackground: true });
  }
} finally {
  await browser.close();
}
