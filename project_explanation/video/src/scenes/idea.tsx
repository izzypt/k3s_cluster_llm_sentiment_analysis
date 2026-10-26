import React from "react";
import { Appear, SceneDef } from "../engine";
import { BODY, C, MONO, SANS, ZONE } from "../theme";
import { topoArrows, topoBoxes, TOPO_H, TOPO_W } from "../topology";
import { Board } from "../ui/Board";
import { Table } from "../ui/Lists";
import { Rich } from "../ui/Rich";

const CH = "The idea";

const Title: React.FC = () => (
  <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "center", paddingLeft: 60, fontFamily: SANS }}>
    <Appear at={0} from="up">
      <div style={{ fontSize: 30, color: C.accent, fontFamily: MONO, fontWeight: 700, marginBottom: 18 }}>skypulse/ · a guided tour of the code</div>
    </Appear>
    <Appear at={0} delay={6} from="up">
      <div style={{ fontSize: 150, fontWeight: 800, letterSpacing: -4, color: C.text, lineHeight: 1 }}>
        Sky<span style={{ color: ZONE.analysis }}>Pulse</span>, explained
      </div>
    </Appear>
    <Appear at={0} delay={14} from="up">
      <div style={{ fontSize: 38, color: C.dim, marginTop: 30, maxWidth: 1500, lineHeight: 1.35 }}>
        <Rich text="From `make build` to a sentiment summary on an analyst's screen: every component, every connection, and the file and line of code behind each step." />
      </div>
    </Appear>
    <Appear at={1} from="up">
      <div style={{ display: "flex", gap: 18, marginTop: 56, flexWrap: "wrap", maxWidth: 1700 }}>
        {["Build", "Start", "Inside the cluster", "The journey", "Security boundary", "Resilience & day 2"].map((s, i) => (
          <div key={s} style={{ fontSize: 26, fontWeight: 600, color: C.text, border: `2px solid ${Object.values(ZONE)[i + 2]}`, borderRadius: 999, padding: "10px 26px", background: C.panel }}>{s}</div>
        ))}
      </div>
    </Appear>
  </div>
);

const Overview: React.FC = () => (
  <Board
    w={TOPO_W} h={TOPO_H} fitW={BODY.w} fitH={BODY.h}
    boxes={topoBoxes({
      z_lan: 0, browser: 0, z_internet: 0, bluesky: 0,
      z_analysis: 1,
      z_ingestion: 2, ingestor: 2,
      z_data: 3, migrate: 3, pg1: 3, pg2: 3, svc_rw: 3,
      api: 4, analyzer: 4, llm: 4,
      z_kube: 6, traefik: 6, coredns: 6,
      z_monitoring: 7, prometheus: 7, grafana: 7,
    })}
    arrows={topoArrows({
      e_bsky: 2, e_repl: 3, e_mig_pg: 3, e_an_llm: 4,
      e_ing_pg: 5, e_api_pg: 5, e_an_pg: 5,
      e_browser: 6, e_traefik_api: 6,
      e_prom_pg: 7, e_graf_prom: 7,
    })}
  />
);

const Repo: React.FC = () => (
  <div style={{ paddingTop: 10 }}>
    <Table
      w={BODY.w}
      cols={[{ label: "path in skypulse/", w: 30 }, { label: "what it is", w: 52 }, { label: "chapter", w: 18 }]}
      rows={[
        { at: 0, cells: ["`src/skypulse/`", "The Python application, ~900 lines: one program with four roles", "The journey"] },
        { at: 0, cells: ["`tests/`", "pytest unit tests (parsers, target validation, LLM answers)", "Build"] },
        { at: 1, cells: ["`pyproject.toml`, `uv.lock`", "The project and its exact, hashed dependency versions", "Build"] },
        { at: 1, cells: ["`docker/`", "`app.Dockerfile` (every Python role) and `llm.Dockerfile` (Ollama + model)", "Build"] },
        { at: 2, cells: ["`cluster/`", "The local k3d cluster and Traefik with two replicas", "Start"] },
        { at: 2, cells: ["`k8s/base/`", "Every Kubernetes object, grouped by zone, described once", "Inside the cluster"] },
        { at: 2, cells: ["`k8s/overlays/`", "What changes per environment: local, production", "Day 2"] },
        { at: 3, cells: ["`Makefile`", "The commands that drive everything: build, start, update, verify", "Start"] },
        { at: 3, cells: ["`scripts/`", "`setup.sh` installs the tools, `verify.sh` proves the boundary", "Security"] },
        { at: 3, cells: ["`deploy/argocd/`", "GitOps for a real site", "Day 2"] },
      ]}
    />
  </div>
);

