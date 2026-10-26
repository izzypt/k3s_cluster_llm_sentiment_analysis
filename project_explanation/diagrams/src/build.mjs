// Renders every poster to ../NN-name.png.
//
//   cd project_explanation/diagrams/src && npm install && node build.mjs [name-filter]
//
// Needs a Chromium: set CHROME_PATH, or it tries the usual install locations.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

import { findChrome } from "./lib.mjs";
import posters from "./posters/index.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "..");

const filter = process.argv[2];
const selected = posters.filter((p) => !filter || p.file.includes(filter));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skypulse-posters-"));

const browser = await puppeteer.launch({ executablePath: findChrome(), args: ["--no-sandbox"] });
try {
  for (const poster of selected) {
    const html = poster.render();
    const htmlPath = path.join(tmp, poster.file.replace(/\.png$/, ".html"));
    fs.writeFileSync(htmlPath, html);
    const tab = await browser.newPage();
    await tab.setViewport({ width: 1900, height: 1200, deviceScaleFactor: 1.5 });
    await tab.goto(`file://${htmlPath}`, { waitUntil: "load" });
    await tab.evaluate(() => document.fonts.ready);
    await tab.waitForFunction(() => document.body.dataset.ready === "1", { timeout: 30000 });
    const el = await tab.$("#poster");
    await el.screenshot({ path: path.join(OUT, poster.file) });
    const { height } = await el.boundingBox();
    console.log(`${poster.file}  (${Math.round(height)} px tall)`);
    await tab.close();
  }
} finally {
  await browser.close();
}
console.log(`HTML sources kept in ${tmp}`);
