import { snip, code, page, flow, b } from "../lib.mjs";

export default {
  file: "02-build.png",
  render: () =>
    page({
      num: 2,
      title: "Build: from source code to two container images",
      subtitle:
        "<code>make build</code> checks the tools, installs the exact locked dependencies, runs the tests and builds two images: " +
        "one for every Python role, and one for the LLM server with the model already inside.",
      body: `
${flow(
  [
    { zone: "plat", title: "check-tools", sub: "scripts/setup.sh --check: make, docker, kubectl, k3d, uv" },
    { zone: "build", title: "uv sync --locked", sub: "exact versions from uv.lock into .venv" },
    { zone: "build", title: "uv run pytest -q", sub: "unit tests: target parsing, Bluesky + LLM parsers" },
    { zone: "ana", title: "docker build app", sub: "skypulse-app:&lt;git-sha&gt;-&lt;timestamp&gt;" },
    { zone: "llm", title: "docker build llm", sub: "only if this Ollama + model tag doesn't exist yet" },
    { zone: "plat", title: ".build/app-tag, llm-tag", sub: "what make push / deploy will use" },
  ],
  { labels: ["", "", "", "", ""] },
)}

<div class="row section">
  <div class="col" style="width:850px">
    <h2>The <code>build</code> target</h2>
    <p>Every step is a plain command you could type yourself. The app image gets a new tag every time ${b("A")}; the LLM image (several GB)
      is built only once per Ollama version + model ${b("B")}, then reused.</p>
    ${code(snip("Makefile", [{ at: "build: check-tools", to: "@echo \"Built" }], { marks: { "docker build -f docker/app.Dockerfile": "A", "if docker image inspect $(LLM_IMAGE):$(LLM_TAG)": "B" } }))}
    <h2 style="margin-top:12px">Tags say what's inside</h2>
    <p><b>App:</b> commit + build time ${b("C")}, unique per build, so every deploy is a real rolling update and you can trace a pod back to its commit.
      <b>LLM:</b> named after its content ${b("D")}, e.g. <code>0.35.1-gemma4-e2b-it-qat</code>.</p>
    ${code(snip("Makefile", [{ at: "APP_IMAGE := ", to: "NEW_APP_TAG := " }], { marks: { "LLM_TAG   :=": "D", "NEW_APP_TAG :=": "C" } }))}
  </div>
  <div class="col grow">
    <h2><span class="pill z-ana">image 1</span> <code>docker/app.Dockerfile</code>: one image, four roles</h2>
    <p><b>Build stage:</b> dependencies first ${b("A")}, so this slow layer is cached until <code>pyproject.toml</code> or <code>uv.lock</code> change;
      then our own code ${b("B")}, which rebuilds in seconds. <b>Runtime stage:</b> a fresh slim Python with only the finished virtualenv copied in ${b("C")}
      (no uv, no compilers), a fixed non-root user ${b("D")} and the <code>skypulse</code> entrypoint (see poster 5).</p>
    ${code(snip("docker/app.Dockerfile", [{ at: "FROM python:${PYTHON_VERSION}-slim-bookworm AS build", to: "uv sync --locked --no-dev --no-editable" }, { at: "# ---------- runtime stage", to: 'CMD ["api"]' }], {
      marks: { "uv sync --locked --no-dev --no-install-project": "A", "COPY src ./src": "B", "COPY --from=build /app/.venv /app/.venv": "C", "USER 10001": "D" },
    }))}
  </div>
</div>
<div class="section">
<div class="grid2">
      <div class="col">
        <h3><code>pyproject.toml</code> + <code>uv.lock</code></h3>
        <p class="small">The five runtime dependencies. <code>uv.lock</code> pins every one (and their dependencies) to an exact version and hash,
          so the image always contains the same code.</p>
        ${code(snip("pyproject.toml", [{ at: "dependencies = [", to: "psycopg-pool" }, { at: "]", n: 1 }]))}
      </div>
      <div class="col">
        <h3><span class="pill z-llm">image 2</span> <code>docker/llm.Dockerfile</code></h3>
        <p class="small">The analysis zone may never download anything, so the model is pulled <b>at build time</b> ${b("E")} and travels as an
          ordinary, versioned image. At runtime Ollama serves it from <code>/models</code> with no egress.</p>
        ${code(snip("docker/llm.Dockerfile", [{ at: "RUN ollama serve", n: 6 }], { marks: { 'ollama pull "${LLM_MODEL}"': "E" } }))}
      </div>
    </div>
</div>`,
    }),
};
