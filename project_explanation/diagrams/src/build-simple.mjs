// Renders the simple diagrams (simple/diagrams.mjs) to ../simple/<file>.png.
//
//   cd project_explanation/diagrams/src && npm install && node build-simple.mjs [name-filter]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

import { esc, findChrome } from "./lib.mjs";
import diagrams from "./simple/diagrams.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "../simple");
const MERMAID = path.join(HERE, "node_modules/mermaid/dist/mermaid.min.js");

// Hand-drawn look (rough.js, as in Excalidraw) with a handwritten font; emoji fall back to the system emoji font.
const FONT = "'Patrick Hand', 'Comic Sans MS', 'Segoe UI Emoji', sans-serif";
const CONFIG = {
  startOnLoad: false,
  theme: "base",
  look: "handDrawn",
  handDrawnSeed: 7,
  fontFamily: FONT,
  themeVariables: {
    fontFamily: FONT,
    fontSize: "21px",
    primaryColor: "#ffffff",
    primaryBorderColor: "#4b5563",
    primaryTextColor: "#1d2230",
    lineColor: "#4b5563",
    clusterBkg: "#fafafa",
    clusterBorder: "#c4c8d0",
    edgeLabelBackground: "#ffffff",
    actorBkg: "#eceef1",
    actorBorder: "#4b5563",
    noteBkgColor: "#fff6d6",
    noteBorderColor: "#d9b54a",
  },
  flowchart: { useMaxWidth: false, wrappingWidth: 420, curve: "basis", padding: 18, nodeSpacing: 45, rankSpacing: 60 },
  sequence: { useMaxWidth: false, actorMargin: 130, messageFontSize: 17, noteFontSize: 16 },
  er: { useMaxWidth: false, fontSize: 16 },
};

const html = (code) => `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Patrick+Hand&display=block">
<style>html,body{margin:0;background:#fff} #wrap{display:inline-block;padding:28px;background:#fff}</style></head>
<body><div id="wrap"><pre class="mermaid">${esc(code)}</pre></div>
<script src="file://${MERMAID}"></script>
<script>mermaid.initialize(${JSON.stringify(CONFIG)});
document.fonts.load("21px 'Patrick Hand'").catch(() => {}).then(() => mermaid.run()).then(() => { document.body.dataset.ready = "1"; }, (e) => { document.body.dataset.ready = "error: " + e.message; });</script>
</body></html>`;

const filter = process.argv[2];
const selected = diagrams.filter((d) => !filter || d.file.includes(filter));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skypulse-simple-"));
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: findChrome(), args: ["--no-sandbox"] });
try {
  for (const d of selected) {
    const htmlPath = path.join(tmp, d.file.replace(/\.png$/, ".html"));
    fs.writeFileSync(htmlPath, html(d.code));
    const tab = await browser.newPage();
    await tab.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 });
    await tab.goto(`file://${htmlPath}`, { waitUntil: "load" });
    await tab.waitForFunction(() => document.body.dataset.ready, { timeout: 30000 });
    const state = await tab.evaluate(() => document.body.dataset.ready);
    if (state !== "1") throw new Error(`${d.file}: ${state}`);
    await (await tab.$("#wrap")).screenshot({ path: path.join(OUT, d.file) });
    console.log(d.file);
    await tab.close();
  }
} finally {
  await browser.close();
}
