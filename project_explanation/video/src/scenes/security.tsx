import React from "react";
import { SceneDef } from "../engine";
import { BODY, SPLIT } from "../theme";
import { topoArrows, topoBoxes, TOPO_H, TOPO_W } from "../topology";
import { ArrowDef, Board } from "../ui/Board";
import { Table } from "../ui/Lists";

const CH = "Security boundary";

const blocked = (from: number, to: number): ArrowDef[] => [
  { id: "b_api_inet", from: "api", to: "bluesky", blocked: true, curve: -150, at: from, until: from + 1, label: "api → internet" },
  { id: "b_an_inet", from: "analyzer", to: "bluesky", blocked: true, curve: -260, at: from, until: from + 1, label: "analyzer → 1.1.1.1" },
  { id: "b_api_llm", from: "api", to: "llm", blocked: true, curve: 250, at: from + 1, until: from + 2, label: "api → llm" },
  { id: "b_ing_api", from: "ingestor", to: "api", blocked: true, curve: 60, at: from + 2, until: from + 3, label: "ingestor → api" },
  { id: "b_ing_lan", from: "ingestor", to: "browser", blocked: true, curve: 40, at: from + 2, until: from + 3, label: "ingestor → LAN" },
  { id: "b_prom_sql", from: "prometheus", to: "pg1", blocked: true, curve: 130, at: from + 3, until: to, label: "prometheus → :5432" },
];

const Requirement: React.FC = () => (
  <Board
    w={TOPO_W} h={TOPO_H} fitW={BODY.w} fitH={BODY.h}
    boxes={topoBoxes()}
    arrows={[...topoArrows(), ...blocked(5, 9)]}
  />
);

const Policies: React.FC = () => (
  <div style={{ paddingTop: 4 }}>
    <Table
      w={SPLIT.visualW}
      size={0.84}
      cols={[{ label: "pod", w: 22 }, { label: "may receive", w: 38 }, { label: "may send", w: 40 }]}
      rows={[
        { at: 1, cells: ["every pod", "nothing (default-deny-all)", "DNS → coredns :53"], tone: "info" },
        { at: 2, cells: ["api", "Traefik, :8000", "Postgres :5432"] },
        { at: 3, cells: ["analyzer", "nothing", "Postgres :5432, llm :11434"] },
        { at: 4, cells: ["llm", "analyzer, :11434", "**nothing**"], tone: "bad" },
        { at: 6, cells: ["ingestor", "nothing", "Postgres; internet :443 except private ranges"], tone: "warn" },
        { at: 7, cells: ["postgres", "the 4 app pods :5432, replicas, operator; Prometheus :9187", "replicas, Kubernetes API"] },
      ]}
    />
  </div>
);

const Layers: React.FC = () => (
  <div style={{ paddingTop: 4 }}>
    <Table
      w={SPLIT.visualW}
      size={0.86}
      cols={[{ label: "layer", w: 30 }, { label: "what it stops", w: 70 }]}
      rows={[
        { at: 0, cells: ["1 · namespaces", "nothing by itself: the unit the others attach to"], tone: "info" },
        { at: 0, cells: ["2 · NetworkPolicies", "**where** a pod can connect"], tone: "info" },
        { at: 0, cells: ["3 · database roles", "**what** it can do once connected"], tone: "info" },
        { at: 1, cells: ["ingestor role", "can't read posts or summaries, delete, or change the schema"], tone: "ok" },
        { at: 2, cells: ["4 · restricted PSS", "pods that could run as root are rejected"], tone: "info" },
        { at: 3, cells: ["container settings", "no capabilities, no escalation, read-only root, seccomp, no token"], tone: "ok" },
        { at: 4, cells: ["`make verify`", "connections tried from inside the real pods"], tone: "warn" },
        { at: 6, cells: ["SQL checks", "`DELETE FROM subscriptions` / `DROP TABLE posts` → denied"], tone: "ok" },
      ]}
    />
  </div>
);

