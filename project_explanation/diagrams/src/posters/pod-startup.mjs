import { snip, code, page, stepRow, timeline, b } from "../lib.mjs";

export default {
  file: "05-pod-startup.png",
  render: () =>
    page({
      num: 5,
      title: "From a manifest to a running process",
      subtitle:
        "One image, four roles. What happens between <code>kubectl apply</code> and the first line of Python: " +
        "how a pod gets its role, its settings and its database login, and how Kubernetes checks it stays healthy.",
      body: `
<div class="row" style="margin-bottom:26px">
  <table class="t" style="flex:1">
    <tr><th>Role (<code>args</code>)</th><th>Kubernetes object</th><th>Namespace</th><th>Settings (ConfigMap)</th><th>Database login (Secret)</th><th>Code that runs</th></tr>
    <tr><td><span class="pill z-ana">api</span></td><td>Deployment + HPA 2–5</td><td>skypulse-analysis</td><td><code>analysis-config-&lt;hash&gt;</code></td><td><code>analysis</code> role</td><td><code>uvicorn → api.py:app</code></td></tr>
    <tr><td><span class="pill z-ana">analyzer</span></td><td>Deployment ×1</td><td>skypulse-analysis</td><td><code>analysis-config-&lt;hash&gt;</code></td><td><code>analysis</code> role</td><td><code>analyzer.run()</code></td></tr>
    <tr><td><span class="pill z-ing">ingestor</span></td><td>Deployment ×1</td><td>skypulse-ingestion</td><td><code>ingestor-config-&lt;hash&gt;</code></td><td><code>ingestor</code> role</td><td><code>ingestor.run()</code></td></tr>
    <tr><td><span class="pill z-data">migrate</span></td><td>Job (every deploy)</td><td>skypulse-data</td><td>none</td><td>owner (<code>feeddb-app</code> → <code>DATABASE_URL</code>)</td><td><code>db.migrate()</code></td></tr>
  </table>
</div>
${timeline([
  stepRow({
    n: 1, zone: "plat", title: "Kustomize renders the manifests",
    text: `<p><code>kubectl apply -k</code> builds the final YAML first. Each <code>config.env</code> file becomes a ConfigMap whose
      <b>name carries a hash of its content</b> ${b("A")}, and every reference to it is rewritten. Changing one setting therefore
      changes the pod template, and that triggers a rolling update.</p>
      <p>The overlay swaps the placeholder image name <code>skypulse-app</code> for the real registry path and tag ${b("B")}.</p>`,
    right: `<div class="grid2">${code(snip("k8s/base/kustomization.yaml", [{ at: "configMapGenerator:", n: 7 }], { marks: { "envs: [analysis/config.env]": "A" } }))}
      ${code(snip("k8s/overlays/local/kustomization.yaml", [{ at: "images:", n: 4 }], { marks: { "newName: localhost:5050/skypulse-app": "B" } }))}</div>`,
  }),
  stepRow({
    n: 2, zone: "ana", title: "The pod template says which role, which settings and which login",
    text: `<p><code>args</code> ${b("A")} picks the role. <code>envFrom</code> ${b("B")} turns every line of the ConfigMap into an
      environment variable (<code>PGHOST</code>, <code>LLM_URL</code>, …). <code>secretKeyRef</code> ${b("C")} adds the username and password
      of this zone's database role, and nothing else.</p>
      <p class="muted small">Same pattern in <code>analyzer.yaml</code> and <code>ingestor.yaml</code>; only the role, the ConfigMap and the Secret differ.</p>`,
    right: code(snip("k8s/base/analysis/api.yaml", [{ at: "- name: api", to: "key: password", toSame: false }], {
      marks: { 'args: ["api"]': "A", "configMapRef:": "B", "name: analysis-db-credentials": "C" },
    })),
  }),
  stepRow({
    n: 3, zone: "build", title: "The container starts: ENTRYPOINT + args",
    text: `<p>Kubernetes <code>args</code> replace the image's <code>CMD</code>; the <code>ENTRYPOINT</code> ${b("A")} stays. The process
      started is therefore <code>skypulse api</code>, <code>skypulse ingestor</code>, … as user 10001 ${b("B")}.</p>
      <p><code>skypulse</code> is found on <code>PATH</code> ${b("C")} inside the virtualenv that the build stage created.</p>`,
    right: code(snip("docker/app.Dockerfile", [{ at: "ENV PATH=/app/.venv/bin", to: 'CMD ["api"]' }], {
      marks: { 'ENTRYPOINT ["skypulse"]': "A", "USER 10001": "B", "ENV PATH=": "C" },
    })),
  }),
  stepRow({
    n: 4, zone: "build", title: "<code>skypulse</code> is a console script",
    text: `<p><code>uv sync</code> generated <code>/app/.venv/bin/skypulse</code> from this line. It imports
      <code>skypulse.__main__</code> and calls <code>main()</code>.</p>`,
    right: code(snip("pyproject.toml", [{ at: "[project.scripts]", n: 3 }])),
  }),
  stepRow({
    n: 5, zone: "ana", title: "Settings are read from the environment once, at import",
    text: `<p><code>__main__.py</code> imports <code>settings</code> first. Each field reads one variable, with a default for local runs.</p>
      <p>An empty <code>DATABASE_URL</code> ${b("A")} means "let libpq read <code>PGHOST</code>, <code>PGUSER</code>, <code>PGPASSWORD</code>…":
      the values from step 2. Only the migrate Job sets <code>DATABASE_URL</code> (the owner's URI).</p>`,
    right: code(snip("src/skypulse/config.py", [{ at: "class Settings:", n: 7 }, { at: "# Analyzer (local side)", n: 3 }, { at: "settings = Settings()", n: 1 }], {
      marks: { 'os.environ.get("DATABASE_URL", "")': "A" },
    })),
  }),
  stepRow({
    n: 6, zone: "ana", title: "<code>main()</code> parses the role and dispatches",
    text: `<p><code>argparse</code> reads <code>sys.argv[1]</code> ${b("A")}; a typo makes the pod exit with an error instead of running the wrong code.</p>
      <p>Each branch imports only its own module ${b("B")}: the ingestor never loads FastAPI, the api never loads the Bluesky client.</p>`,
    right: code(snip("src/skypulse/__main__.py", [{ at: "def main()", n: 4 }, { at: 'if args.role == "api":', to: "migrate()" }], {
      marks: { 'parser.add_argument("role"': "A", "from skypulse.ingestor import run": "B" },
    })),
  }),
  stepRow({
    n: 7, zone: "mon", title: "Kubernetes keeps checking the process",
    text: `<p><b>api</b>: <code>/readyz</code> ${b("A")} runs a query, so a pod only receives traffic once the database is reachable and migrated.
      <code>/healthz</code> ${b("B")} only proves the process answers: a database outage takes pods out of the Service but doesn't restart them.</p>
      <p><b>ingestor / analyzer</b> have no HTTP port. Every loop calls <code>db.heartbeat()</code>, which writes <code>/tmp/heartbeat</code> ${b("C")};
      the liveness probe restarts the container if that file is more than 10 minutes old.</p>`,
    right: `<div class="col">
      ${code(snip("src/skypulse/api.py", [{ at: '@app.get("/healthz")', n: 1 }, { at: "def healthz", n: 1 }, { at: '@app.get("/readyz")', to: 'return {"status": "ready"}' }], { marks: { '"/readyz"': "A", '"/healthz"': "B" } }))}
      <div class="col">
        ${code(snip("src/skypulse/db.py", [{ at: "def heartbeat()", to: "fh.write" }], { marks: { "open(settings.heartbeat_file": "C" } }))}
        ${code(snip("k8s/base/ingestion/ingestor.yaml", [{ at: "livenessProbe:", n: 7 }]))}
      </div></div>`,
  }),
])}`,
    }),
};
