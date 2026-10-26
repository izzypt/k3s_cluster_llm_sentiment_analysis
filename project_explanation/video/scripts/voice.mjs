// npm run voice [-- --voice am_michael --speed 1.0 --only scene-id ...]
//
// Makes the voice-over: on first run it creates .venv/ with Kokoro (an offline neural
// text-to-speech model) and downloads the model into tts-models/ (~350 MB). Then it turns the
// captions into narration text (scripts/narration.mjs) and speaks every beat that changed
// (scripts/voice.py). Nothing is sent anywhere: the speech is generated on this machine.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VENV = path.join(ROOT, ".venv");
const PY = path.join(VENV, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const MODELS = path.join(ROOT, "tts-models");
const RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0";
const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit", cwd: ROOT });

if (!fs.existsSync(PY)) {
  console.log("Creating .venv with Kokoro…");
  run(process.platform === "win32" ? "python" : "python3", ["-m", "venv", VENV]);
  run(PY, ["-m", "pip", "install", "-q", "kokoro-onnx==0.6.1", "soundfile==0.14.0"]);
}
fs.mkdirSync(MODELS, { recursive: true });
for (const f of ["kokoro-v1.0.onnx", "voices-v1.0.bin"]) {
  const dest = path.join(MODELS, f);
  if (fs.existsSync(dest)) continue;
  console.log(`Downloading ${f}…`);
  const res = await fetch(`${RELEASE}/${f}`);
  if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
  fs.writeFileSync(dest + ".part", Buffer.from(await res.arrayBuffer()));
  fs.renameSync(dest + ".part", dest);
}

run(process.execPath, ["scripts/narration.mjs"]);
run(PY, ["scripts/voice.py", ...process.argv.slice(2)]);