export const SECURITY: SceneDef[] = [
  {
    id: "boundary", chapter: CH, title: "S1 and S2, on the map", layout: "full", View: Requirement,
    beats: [
      { say: "The brief has two network requirements. **S1**: feed ingestion *may* connect to the internet. **S2**: the analysis application may *only* access the analysts' local network.", hl: ["ingestor", "api", "analyzer", "llm"] },
      { say: "Three design choices make that possible before a single policy is written. First, Postgres is the only meeting point, so there's no call between zones to allow.", flow: ["e_ing_pg", "e_api_pg", "e_an_pg"] },
      { say: "Second, the api validates handles and hashtags by shape only. Whether a handle exists is found later by the ingestor and reported through `last_error`.", hl: ["api", "ingestor"] },
      { say: "Third, the model is baked into the LLM image, so the `llm` pod needs **no egress at all**.", hl: ["llm"] },
      { say: "Then the cluster enforces it in layers. Here is the result: allowed paths in colour, and in red the paths that `make verify` proves are **closed**.", flow: ["e_bsky", "e_ing_pg", "e_api_pg", "e_an_pg", "e_an_llm", "e_traefik_api"] },
      { say: "Analysis to internet: blocked. Neither the api nor the analyzer can open a connection to `api.bsky.app` or `1.1.1.1`.", flow: ["b_api_inet", "b_an_inet"] },
      { say: "api to llm: blocked. The api doesn't need it, so it isn't allowed.", flow: ["b_api_llm"] },
      { say: "Ingestor to the api, to the llm or to anything on the LAN: blocked. The most exposed pod can't pivot inward.", flow: ["b_ing_api", "b_ing_lan"] },
      { say: "Prometheus to Postgres SQL: blocked. It reaches the metrics port, 9187, and nothing else.", flow: ["b_prom_sql", "e_prom_pg"] },
    ],
  },
  {
    id: "netpol", chapter: CH, title: "NetworkPolicies: allow-lists per pod", View: Policies,
    beats: [
      { say: "A NetworkPolicy selects pods and lists what they may receive and send. Once any policy selects a pod for a direction, everything not allowed in that direction is dropped.", code: "np_deny" },
      { say: "Every zone starts with `default-deny-all`, an empty `podSelector` meaning all pods, both directions. Then `allow-dns` to CoreDNS on port 53, or no pod could resolve a name.", focus: ["name: default-deny-all", "podSelector: {}", "name: allow-dns", "port: 53"] },
      { say: "Then one policy per workload opens exactly what it needs. The api: in from Traefik on 8000, out to Postgres on 5432.", code: "np_api", focus: ["port: 8000", "port: 5432"] },
      { say: "The analyzer: nothing in; out to Postgres, and to the `llm` on 11434.", code: "np_analyzer", focus: ["ingress: []", "port: 5432", "port: 11434"] },
      { say: "The llm: in from the analyzer only, and `egress: []`: it can't send anything, anywhere.", code: "np_llm", focus: ["app.kubernetes.io/name: analyzer", "egress: []"] },
      { say: "There's no `ipBlock` anywhere in the analysis zone. Every destination is a pod selected by label, so no rule can ever match an internet address." },
      { say: "The ingestor is the mirror image: out to Postgres, and to `0.0.0.0/0` on 443 **except** every private range. A compromised ingestor can't scan the LAN, the nodes or other pods.", code: "np_ingestor", focus: ["cidr: 0.0.0.0/0", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "port: 443"] },
      { say: "Postgres accepts 5432 only from the ingestor, api, analyzer and migrate pods, each matched by namespace **and** label in the same list item. Prometheus gets 9187 only.", code: "np_pg", focus: ["skypulse-ingestion", "app.kubernetes.io/name: api", "app.kubernetes.io/name: migrate", "port: 9187"] },
      { say: "Kubernetes only stores these objects: the network plugin enforces them. k3s ships an enforcing controller; on a cluster without one, every policy here would silently do nothing." },
    ],
  },
  {
    id: "layers", chapter: CH, title: "Roles, hardened pods, and `make verify`", View: Layers,
    beats: [
      { say: "Both zones reach the same Postgres, so the database roles are the third layer. NetworkPolicies decide **where** a pod connects; GRANTs decide **what** it can do there.", code: "db_grants", focus: ["_grant(conn"] },
      { say: "A compromised ingestor could still only read targets and insert posts. It can't read posts or summaries, delete anything, or change the schema.", focus: ["GRANT SELECT (id, kind, value)", "GRANT UPDATE (last_polled_at, last_error)", "GRANT INSERT ON posts"] },
      { say: "Layer four: every namespace enforces the `restricted` Pod Security level. Kubernetes rejects any pod that could run as root or escalate.", code: "k_namespaces", focus: ["pod-security.kubernetes.io/enforce: restricted"] },
      { say: "Each container drops all Linux capabilities, can't escalate, has a read-only root filesystem and the default seccomp profile, and gets no Kubernetes API token.", code: "k_migrate_full", focus: ["automountServiceAccountToken: false", "type: RuntimeDefault", "allowPrivilegeEscalation: false", "readOnlyRootFilesystem: true", 'drop: ["ALL"]'] },
      { say: "Then `make verify` runs `scripts/verify.sh`. Every check opens a **real connection from inside a real pod**, testing what the workload can do, not what the YAML seems to say.", code: "verify", focus: ["expect blocked \"api      -> internet", "expect blocked \"analyzer -> internet"] },
      { say: "Testing *blocked* matters as much as *allowed*: a policy that was never applied, or a cluster that doesn't enforce policies, passes every \"allowed\" check.", focus: ["expect allowed \"ingestor -> internet", "expect blocked \"ingestor -> api", "expect blocked \"ingestor -> llm"] },
      { say: "It also tries the forbidden SQL: the ingestor runs `DELETE FROM subscriptions`, the analysis role `DROP TABLE posts`. Both must fail. And `feeddb-app` must exist only in `skypulse-data`.", code: "verify_db", focus: ["DELETE FROM subscriptions", "DROP TABLE posts", "get secret feeddb-app"] },
      { say: "The known limits are written down in `DESIGN.md`: DNS is a theoretical side channel, both zones share one cluster, and there's no analyst login yet." },
    ],
  },
];
