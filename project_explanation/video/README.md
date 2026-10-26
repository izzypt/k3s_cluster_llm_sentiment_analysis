# SkyPulse, explained: the video

A ~29-minute narrated-by-captions walkthrough of the whole system, made with [Remotion](https://www.remotion.dev). Every scene pairs an animated diagram (zones, pods, packets travelling along the connections, sequence diagrams) with the **real code** that makes that step happen, with the lines the caption talks about highlighted.

| # | Part | Scenes |
|---|---|---|
| 1 | The idea | Title · four zones, one meeting point · the repository |
| 2 | Build | `make build` · `app.Dockerfile` · `llm.Dockerfile` (the model baked in) |
| 3 | Start | `make start` · the k3d cluster · operator, zones and logins · `make push` and the registry mirror · `make deploy` |
| 4 | Inside the cluster | Kustomize · controllers → pods · CloudNativePG · pod startup (args → `main()`, env → `Settings`, libpq) · the migrate Job |
| 5 | The journey | A request hop by hop · subscribe · ingest · Postgres as a work queue (`SKIP LOCKED`) · the LLM · summaries · reading it back · the whole timeline |
| 6 | Security boundary | S1/S2 on the map, with the blocked paths · NetworkPolicies · roles, hardened pods, `make verify` |
| 7 | Resilience & day 2 | When things break · `make update` with zero downtime · monitoring · production overlay and Argo CD |
| 8 | Recap | |

## How to run it

### What you need

- **Node.js 18 or newer** (tested with Node 24) and npm. Check with `node --version`.
- Nothing else: Remotion downloads its own headless Chrome and ships its own ffmpeg the first time it runs.
- The repository checked out as is: the video reads code from `../../skypulse/` and anchors from `../interactive-map/`.

### 1. Install (once)

```bash
cd project_explanation/video
npm install
```

### 2a. Watch it in the studio (no rendering needed)

```bash
npm run studio
```

This extracts the code snippets, then starts the Remotion studio and opens it in your browser (by default at <http://localhost:3000>). In the studio:

- Choose **`SkyPulse`** in the left sidebar for the whole video. Each part also has its own composition (`Part1-The-idea` … `Part8-Recap`).
- **Space** plays or pauses. **←/→** step one frame and **Shift+←/→** step one second. You can also drag the timeline to scrub.
- Choose **`Scene`** and change its `id` prop on the right (for example `queue`, `ingest` or `netpol`) to play a single scene. The scene ids are in `src/scenes/*.tsx`.

Press **Ctrl+C** in the terminal to stop the studio.

### 2b. Render the MP4

```bash
npm run render
```

The video is written to `out/skypulse-explained.mp4` (1920×1080, 30 fps, about 29 minutes, about 110 MB). It renders all ~52,700 frames, so expect it to take a while; on a typical laptop that's tens of minutes. The terminal shows the progress. Open the finished file in any video player. On Windows that's `start out\skypulse-explained.mp4`; on macOS, `open out/skypulse-explained.mp4`.

`out/` is gitignored, so you need to render the MP4 after a fresh clone.

### 2c. The narrated version (voice-over)

The same video with a voice reading every caption aloud, so you can listen instead of (or while) reading. The voice is made on your machine by [Kokoro](https://github.com/thewh1teagle/kokoro-onnx), an offline neural text-to-speech model; nothing is sent to an online service.

```bash
npm run voice              # make the voice-over (first run: also installs Kokoro)
npm run render:narrated    # → out/skypulse-explained-narrated.mp4
```

- **Extra requirement: Python 3.10 or newer** (`python --version`). The first `npm run voice` creates `.venv/` with Kokoro and downloads its model (~350 MB) into `tts-models/`. After that it takes a few minutes on a laptop CPU, and later runs only re-speak the captions that changed.
- In the studio, choose **`SkyPulse-Narrated`** (or `PartN-…-Narrated`, or `Scene` with `"narrated": true`).
- Each beat now lasts until its sentence has been spoken, plus a short pause, so the narrated video is longer than the captions-only one: about 38 minutes instead of 29. The visuals and captions are identical.
- Change the voice or speed with `npm run voice -- --voice bf_emma --speed 1.1` (voices: `am_michael` (default), `am_adam`, `af_heart`, `af_bella`, `bf_emma`, `bm_george`, …). `--only queue ingest` re-speaks just those scenes.
- The spoken text is the caption with the markup removed and code spelled out (`cluster/k3d.yaml` → "cluster slash K3D dot YAML"); the rules and the pronunciation list are in `scripts/narration.mjs`. If a caption still reads badly aloud, give that beat a `speak: "…"` with what to say instead.

### Render only a part, a scene or stills

```bash
npx remotion render Part5-The-journey out/part5.mp4                # one part
npx remotion render Scene out/queue.mp4 --props='{"id":"queue"}'   # one scene
node scripts/stills.mjs queue ingest                               # one PNG per scene in out/stills/
node scripts/stills.mjs --at=0.9                                   # every scene, 90% of the way through
```

Run `npm run snippets` once before using `npx remotion …` directly. `npm run studio` and `npm run render` already do this. On Windows PowerShell, write the props as `--props='{\"id\":\"queue\"}'`, or put them in a file and pass `--props=props.json`.

### If something goes wrong

| Symptom | Fix |
|---|---|
| `…: anchor not found after line …` when extracting snippets | The code in `skypulse/` changed. Update the anchor in `scripts/extract-snippets.mjs` (or in the Atlas's `src/snippets.mjs`) |
| `<scene> beat N: "…" not in snippet …` when loading | A highlighted line moved or was renamed. Update the `focus` string in that scene |
| `Cannot find module '../generated/snippets.json'` | Run `npm run snippets` first |
| Port 3000 is busy | `npx remotion studio --port=3001` |
| Render runs out of memory or is slow | Add `--concurrency=2` (or a higher number) to the render command |

## How it is built (and kept accurate)

| File | Role |
|---|---|
| `scripts/extract-snippets.mjs` | Pulls every code excerpt out of `skypulse/` **by anchor text**, reusing the Atlas's anchors (`../interactive-map/src/snippets.mjs`) plus a few of its own, highlights them and writes `src/generated/snippets.json`. Fails if an anchor disappears |
| `src/engine.tsx` | Scenes are lists of **beats**: a caption plus what changes on screen (`code`, `focus` lines, highlighted boxes `hl`, arrows carrying packets `flow`). Each beat lasts as long as its caption takes to read (narrated: or to say, if that's longer) |
| `scripts/narration.mjs`, `scripts/voice.py` | The voice-over: captions → spoken text → one WAV per beat in `public/voice/`, and their lengths in `src/generated/voice.json` |
| `src/ui/` | The visual vocabulary: `Board` (zones, boxes, animated arrows, blocked paths), `Sequence` (sequence diagrams), `Pipeline`, `Table`, `CodeCard`, and the frame around every scene |
| `src/topology.ts` | The running system drawn once, reused by the overview and the security scenes |
| `src/scenes/*.tsx` | The scenes, one file per part: diagrams and captions |

`npm run studio` and `npm run render` re-extract the snippets first. Loading the composition also checks that every highlighted line still exists in its snippet, so a code change that moves a line breaks loudly instead of highlighting the wrong thing. The captions are written by hand, so re-read the affected scenes when behaviour changes.
