import React from "react";
import { SceneDef } from "../engine";
import { BODY, SPLIT } from "../theme";
import { Board } from "../ui/Board";
import { Pipeline } from "../ui/Lists";

const CH = "Build";

const BuildPipeline: React.FC = () => (
  <div style={{ paddingTop: 8 }}>
    <Pipeline
      w={SPLIT.visualW}
      title="$ make build"
      steps={[
        { at: 0, label: "`./scripts/setup.sh`", sub: "once: install make, Docker, kubectl, k3d, uv" },
        { at: 1, label: "`check-tools` → `setup.sh --check`", sub: "check only, exit 1 if anything is missing" },
        { at: 2, label: "`pyproject.toml`: what the project needs", sub: "Python ≥ 3.12 + dependency ranges" },
        { at: 3, label: "`uv sync --locked` → `.venv/`", sub: "exactly what `uv.lock` lists, hashes checked" },
        { at: 4, label: "installs skypulse itself", sub: "`[project.scripts]` → `.venv/bin/skypulse`", indent: 1 },
        { at: 5, label: "`uv run pytest -q`", sub: "a failing test stops the build" },
        { at: 6, label: "`docker build` → `skypulse-app:<sha>-<time>`", sub: "every Python role, one image" },
        { at: 7, label: "`docker build` → `skypulse-llm:<ollama>-<model>`", sub: "only if that tag doesn't exist yet" },
        { at: 8, label: "tags → `.build/app-tag`, `.build/llm-tag`", sub: "read later by `make push` and `make deploy`" },
      ]}
      gap={10}
      size={0.92}
    />
  </div>
);

const AppImage: React.FC = () => (
  <Board
    w={860} h={758} fitW={SPLIT.visualW} fitH={BODY.h}
    boxes={[
      { id: "s1", kind: "zone", zone: "build", label: "stage 1 · build", x: 10, y: 30, w: 840, h: 320, at: 0 },
      { id: "base1", zone: "build", label: "python:3.12-slim", sub: "+ /bin/uv", x: 40, y: 90, w: 240, h: 100, at: 0 },
      { id: "deps", zone: "build", label: "dependencies", sub: "pyproject.toml + uv.lock", x: 310, y: 90, w: 240, h: 100, at: 1 },
      { id: "code", zone: "build", label: "skypulse itself", sub: "COPY src", x: 580, y: 90, w: 240, h: 100, at: 2 },
      { id: "n1", kind: "note", label: "cached until the lockfile changes", x: 300, y: 210, w: 270, h: 60, size: 0.85, at: 1, align: "center" },
      { id: "n2", kind: "note", label: "a code change rebuilds only this, in seconds", x: 570, y: 210, w: 270, h: 60, size: 0.85, at: 2, align: "center" },
      { id: "venv1", kind: "chip", zone: "build", label: "/app/.venv", x: 420, y: 280, w: 260, h: 52, at: 2 },
      { id: "s2", kind: "zone", zone: "analysis", label: "stage 2 · runtime (what ships)", x: 10, y: 420, w: 840, h: 320, at: 3 },
      { id: "base2", zone: "analysis", label: "python:3.12-slim", sub: "clean, no uv, no pytest", x: 40, y: 480, w: 240, h: 100, at: 3 },
      { id: "venv2", zone: "analysis", label: "/app/.venv", sub: "only the virtualenv", x: 310, y: 480, w: 240, h: 100, at: 3 },
      { id: "user", zone: "analysis", label: "USER 10001", sub: "never root", x: 580, y: 480, w: 240, h: 100, at: 4 },
      { id: "entry", zone: "analysis", label: "ENTRYPOINT skypulse · CMD api", sub: "container runs `skypulse api` by default", x: 140, y: 620, w: 580, h: 96, at: 5 },
    ]}
    arrows={[
      { id: "a1", from: "base1", to: "deps", zone: "build", at: 1 },
      { id: "a2", from: "deps", to: "code", zone: "build", at: 2 },
      { id: "a3", from: "venv1", to: "venv2", zone: "analysis", label: "COPY --from=build", at: 3 },
    ]}
  />
);

const LlmImage: React.FC = () => (
  <div style={{ paddingTop: 8 }}>
    <Pipeline
      w={SPLIT.visualW}
      title="docker/llm.Dockerfile"
      color="#38bdf8"
      steps={[
        { at: 0, label: "S2: the analysis zone has no internet", sub: "`llm` NetworkPolicy: `egress: []`" },
        { at: 0, label: "so the model can't be downloaded at runtime", indent: 1 },
        { at: 1, label: "`ollama` is only a client", sub: "the **server** downloads blobs into `/models`" },
        { at: 2, label: "one `RUN`, on the build machine:", sub: "it has internet; the cluster never needs it" },
        { at: 2, label: "`ollama serve &`   start a temporary server", indent: 1 },
        { at: 2, label: "`ollama list`   wait until it answers", indent: 1 },
        { at: 2, label: "`ollama pull gemma4:e2b-it-qat`", indent: 1 },
        { at: 2, label: "`kill $pid`   stop the server", indent: 1 },
        { at: 3, label: "the layer keeps only the files: `/models`", sub: "a process can't outlive its `RUN`" },
        { at: 4, label: "pod starts: `ollama serve` finds the model on disk", sub: "kept in memory for 24 h; no network needed" },
      ]}
      gap={9}
      size={0.9}
    />
  </div>
);

