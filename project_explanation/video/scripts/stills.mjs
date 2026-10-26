// Renders one PNG per scene into out/stills/ for a quick visual review.
//   node scripts/stills.mjs [scene-id ...] [--at=0.75]
import path from "node:path";
import { bundle } from "@remotion/bundler";
import fs from "node:fs";
import { renderStill, selectComposition } from "@remotion/renderer";

const args = process.argv.slice(2);
const at = Number((args.find((a) => a.startsWith("--at=")) ?? "--at=0.75").slice(5));
let ids = args.filter((a) => !a.startsWith("--"));

const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
if (!ids.length) {
  // every scene, in file order
  for (const f of ["idea", "build", "start", "cluster", "journey", "security", "day2"])
    ids.push(...[...fs.readFileSync(`src/scenes/${f}.tsx`, "utf8").matchAll(/id: "([a-z0-9-]+)", chapter:/g)].map((m) => m[1]));
}
for (const id of ids) {
  const composition = await selectComposition({ serveUrl, id: "Scene", inputProps: { id } });
  const frame = Math.floor(composition.durationInFrames * at);
  await renderStill({ serveUrl, composition, inputProps: { id }, frame, output: `out/stills/${id}${args.some((a) => a.startsWith("--at=")) ? "@" + at : ""}.png` });
  console.log(`${id}: frame ${frame}/${composition.durationInFrames}`);
}
