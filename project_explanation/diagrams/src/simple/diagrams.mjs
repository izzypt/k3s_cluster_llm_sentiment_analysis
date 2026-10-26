// Simple diagrams for final_summary.md: one idea each, few boxes, large text, hand-drawn look.
// Same zone colours as the posters. Rendered to ../../simple/<file> by build-simple.mjs.
// Only flowcharts: Mermaid's hand-drawn look doesn't cover sequence or ER diagrams.

const ZONES = `
  classDef ana fill:#dbe8ff,stroke:#1f63d6,stroke-width:2.5px,color:#1d2230
  classDef ing fill:#ffe6c2,stroke:#c56a00,stroke-width:2.5px,color:#1d2230
  classDef data fill:#d3f2e3,stroke:#08875f,stroke-width:2.5px,color:#1d2230
  classDef mon fill:#eadcff,stroke:#7a3fe0,stroke-width:2.5px,color:#1d2230
  classDef llm fill:#d3f0f6,stroke:#0e7f99,stroke-width:2.5px,color:#1d2230
  classDef plat fill:#eceef1,stroke:#4b5563,stroke-width:2.5px,color:#1d2230
  classDef ext fill:#fff8d6,stroke:#8a7a2e,stroke-width:2.5px,color:#1d2230
  classDef bad fill:#ffdede,stroke:#c0392b,stroke-width:2.5px,color:#1d2230`;

const fc = (dir, body) => `flowchart ${dir}\n${ZONES}\n${body}`;

