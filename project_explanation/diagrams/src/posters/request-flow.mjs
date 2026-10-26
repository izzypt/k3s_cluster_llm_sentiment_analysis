import { snip, code, page, sequence, flow } from "../lib.mjs";

const LANES = [
  { id: "web", name: "Browser", sub: "static/index.html", zone: "ext" },
  { id: "tr", name: "Traefik", sub: "ingress controller · kube-system", zone: "plat" },
  { id: "api", name: "api", sub: "skypulse-analysis", zone: "ana" },
  { id: "pg", name: "PostgreSQL", sub: "feeddb-rw · skypulse-data", zone: "data" },
  { id: "an", name: "analyzer", sub: "skypulse-analysis", zone: "ana" },
  { id: "llm", name: "Ollama", sub: "llm pod · no egress", zone: "llm" },
  { id: "ing", name: "ingestor", sub: "skypulse-ingestion", zone: "ing" },
  { id: "bsky", name: "Bluesky", sub: "api.bsky.app", zone: "ext" },
];

const hops = flow(
  [
    { zone: "ext", title: "Browser", sub: "<code>http://localhost:8090</code>" },
    { zone: "plat", title: "k3d load balancer", sub: "<code>k3d-skypulse-serverlb</code> (nginx) <code>:80</code> · spreads connections over the nodes" },
    { zone: "plat", title: "ServiceLB on a node", sub: "<code>svclb-traefik</code> pod holds the node's <code>:80</code> → Traefik Service" },
    { zone: "plat", title: "Traefik pod", sub: "ingress controller: reads the HTTP request, applies the <b>Ingress rule</b>" },
    { zone: "ana", title: "api pod", sub: "<code>:8000</code>, reached directly by pod IP (EndpointSlices)" },
  ],
  { labels: ["Docker maps<br>8090 → 80", "TCP", "TCP", "HTTP<br><code>/</code> → <code>api</code>"] },
);

const ROWS = [
  {
    n: 1, zone: "plat", title: "Request in",
    text: `<p>The browser asks for <code>localhost:8090</code>. Docker hands it to the <b>k3d load balancer</b> on <code>:80</code>, which forwards it to <code>:80</code> on
      one of the k3s nodes, where <b>ServiceLB</b> passes it to the Traefik Service. Until here it is plain TCP. <b>Traefik</b>, the ingress controller, is the first
      hop that reads HTTP: it matches the <b>Ingress rule</b> (path <code>/</code> → Service <code>api</code>) and proxies straight to an api pod. The Ingress itself
      is only that rule; the api's NetworkPolicy accepts traffic from Traefik and nobody else.</p>`,
    items: [
      { from: "web", to: "tr", label: "GET / → k3d LB → node :80 (ServiceLB)" },
      { lane: "tr", note: "match Ingress rule: <code>/</code> → Service <code>api</code>" },
      { from: "tr", to: "api", label: "proxy to pod IP :8000" },
      { from: "api", to: "web", label: "index.html", reply: true },
    ],
  },
  {
    n: 2, zone: "ana", title: "Subscribe",
    text: `<p>The analyst types a <code>#hashtag</code> or <code>@handle</code>; the page sends <code>POST /api/subscriptions</code> (same path in, through Traefik).
      The api inserts one row into <code>subscriptions</code>, logged in to <code>feeddb-rw</code> over TLS as the least-privilege <code>analysis</code> role,
      and answers <code>201</code> at once. Nothing is fetched or analyzed during this request.</p>`,
    items: [
      { from: "web", to: "api", label: "POST /api/subscriptions (via Traefik)" },
      { from: "api", to: "pg", label: "INSERT subscriptions" },
      { from: "api", to: "web", label: "201 Created", reply: true },
    ],
  },
  {
    n: 3, zone: "ing", title: "Ingest",
    text: `<p>Every 60 s the <b>ingestor</b> reads <b>all</b> subscriptions, so the new one is picked up on the next round. It is the only workload allowed out,
      and only HTTPS (TCP 443) to public IPs. It calls the public Bluesky API: <code>getAuthorFeed</code> for a handle, <code>searchPosts</code> for a hashtag,
      up to 50 posts each. Posts are inserted with <code>ON CONFLICT DO NOTHING</code>, so overlapping polls add no duplicates, and start with
      <code>analyzed_at</code> NULL. It records <code>last_polled_at</code> / <code>last_error</code>; its DB role can basically only insert posts.</p>`,
    items: [
      { lane: "ing", note: "every 60 s" },
      { from: "ing", to: "pg", label: "SELECT all subscriptions" },
      { from: "ing", to: "bsky", label: "HTTPS :443 searchPosts / getAuthorFeed" },
      { from: "bsky", to: "ing", label: "≤ 50 posts", reply: true },
      { from: "ing", to: "pg", label: "INSERT posts ON CONFLICT DO NOTHING" },
      { from: "ing", to: "pg", label: "UPDATE last_polled_at, last_error" },
    ],
  },
  {
    n: 4, zone: "ana", title: "Analyze",
    text: `<p>The <b>analyzer</b>, a background <code>while True</code> loop, claims the newest post with <code>analyzed_at IS NULL</code> using
      <code>FOR UPDATE SKIP LOCKED</code>, so replicas never take the same post, and a crash rolls the claim back. It sends the text to the local
      <b>LLM</b> (Ollama, model baked into the image, no network egress) with a classification prompt, a JSON schema and <code>temperature: 0</code>.
      The LLM gives the judgement; the analyzer validates it and writes <code>sentiment</code>, <code>score</code>, <code>analyzed_at</code>.</p>`,
    items: [
      { from: "an", to: "pg", label: "claim: analyzed_at IS NULL FOR UPDATE SKIP LOCKED" },
      { from: "an", to: "llm", label: "/api/chat: prompt + JSON schema" },
      { from: "llm", to: "an", label: "{sentiment, score}", reply: true },
      { lane: "an", note: "validate and clamp the answer" },
      { from: "an", to: "pg", label: "UPDATE sentiment, score, analyzed_at · COMMIT" },
    ],
  },
  {
    n: 5, zone: "ana", title: "Summarize",
    text: `<p>When a subscription has newly analyzed posts, or its summary is older than 15 minutes, the analyzer takes up to 50 posts from the last 7 days,
      asks the LLM for a two-sentence summary, computes the counts and the overall label in Python, and upserts the row in <code>summaries</code>.
      An advisory lock stops two replicas from summarizing the same subscription.</p>`,
    items: [
      { from: "an", to: "pg", label: "stale summaries? + advisory lock" },
      { from: "an", to: "pg", label: "≤ 50 posts, last 7 days" },
      { from: "an", to: "llm", label: "summarize" },
      { from: "llm", to: "an", label: "two sentences", reply: true },
      { lane: "an", note: "counts + overall label in Python" },
      { from: "an", to: "pg", label: "UPSERT summaries" },
    ],
  },
  {
    n: 6, zone: "ana", title: "Result out",
    text: `<p>The page refreshes itself every 10 s: <code>GET /api/subscriptions</code> takes the same path in through Traefik. The api reads
      <code>subscriptions LEFT JOIN summaries</code> and returns the <b>precomputed</b> result. It never calls the LLM or Bluesky; a new subscription
      shows as pending (NULL summary) until steps 3–5 have run.</p>`,
    items: [
      { lane: "web", note: "setInterval: every 10 s" },
      { from: "web", to: "api", label: "GET /api/subscriptions (via Traefik)" },
      { from: "api", to: "pg", label: "subscriptions LEFT JOIN summaries" },
      { from: "api", to: "web", label: "JSON → cards", reply: true },
    ],
  },
];

