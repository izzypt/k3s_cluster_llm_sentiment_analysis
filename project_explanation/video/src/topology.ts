// The running system, drawn once and reused: zones (namespaces), pods and the allowed
// connections. Scenes pick which parts appear on which beat with `at`.

import { ArrowDef, BoxDef } from "./ui/Board";

export const TOPO_W = 1840;
export const TOPO_H = 760;

type At = Partial<Record<string, number>>;

export function topoBoxes(at: At = {}, def = 0): BoxDef[] {
  const a = (id: string) => at[id] ?? def;
  return [
    { id: "z_internet", kind: "zone", zone: "internet", label: "internet", x: 0, y: 24, w: 280, h: 306, at: a("z_internet") },
    { id: "bluesky", zone: "internet", label: "Bluesky API", sub: "api.bsky.app:443", x: 30, y: 128, w: 220, h: 100, at: a("bluesky") },
    { id: "z_ingestion", kind: "zone", zone: "ingestion", label: "skypulse-ingestion", x: 330, y: 24, w: 380, h: 306, sub: "may reach the internet", at: a("z_ingestion") },
    { id: "ingestor", zone: "ingestion", label: "ingestor", sub: "skypulse ingestor", x: 410, y: 128, w: 220, h: 100, at: a("ingestor") },
    { id: "z_data", kind: "zone", zone: "data", label: "skypulse-data", x: 760, y: 24, w: 560, h: 306, sub: "where the zones meet", at: a("z_data") },
    { id: "migrate", zone: "data", label: "migrate Job", sub: "skypulse migrate", x: 790, y: 64, w: 230, h: 92, at: a("migrate") },
    { id: "svc_rw", kind: "chip", zone: "data", label: "Service feeddb-rw", sub: "→ always the primary", x: 1060, y: 74, w: 236, h: 72, at: a("svc_rw") },
    { id: "pg1", zone: "data", label: "feeddb-1", sub: "PostgreSQL primary", x: 790, y: 196, w: 230, h: 100, at: a("pg1") },
    { id: "pg2", zone: "data", label: "feeddb-2", sub: "streaming replica", x: 1066, y: 196, w: 224, h: 100, at: a("pg2") },
    { id: "z_monitoring", kind: "zone", zone: "monitoring", label: "skypulse-monitoring", x: 1370, y: 24, w: 470, h: 306, sub: "reads metrics only", at: a("z_monitoring") },
    { id: "prometheus", zone: "monitoring", label: "Prometheus", sub: ":9090", x: 1400, y: 128, w: 200, h: 100, at: a("prometheus") },
    { id: "grafana", zone: "monitoring", label: "Grafana", sub: ":3000", x: 1630, y: 128, w: 180, h: 100, at: a("grafana") },
    { id: "z_lan", kind: "zone", zone: "lan", label: "analysts' LAN", x: 0, y: 400, w: 280, h: 356, at: a("z_lan") },
    { id: "browser", zone: "lan", label: "browser", sub: "static/index.html", x: 30, y: 520, w: 220, h: 100, at: a("browser") },
    { id: "z_kube", kind: "zone", zone: "platform", label: "kube-system", x: 330, y: 400, w: 380, h: 356, at: a("z_kube") },
    { id: "traefik", kind: "stack", zone: "platform", label: "traefik ×2", sub: "ingress controller", x: 380, y: 470, w: 280, h: 100, at: a("traefik") },
    { id: "coredns", zone: "platform", label: "coredns", sub: "cluster DNS :53", x: 380, y: 626, w: 280, h: 90, at: a("coredns") },
    { id: "z_analysis", kind: "zone", zone: "analysis", label: "skypulse-analysis", x: 760, y: 400, w: 1080, h: 356, sub: "local network only, no internet", at: a("z_analysis") },
    { id: "api", kind: "stack", zone: "analysis", label: "api ×2–5", sub: "skypulse api :8000", x: 800, y: 520, w: 250, h: 108, at: a("api") },
    { id: "analyzer", zone: "analysis", label: "analyzer", sub: "skypulse analyzer", x: 1170, y: 520, w: 250, h: 108, at: a("analyzer") },
    { id: "llm", zone: "analysis", label: "llm", sub: "Ollama :11434", x: 1550, y: 520, w: 250, h: 108, at: a("llm") },
  ];
}

export function topoArrows(at: At = {}, def = 0): ArrowDef[] {
  const a = (id: string) => at[id] ?? def;
  return [
    { id: "e_bsky", from: "ingestor", to: "bluesky", label: "HTTPS :443", zone: "ingestion", at: a("e_bsky") },
    { id: "e_ing_pg", from: "ingestor", to: "pg1", label: "5432 · ingestor", zone: "ingestion", at: a("e_ing_pg"), curve: -30, labelAt: 0.42 },
    { id: "e_mig_pg", from: "migrate", to: "pg1", label: "owner", zone: "data", at: a("e_mig_pg") },
    { id: "e_repl", from: "pg1", to: "pg2", zone: "data", dashed: true, at: a("e_repl") },
    { id: "e_browser", from: "browser", to: "traefik", label: "HTTP :8090", zone: "lan", at: a("e_browser"), curve: 20 },
    { id: "e_traefik_api", from: "traefik", to: "api", label: ":8000", zone: "platform", at: a("e_traefik_api") },
    { id: "e_api_pg", from: "api", to: "pg1", label: "5432 · analysis", zone: "analysis", at: a("e_api_pg"), labelAt: 0.74 },
    { id: "e_an_pg", from: "analyzer", to: "pg1", label: "5432 · analysis", zone: "analysis", at: a("e_an_pg"), labelAt: 0.3 },
    { id: "e_an_llm", from: "analyzer", to: "llm", label: "POST /api/chat", zone: "analysis", at: a("e_an_llm") },
    { id: "e_prom_pg", from: "prometheus", to: "pg2", label: ":9187 metrics", zone: "monitoring", at: a("e_prom_pg") },
    { id: "e_graf_prom", from: "grafana", to: "prometheus", zone: "monitoring", at: a("e_graf_prom") },
  ];
}
