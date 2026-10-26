import React from "react";
import { Audio, Sequence, Series, staticFile } from "remotion";
import { beatFramesOf, SceneDef, SceneProvider, sceneFrames } from "./engine";
import { ChapterInfo, SceneFrame } from "./ui/Frame";
import { SCENES } from "./scenes/index";

/** Chapters in order, with their scenes */
export const CHAPTERS: { name: string; scenes: SceneDef[] }[] = [];
for (const s of SCENES) {
  const last = CHAPTERS.at(-1);
  if (last && last.name === s.chapter) last.scenes.push(s);
  else CHAPTERS.push({ name: s.chapter, scenes: [s] });
}

export const framesOf = (scenes: SceneDef[], narrated = false) => scenes.reduce((n, s) => n + sceneFrames(s, narrated), 0);
export const totalFrames = framesOf(SCENES);

/** One voice-over clip per beat, starting with its caption. */
const Narration: React.FC<{ def: SceneDef }> = ({ def }) => {
  let from = 0;
  return (
    <>
      {beatFramesOf(def, true).map((len, i) => {
        const at = from;
        from += len;
        return (
          <Sequence key={i} from={at} durationInFrames={len} name={`voice ${i}`} layout="none">
            <Audio src={staticFile(`voice/${def.id}/${i}.wav`)} />
          </Sequence>
        );
      })}
    </>
  );
};

/** Plays `scenes`; the chapter bar always shows the whole video, so a part knows where it sits. */
export const Play: React.FC<{ scenes: SceneDef[]; narrated?: boolean }> = ({ scenes, narrated = false }) => {
  const offsets = new Map<string, number>();
  let acc = 0;
  for (const s of SCENES) {
    offsets.set(s.id, acc);
    acc += sceneFrames(s, narrated);
  }
  const total = acc;
  const chapters: ChapterInfo[] = CHAPTERS.map((c) => ({ name: c.name, frames: framesOf(c.scenes, narrated), start: offsets.get(c.scenes[0].id)! }));
  const num = (s: SceneDef) => CHAPTERS.findIndex((c) => c.name === s.chapter) + 1;
  return (
    <Series>
      {scenes.map((s) => (
        <Series.Sequence key={s.id} durationInFrames={sceneFrames(s, narrated)} name={`${num(s)} ${s.chapter} · ${s.id}`}>
          <SceneProvider def={s} narrated={narrated}>
            <SceneFrame def={s} num={num(s)} chapters={chapters} offset={offsets.get(s.id)!} total={total} frames={sceneFrames(s, narrated)} />
          </SceneProvider>
          {narrated && <Narration def={s} />}
        </Series.Sequence>
      ))}
    </Series>
  );
};

export const SkyPulseVideo: React.FC<{ narrated?: boolean }> = ({ narrated }) => <Play scenes={SCENES} narrated={narrated} />;

export const ChapterVideo: React.FC<{ chapter: number; narrated?: boolean }> = ({ chapter, narrated }) => <Play scenes={CHAPTERS[chapter - 1].scenes} narrated={narrated} />;

export const SceneVideo: React.FC<{ id: string; narrated?: boolean }> = ({ id, narrated }) => {
  const s = SCENES.find((x) => x.id === id);
  if (!s) throw new Error(`no scene ${id}; scenes: ${SCENES.map((x) => x.id).join(", ")}`);
  return <Play scenes={[s]} narrated={narrated} />;
};