export const BUILD: SceneDef[] = [
  {
    id: "make-build", chapter: CH, title: "`make build`: from source to images", View: BuildPipeline,
    beats: [
      { say: "Before anything else, `scripts/setup.sh` checks the tools: make, Docker, kubectl, k3d and uv, plus a running Docker daemon with enough memory, and offers to install what's missing.", code: "setup_check", focus: ["--check"] },
      { say: "`make build` begins with `check-tools`, which runs `setup.sh --check`: check only, exit 1 if something is missing. No install prompt in the middle of a build.", code: "mk_build", focus: ["build: check-tools"] },
      { say: "`pyproject.toml` describes the project: Python 3.12 or newer, and dependency **ranges** like `fastapi>=0.115`. Ranges say what works, not what you get.", code: "pyproject", focus: ["requires-python", "dependencies = ["] },
      { say: "`uv.lock`, committed, pins those ranges to exact versions with sha256 hashes. `uv sync --locked` installs exactly that, and fails instead of silently re-resolving.", code: "mk_build", focus: ["uv sync --locked"] },
      { say: "`uv sync` also installs **skypulse itself**. The `[project.scripts]` entry becomes an executable, `.venv/bin/skypulse`, that calls `main()` in `__main__.py`.", code: "pyproject", focus: ["[project.scripts]", 'skypulse = "skypulse.__main__:main"'] },
      { say: "`uv run pytest -q` runs the unit tests against those same locked versions. If a test fails, the build stops and no image is made.", code: "mk_build", focus: ["uv run pytest -q"] },
      { say: "`docker build` packages the code as `skypulse-app`, tagged `<git sha>-<timestamp>`: every build is unique and traceable to a commit.", code: "mk_tags", focus: ["NEW_APP_TAG := "] },
      { say: "The LLM image is several GB and named after its content: Ollama version plus model. `make build` skips it when that tag already exists.", code: "mk_build", focus: ["docker image inspect", "already built, skipping"] },
      { say: "Last, the tags go to `.build/app-tag` and `.build/llm-tag`. `make push` and `make deploy` read them from there.", code: "mk_build", focus: ["$(BUILD_DIR)/app-tag", "$(BUILD_DIR)/llm-tag"] },
    ],
  },
  {
    id: "app-image", chapter: CH, title: "`app.Dockerfile`: one image, every Python role", View: AppImage,
    beats: [
      { say: "`docker/app.Dockerfile` is a two-stage build. The **build stage** starts from `python:3.12-slim` and copies the `uv` binary in.", code: "app_dockerfile", focus: ["AS build", "COPY --from=ghcr.io/astral-sh/uv"], hl: ["base1"] },
      { say: "It copies only `pyproject.toml` and `uv.lock` first, then installs the dependencies alone: that layer stays cached until the lockfile changes.", focus: ["COPY pyproject.toml uv.lock", "--no-install-project"], hl: ["deps"] },
      { say: "Then it copies `src/`, and a second `uv sync --no-editable` installs skypulse itself into `/app/.venv`. A code change rebuilds only this step.", focus: ["COPY src ./src", "--no-editable"], hl: ["code", "venv1"] },
      { say: "The **runtime stage** starts clean and copies only `/app/.venv`. uv, pytest and the build cache never ship.", focus: ["COPY --from=build /app/.venv"], hl: ["venv2"], flow: ["a3"] },
      { say: "It runs as a fixed non-root UID, 10001: the cluster's `restricted` Pod Security level rejects containers that could run as root.", focus: ["useradd --uid 10001", "USER 10001"], hl: ["user"] },
      { say: "`ENTRYPOINT [\"skypulse\"]` plus `CMD [\"api\"]`: by default the container runs `skypulse api`. Kubernetes will replace the `CMD` part to choose the role.", focus: ['ENTRYPOINT ["skypulse"]', 'CMD ["api"]'], hl: ["entry"] },
    ],
  },
  {
    id: "llm-image", chapter: CH, title: "`llm.Dockerfile`: the model baked in", View: LlmImage,
    beats: [
      { say: "Why bake the model into the image? The analysis zone has no internet, and the `llm` pod may send **nothing at all**. Downloading the model at startup would need an internet hole exactly there.", code: "llm_dockerfile", focus: ["FROM ollama/ollama", "ARG LLM_MODEL=", "ENV OLLAMA_MODELS=/models"] },
      { say: "So the build machine downloads it once, during `make build`. The catch: the `ollama` command is only a **client**, and it's the server that downloads.", focus: ['ollama pull "${LLM_MODEL}"'] },
      { say: "So one `RUN` starts a temporary server in the background, waits until `ollama list` answers, pulls the model, then kills the server.", focus: ["RUN ollama serve", "for i in $(seq 1 60)", "kill $pid"] },
      { say: "It has to be **one** `RUN`: each `RUN` is its own temporary container, so a background server never survives into the next. Only files stay, so the image keeps just the weights in `/models`.", focus: ["chmod -R a+rX /models", "rm -rf /root/.ollama"] },
      { say: "In the cluster, the image's own command, `ollama serve`, finds the model already on disk. `OLLAMA_KEEP_ALIVE=24h` keeps it loaded between requests.", focus: ["OLLAMA_HOST=0.0.0.0:11434", "OLLAMA_KEEP_ALIVE=24h"] },
    ],
  },
];
