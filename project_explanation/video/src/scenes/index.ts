import { SceneDef } from "../engine";
import { snippet } from "../ui/CodeCard";
import { BUILD } from "./build";
import { CLUSTER } from "./cluster";
import { DAY2 } from "./day2";
import { IDEA } from "./idea";
import { JOURNEY } from "./journey";
import { SECURITY } from "./security";
import { START } from "./start";

export const SCENES: SceneDef[] = [...IDEA, ...BUILD, ...START, ...CLUSTER, ...JOURNEY, ...SECURITY, ...DAY2];

// Fail fast (in the studio and before rendering) if a beat highlights a line that isn't in
// its snippet: the code moved, so the scene has to be re-read.
for (const s of SCENES) {
  let code: string | null | undefined;
  s.beats.forEach((b, i) => {
    if ("code" in b) code = b.code;
    if (!b.focus?.length) return;
    if (!code) throw new Error(`${s.id} beat ${i}: focus without code`);
    const lines = snippet(code).lines.flatMap((l) => ("text" in l ? [l.text] : []));
    for (const f of b.focus) if (!lines.some((t) => t.includes(f))) throw new Error(`${s.id} beat ${i}: ${JSON.stringify(f)} not in snippet ${code}`);
  });
}