export default [
  {
    file: "01-core-idea.png",
    code: fc("LR", `
  api["🔌 <b>api</b><br/>writes subscriptions<br/>reads summaries"]:::ana
  ing["📥 <b>ingestor</b><br/>reads subscriptions<br/>writes posts"]:::ing
  an["🔍 <b>analyzer</b><br/>reads posts<br/>writes sentiment + summaries"]:::ana
  pg[("🐘 <b>PostgreSQL</b><br/>the only meeting point")]:::data
  api <--> pg
  ing <--> pg
  an <--> pg`),
  },
  {
    file: "02-map.png",
    code: fc("LR", `
  user(["👩‍💻 Analyst"]):::ext --> tr["🚦 Traefik<br/><i>kube-system</i>"]:::plat
  subgraph ANA["skypulse-analysis"]
    api["🔌 api"]:::ana
    an["🔍 analyzer"]:::ana
    llm["🧠 LLM"]:::llm
  end
  subgraph MON["skypulse-monitoring"]
    graf["📊 Grafana"]:::mon
    prom["🔥 Prometheus"]:::mon
  end
  subgraph DATA["skypulse-data"]
    pg[("🐘 PostgreSQL")]:::data
  end
  subgraph ING["skypulse-ingestion"]
    ing["📥 ingestor"]:::ing
  end
  tr --> api
  tr --> graf
  graf --> prom
  api --> pg
  an --> pg
  an --> llm
  prom -. metrics .-> pg
  ing --> pg
  tr ~~~ ing
  tr ~~~ an`),
  },
  {
    file: "03-zone-rules.png",
    code: fc("TB", `
  subgraph BUILD["How every zone is built"]
    direction LR
    a["⛔ <b>1 · default-deny-all</b><br/>nothing in, nothing out"]:::bad --> b["📖 <b>2 · allow-dns</b><br/>port 53 to CoreDNS"]:::plat --> c["✅ <b>3 · one policy per component</b><br/>exact peer + port"]:::data
  end
  subgraph ENF["Who enforces it"]
    direction LR
    np["📜 NetworkPolicy<br/>YAML"]:::plat --> ctl["🤖 k3s network policy controller<br/><i>kube-router, not Flannel</i>"]:::plat --> ipt["🧱 iptables + ipsets<br/>on every node"]:::plat
  end
  BUILD ~~~ ENF`),
  },
  {
    file: "04-getting-in.png",
    code: fc("TB", `
  b(["👩‍💻 Browser · localhost:8090"]):::ext -->|"TCP"| d["🐳 Docker port mapping · 8090 → 80"]:::plat
  d -->|"TCP"| lb["⚖️ k3d load balancer · nginx :80<br/><i>laptop stand-in for a real LB</i>"]:::plat
  lb -->|"TCP"| s["🔀 ServiceLB · node :80"]:::plat
  s -->|"TCP"| t["🚦 <b>Traefik</b> · first hop that reads HTTP"]:::plat
  rule[/"📜 Ingress rule: / → Service api"/]:::ana -. read by .-> t
  t -->|"HTTP, straight to the pod IP"| a["🔌 api pod :8000"]:::ana`),
  },
  {
    file: "05-traefik-ha.png",
    code: fc("TB", `
  hc["📝 <b>traefik-ha.yaml</b><br/>HelmChartConfig: overrides the bundled chart"]:::plat
  hc --> svc["🚦 Traefik Service"]:::plat
  subgraph PDB["🛡️ PDB · minAvailable: 1"]
    subgraph N1["🖥️ node 1"]
      t1["🚦 Traefik pod"]:::plat
    end
    subgraph N2["🖥️ node 2"]
      t2["🚦 Traefik pod"]:::plat
    end
  end
  svc --> t1
  svc --> t2`),
  },
  {
    file: "06-cnpg.png",
    code: fc("TB", `
  y["📝 <b>Cluster feeddb</b><br/>postgres.yaml"]:::data --> op["🤖 <b>CNPG operator</b><br/>cnpg-system"]:::plat
  op --> p1[("🐘 primary<br/>node A")]:::data
  op --> p2[("🐘 replica<br/>node B")]:::data
  op --> svc["🔀 Services<br/>feeddb-rw · ro · r"]:::data
  op --> sec["🔑 roles · TLS · Secret feeddb-app"]:::data
  p1 -- "streaming replication" --> p2
  svc -. "rw follows the primary,<br/>also after failover" .-> p1`),
  },
  {
    file: "07-analysis-zone.png",
    code: fc("LR", `
  tr["🚦 Traefik"]:::plat -->|":8000"| api
  subgraph ANA["skypulse-analysis · 🚫🌐"]
    api["🔌 api · 2–5 replicas"]:::ana
    an["🔍 analyzer"]:::ana
    llm["🧠 Ollama LLM<br/>no egress at all"]:::llm
  end
  subgraph DATA["skypulse-data"]
    pg[("🐘 PostgreSQL")]:::data
  end
  api -->|":5432"| pg
  an -->|":5432"| pg
  an -->|":11434"| llm`),
  },
  {
    file: "08-analyzer-loop.png",
    code: fc("TB", `
  s(["🔁 round starts"]):::plat --> c["🏷️ <b>classify up to 10 posts</b><br/>claim → LLM → validate → write"]:::ana
  c --> m["📝 <b>refresh stale summaries</b><br/>LLM writes two sentences"]:::ana
  m --> h["🧹 hourly: delete posts older than 14 days"]:::plat
  h --> q{"did any work?"}:::plat
  q -->|"yes: go again now 🏃"| s
  q -->|"no: sleep 5 s 😴"| s`),
  },
  {
    file: "09-skip-locked.png",
    code: fc("LR", `
  a1["🔍 analyzer A"]:::ana -->|"🔒 locks"| r1["📝 post 101<br/><i>newest</i>"]:::data
  a2["🔍 analyzer B"]:::ana -. "skips: locked" .-> r1
  a2 -->|"🔒 locks"| r2["📝 post 100"]:::data`),
  },
  {
    file: "10-ingestion-zone.png",
    code: fc("LR", `
  ing["📥 <b>ingestor</b><br/>every 60 s"]:::ing -->|"HTTPS 443"| bsky(["🦋 Bluesky public API"]):::ext
  ing -->|":5432 · insert posts"| pg[("🐘 PostgreSQL")]:::data
  ing -. blocked .-x lan(["🏠 LAN<br/>10/8 · 172.16/12 · 192.168/16"]):::bad
  ing -. blocked .-x meta(["☁️ cloud metadata<br/>169.254/16"]):::bad
  anyone(["🕵️ anyone"]):::bad -. "no inbound" .-x ing`),
  },
  {
    file: "11-data-model.png",
    code: fc("LR", `
  sub["🗂️ <b>subscriptions</b><br/>id · kind · value<br/>last_polled_at · last_error<br/><i>UNIQUE kind, value</i>"]:::data
  posts["📝 <b>posts</b> · the queue<br/>id · subscription_id · uri · text<br/>sentiment · score<br/>analyzed_at <i>NULL = queued</i>"]:::data
  sum["📋 <b>summaries</b> · precomputed<br/>subscription_id<br/>summary · overall<br/>item_count · updated_at"]:::data
  sub -->|"1 → many"| posts
  sub -->|"1 → 0 or 1"| sum`),
  },
  {
    file: "12-roles-setup.png",
    code: fc("LR", `
  s["🔑 <b>make secrets</b><br/>passwords into Secrets"]:::plat --> c["🤖 <b>CNPG</b><br/>creates the login roles"]:::plat
  c --> m["🛠️ <b>migrate Job</b><br/>CREATE TABLE, then GRANT"]:::data
  m --> ok["✅ ingestor · analysis<br/>column-level rights"]:::ana`),
  },
  {
    file: "13-migrate-job.png",
    code: fc("LR", `
  d["🚀 make deploy<br/>or Argo CD sync"]:::plat --> del["🗑️ delete the old Job"]:::plat
  del --> j["🛠️ <b>migrate Job</b><br/>skypulse migrate"]:::data
  j --> db["🐘 <b>db.migrate()</b><br/>lock → new migrations → GRANTs"]:::data
  db --> w["⏳ deploy waits for Complete"]:::plat`),
  },
  {
    file: "14-monitoring.png",
    code: fc("LR", `
  you(["👩‍💻 You"]):::ext -->|"grafana.localhost:8090"| g["📊 <b>Grafana</b><br/>stateless, from Git"]:::mon
  g --> p["🔥 <b>Prometheus</b><br/>every 30 s · 15 days"]:::mon
  p -->|":9187 · pipeline SQL + DB health"| pg[("🐘 PostgreSQL exporter")]:::data
  p -->|":9100 · rate, errors, latency"| tr["🚦 Traefik"]:::plat
  p -. "list pods only" .-> k["☸️ Kubernetes API"]:::plat`),
  },
  {
    // A comic strip: six panels, top to bottom.
    file: "15-journey.png",
    code: fc("TB", `
  s1["<b>1 · Request in</b> 👩‍💻<br/>browser → k3d LB → ServiceLB<br/>→ Traefik → api pod"]:::plat
  s2["<b>2 · Subscribe</b> 🔌<br/>api inserts the subscription<br/>answers 201 at once"]:::ana
  s3["<b>3 · Ingest</b> 📥<br/>every 60 s: fetch from Bluesky 🦋<br/>insert posts, unanalyzed"]:::ing
  s4["<b>4 · Analyze</b> 🔍<br/>claim a post 🔒 → LLM 🧠<br/>write sentiment + score"]:::ana
  s5["<b>5 · Summarize</b> 📝<br/>LLM writes two sentences<br/>upsert into summaries"]:::ana
  s6["<b>6 · Result out</b> 📊<br/>page refreshes every 10 s<br/>api reads the summary"]:::data
  s1 --> s2 --> s3 --> s4 --> s5 --> s6`),
  },
  {
    file: "16-delivery.png",
    code: fc("LR", `
  dev(["👩‍💻 git push"]):::ext --> ci["🏗️ <b>CI</b><br/>test + build"]:::plat
  ci -->|"push image"| reg[("📦 site registry")]:::plat
  ci -->|"commit new tag"| git[("🗃️ Git<br/>overlays/production")]:::plat
  git -->|"pulled by"| argo["🐙 <b>Argo CD</b><br/>inside the cluster"]:::plat
  argo -->|"syncs"| k8s["☸️ cluster"]:::ana
  reg -.->|"image pulled by"| k8s`),
  },
];
