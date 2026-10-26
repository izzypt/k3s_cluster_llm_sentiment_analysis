import React from "react";
import { Composition } from "remotion";
import { sceneFrames } from "./engine";
import { FPS, H, W } from "./theme";
import { CHAPTERS, ChapterVideo, framesOf, SceneVideo, SkyPulseVideo, totalFrames } from "./Video";
import { SCENES } from "./scenes/index";

const size = { fps: FPS, width: W, height: H };
const partId = (i: number) => `Part${i + 1}-${CHAPTERS[i].name.replace(/[^A-Za-z0-9]+/g, "-").replace(/-$/, "")}`;

// The narrated compositions get their length from the voice-over timings at load time
// (calculateMetadata), so the studio still opens before `npm run voice` has been run.
export const Root: React.FC = () => (
  <>
    <Composition id="SkyPulse" component={SkyPulseVideo} durationInFrames={totalFrames} {...size} />
    <Composition
      id="SkyPulse-Narrated"
      component={SkyPulseVideo}
      defaultProps={{ narrated: true }}
      durationInFrames={totalFrames}
      calculateMetadata={() => ({ durationInFrames: framesOf(SCENES, true) })}
      {...size}
    />
    {CHAPTERS.map((c, i) => (
      <React.Fragment key={c.name}>
        <Composition id={partId(i)} component={ChapterVideo} defaultProps={{ chapter: i + 1 }} durationInFrames={framesOf(c.scenes)} {...size} />
        <Composition
          id={`${partId(i)}-Narrated`}
          component={ChapterVideo}
          defaultProps={{ chapter: i + 1, narrated: true }}
          durationInFrames={framesOf(c.scenes)}
          calculateMetadata={() => ({ durationInFrames: framesOf(c.scenes, true) })}
          {...size}
        />
      </React.Fragment>
    ))}
    <Composition
      id="Scene"
      component={SceneVideo}
      defaultProps={{ id: SCENES[0].id, narrated: false }}
      durationInFrames={sceneFrames(SCENES[0])}
      calculateMetadata={({ props }) => ({ durationInFrames: sceneFrames(SCENES.find((s) => s.id === props.id) ?? SCENES[0], props.narrated) })}
      {...size}
    />
  </>
);