export const IDEA: SceneDef[] = [
  {
    id: "title", chapter: CH, title: "SkyPulse, explained", layout: "full", View: Title,
    beats: [
      { say: "SkyPulse runs sentiment analysis on Bluesky, entirely on-premises, on Kubernetes. This video walks through **all of it**: how it is built, how it starts, and what every piece does at runtime." },
      { say: "Each step shows the real code that makes it happen. The excerpts are pulled from `skypulse/` by anchor text when the video is rendered, so they always match the repository." },
    ],
  },
  {
    id: "overview", chapter: CH, title: "Four zones, one meeting point", layout: "full", View: Overview,
    beats: [
      { say: "Analysts subscribe to Bluesky **handles** and **hashtags**. For each one, SkyPulse shows an LLM-written summary of recent sentiment, how many posts it covers and when it was updated.", hl: ["browser", "bluesky"] },
      { say: "One hard requirement shapes the whole design: the **analysis side must never reach the internet**, but something still has to fetch posts from Bluesky." },
      { say: "So the system is split into zones, one Kubernetes namespace each. `skypulse-ingestion` holds the **ingestor**, the only pod allowed out to the internet.", hl: ["ingestor"], flow: ["e_bsky"] },
      { say: "`skypulse-data` holds **PostgreSQL**: a primary and a streaming replica run by the CloudNativePG operator, plus the `migrate` Job that creates the schema.", hl: ["pg1", "pg2", "migrate"] },
      { say: "`skypulse-analysis` holds the **api** analysts use, the **analyzer** that classifies posts, and the **llm**: Ollama with a Gemma model baked into its image.", hl: ["api", "analyzer", "llm"] },
      { say: "The central idea: the roles **never call each other**. Each one only reads and writes rows in the database, so Postgres is the hub, and the only place the zones meet.", flow: ["e_ing_pg", "e_api_pg", "e_an_pg"] },
      { say: "Analysts come in through **Traefik**, the ingress controller in `kube-system`. `coredns` there resolves service names for every zone.", flow: ["e_browser", "e_traefik_api"] },
      { say: "`skypulse-monitoring` runs Prometheus and Grafana. They read **metrics only**: counters and timestamps, never the posts.", flow: ["e_prom_pg", "e_graf_prom"] },
      { say: "That's four zones with one meeting point. The rest of the video follows how this gets built, how it starts, and how each piece talks to the others." },
    ],
  },
  {
    id: "repo", chapter: CH, title: "The repository, by job", layout: "full", View: Repo,
    beats: [
      { say: "The code lives in `skypulse/`. `src/skypulse/` is the application: one Python program that can run as four different roles. `tests/` holds its unit tests." },
      { say: "`pyproject.toml` and `uv.lock` pin the dependencies; `docker/` turns the code into two images: one for every Python role, one for the LLM." },
      { say: "`cluster/` describes the local Kubernetes cluster. `k8s/base/` describes everything that runs on it, and `k8s/overlays/` holds what changes per environment." },
      { say: "The `Makefile` chains it all together, `scripts/` installs tools and proves the security boundary, and `deploy/argocd/` is GitOps for a real site." },
    ],
  },
];