export default {
  file: "12-request-flow.png",
  render: () =>
    page({
      num: 12,
      title: "The whole flow, from the browser and back",
      subtitle:
        "One page for the full story: how a request gets from localhost:8090 to an api pod, then the six steps from subscribing to a hashtag " +
        "to seeing its sentiment summary. The request path only ever touches PostgreSQL; everything slow happens in the background.",
      body: `
<h2>Getting in: every hop between the browser and the api</h2>
${hops}
<div class="grid3" style="margin-top:18px">
  ${code(snip("cluster/k3d.yaml", [{ at: "ports:", to: "- loadbalancer" }], { marks: { "8090:80": "A" }, title: "host 8090 → k3d LB :80" }))}
  ${code(snip("k8s/base/analysis/ingress.yaml", [{ at: "kind: Ingress", to: "name: http" }], { marks: { "ingressClassName": "B", "name: api": "C" }, title: "the rule Traefik applies" }))}
  <div class="col">
    <div class="callout z-plat"><b>Ingress ≠ ingress controller.</b> The Ingress is YAML in etcd: a rule. Traefik watches those rules and does the proxying.
      Without a controller, an Ingress does nothing.</div>
    <div class="callout z-plat"><b>Only the k3d LB is laptop-specific.</b> It stands in for the external load balancer (HAProxy, F5, a keepalived VIP) that
      would sit in front of real servers. On-prem, MetalLB can replace ServiceLB; Traefik and the api stay the same.</div>
  </div>
</div>

<div class="section">
  <h2>The six steps</h2>
  ${sequence({ lanes: LANES, rows: ROWS, laneWidth: 122 })}
</div>

<div class="grid2 section">
  <div class="callout z-data"><b>PostgreSQL is the only meeting point.</b> Ingestion and analysis never talk to each other: every step only reads and writes
    the database, on its own schedule. So the internet, the ingestor, the LLM or the analyzer can each be down, and analysts still get the last known summaries.</div>
  <div class="callout z-ana"><b>Precomputed, not computed on request.</b> CPU inference takes seconds and the internet is unreliable, so neither sits on the
    analyst's request path. The cost is freshness: a summary can be up to about 15 minutes old.</div>
</div>`,
    }),
};
