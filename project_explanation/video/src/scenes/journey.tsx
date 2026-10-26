import React from "react";
import { SceneDef } from "../engine";
import { BODY, SPLIT } from "../theme";
import { Board } from "../ui/Board";
import { Pipeline, Table } from "../ui/Lists";
import { Participant, Sequence } from "../ui/Sequence";

const CH = "The journey";
const fit = { w: 860, h: 758, fitW: SPLIT.visualW, fitH: BODY.h };
const SEQ = { w: SPLIT.visualW, h: BODY.h };

const RequestPath: React.FC = () => {
  const col = (i: number) => 24 + i * 104;
  return (
    <Board
      {...fit}
      boxes={[
        { id: "b", zone: "lan", label: "browser", sub: "http://localhost:8090", x: 170, y: col(0), w: 520, h: 84, at: 0 },
        { id: "lb", zone: "lan", label: "k3d-skypulse-serverlb", sub: "nginx container · :8090 → any node :80", x: 170, y: col(1), w: 520, h: 84, at: 0 },
        { id: "svclb", zone: "platform", label: "svclb-traefik pod (every node)", sub: "hostPort 80 → iptables → Service traefik", x: 170, y: col(2), w: 520, h: 84, at: 1 },
        { id: "tr", kind: "stack", zone: "platform", label: "traefik (1 of 2)", sub: "reads Ingress skypulse: / → Service api", x: 170, y: col(3), w: 520, h: 84, at: 2 },
        { id: "svc", zone: "analysis", label: "Service api", sub: "picks one ready pod", x: 170, y: col(4), w: 520, h: 84, at: 3 },
        { id: "api", kind: "stack", zone: "analysis", label: "api pod :8000", sub: "FastAPI → static/index.html", x: 170, y: col(5), w: 520, h: 84, at: 3 },
        { id: "np", kind: "note", label: "NetworkPolicy: **only Traefik** may connect here", x: 170, y: col(6) + 4, w: 520, h: 60, at: 3, align: "center", size: 0.85 },
      ]}
      arrows={[
        { id: "1", from: "b", to: "lb", zone: "lan", at: 0 },
        { id: "2", from: "lb", to: "svclb", zone: "lan", at: 1 },
        { id: "3", from: "svclb", to: "tr", zone: "platform", at: 2 },
        { id: "4", from: "tr", to: "svc", zone: "platform", at: 3 },
        { id: "5", from: "svc", to: "api", zone: "analysis", at: 3 },
      ]}
    />
  );
};

const P_SUB: Participant[] = [
  { id: "web", label: "browser", sub: "index.html", zone: "lan" },
  { id: "api", label: "api", sub: "api.py", zone: "analysis" },
  { id: "tg", label: "targets.py", sub: "parse_target", zone: "analysis" },
  { id: "pg", label: "PostgreSQL", sub: "feeddb-rw", zone: "data" },
];

const Subscribe: React.FC = () => (
  <Sequence
    {...SEQ}
    parts={P_SUB}
    msgs={[
      { at: 0, from: "web", to: "api", label: "POST /api/subscriptions" },
      { at: 1, from: "api", label: "pydantic: SubscriptionIn" },
      { at: 2, from: "api", to: "tg", label: "parse_target(\"#Kubernetes\")" },
      { at: 2, from: "tg", to: "api", label: "Target(hashtag, kubernetes)", ret: true },
      { at: 3, from: "tg", label: "shape only: no internet", note: true },
      { at: 4, from: "api", to: "pg", label: "INSERT … ON CONFLICT" },
      { at: 4, from: "pg", to: "api", label: "RETURNING id", ret: true },
      { at: 5, from: "api", to: "web", label: "201 {id, kind, value}", ret: true },
      { at: 6, from: "api", to: "web", label: "409 · 422", ret: true, bad: true },
      { at: 7, from: "pg", label: "a new row. That's all.", note: true },
    ]}
  />
);

const P_ING: Participant[] = [
  { id: "ing", label: "ingestor", sub: "ingestor.py", zone: "ingestion" },
  { id: "pg", label: "PostgreSQL", sub: "role ingestor", zone: "data" },
  { id: "bc", label: "bluesky.py", sub: "BlueskyClient", zone: "ingestion" },
  { id: "bs", label: "Bluesky", sub: "api.bsky.app", zone: "internet" },
];

const Ingest: React.FC = () => (
  <Sequence
    {...SEQ}
    parts={P_ING}
    msgs={[
      { at: 0, from: "ing", label: "run(): connect, loop" },
      { at: 1, from: "ing", to: "pg", label: "SELECT id, kind, value" },
      { at: 2, from: "ing", to: "bc", label: "fetch(kind, value, 50)" },
      { at: 2, from: "bc", to: "bs", label: "GET searchPosts" },
      { at: 3, from: "bs", to: "bc", label: "200 · JSON posts", ret: true },
      { at: 3, from: "bc", label: "drop reposts, no-text", note: true },
      { at: 4, from: "ing", to: "pg", label: "INSERT posts × 50" },
      { at: 5, from: "ing", to: "pg", label: "UPDATE last_polled_at" },
      { at: 6, from: "bs", to: "bc", label: "400 unknown handle", ret: true, bad: true },
      { at: 6, from: "ing", to: "pg", label: "last_error = …" },
      { at: 7, from: "ing", label: "heartbeat · sleep 60 s" },
      { at: 8, from: "ing", label: "kubelet: heartbeat age?", note: true },
    ]}
  />
);

const P_Q: Participant[] = [
  { id: "a1", label: "analyzer-1", zone: "analysis" },
  { id: "pg", label: "posts", sub: "A · B · C waiting", zone: "data" },
  { id: "a2", label: "analyzer-2", zone: "analysis" },
];

const Queue: React.FC = () => (
  <Sequence
    {...SEQ}
    parts={P_Q}
    msgs={[
      { at: 0, from: "pg", label: "analyzed_at IS NULL", note: true },
      { at: 1, from: "a1", to: "pg", label: "BEGIN · SKIP LOCKED" },
      { at: 1, from: "pg", to: "a1", label: "A (locked)", ret: true },
      { at: 2, from: "a2", to: "pg", label: "BEGIN · SKIP LOCKED" },
      { at: 2, from: "pg", to: "a2", label: "skip A → B (locked)", ret: true },
      { at: 3, from: "a1", label: "classify(A) ~1.5 s" },
      { at: 3, from: "a2", label: "classify(B)" },
      { at: 4, from: "a1", to: "pg", label: "UPDATE A · COMMIT" },
      { at: 5, from: "a1", to: "pg", label: "next → C" },
      { at: 5, from: "a2", to: "pg", label: "UPDATE B · COMMIT" },
      { at: 6, from: "a2", label: "killed mid-work", note: true },
      { at: 6, from: "pg", label: "ROLLBACK: C waits again", note: true },
      { at: 7, from: "a1", to: "pg", label: "HTTP 4xx/5xx → neutral" },
    ]}
  />
);

const Llm: React.FC = () => (
  <Board
    {...fit}
    boxes={[
      { id: "an", zone: "analysis", label: "analyzer", sub: "analyze_one()", x: 20, y: 24, w: 300, h: 90, at: 0 },
      { id: "cl", zone: "analysis", label: "llm.classify(text)", sub: "text[:2000]", x: 380, y: 24, w: 460, h: 90, at: 0 },
      { id: "chat", zone: "analysis", label: "_chat(): POST /api/chat", sub: "stream false · temperature 0\nkeep_alive 24h · format = JSON schema", x: 200, y: 170, w: 640, h: 120, at: 1 },
      { id: "svc", kind: "chip", zone: "analysis", label: "Service llm · http://llm:11434", x: 200, y: 340, w: 640, h: 56, at: 2 },
      { id: "ol", zone: "analysis", label: "Ollama", sub: "gemma4:e2b-it-qat, in memory", x: 200, y: 440, w: 300, h: 100, at: 2 },
      { id: "js", kind: "chip", zone: "build", label: "{\"sentiment\":\"positive\",\"score\":0.7}", x: 530, y: 460, w: 310, h: 60, at: 2, size: 0.8 },
      { id: "pc", zone: "analysis", label: "parse_classification()", sub: "clamp · regex fallback · fix contradictions", x: 200, y: 590, w: 640, h: 96, at: 3 },
      { id: "tags", kind: "chip", zone: "analysis", label: "/api/tags → model name", x: 20, y: 440, w: 160, h: 100, at: 4, size: 0.8 },
    ]}
    arrows={[
      { id: "a1", from: "an", to: "cl", zone: "analysis", at: 0 },
      { id: "a2", from: "cl", to: "chat", zone: "analysis", at: 1 },
      { id: "a3", from: "chat", to: "svc", zone: "analysis", at: 2 },
      { id: "a4", from: "svc", to: "ol", zone: "analysis", at: 2 },
      { id: "a5", from: "ol", to: "js", zone: "build", at: 2 },
      { id: "a6", from: "js", to: "pc", zone: "build", at: 3 },
      { id: "a7", from: "tags", to: "ol", zone: "analysis", at: 4, dashed: true },
    ]}
  />
);

const Summaries: React.FC = () => (
  <div style={{ paddingTop: 8 }}>
    <Pipeline
      w={SPLIT.visualW}
      title="work_once(): one round"
      color="#38bdf8"
      steps={[
        { at: 0, label: "up to 10 × `analyze_one()`", sub: "then summaries, so a backlog never starves them" },
        { at: 1, label: "`_STALE_SUMMARIES`: which need a refresh?", sub: "never done · older than 15 min · new verdicts" },
        { at: 2, label: "`pg_try_advisory_xact_lock(42, id)`", sub: "another analyzer has it? skip this one", indent: 1 },
        { at: 3, label: "newest 50 analysed posts, last 7 days", sub: "count labels in Python: exact numbers", indent: 1 },
        { at: 4, label: "`llm.summarize()`: two sentences", sub: "up to 25 posts with their labels", indent: 1 },
        { at: 5, label: "`overall_label()` from the mean score", sub: "> 0.2 positive · < −0.2 negative · else mixed/neutral", indent: 1 },
        { at: 6, label: "upsert into `summaries`, COMMIT", sub: "one row per subscription", indent: 1 },
        { at: 7, label: "hourly: delete posts older than 14 days" },
        { at: 8, label: "nothing to do? sleep 5 s, ask again" },
      ]}
      gap={10}
      size={0.92}
    />
  </div>
);

const P_READ: Participant[] = [
  { id: "web", label: "browser", sub: "every 10 s", zone: "lan" },
  { id: "api", label: "api", sub: "api.py", zone: "analysis" },
  { id: "pg", label: "PostgreSQL", sub: "role analysis", zone: "data" },
];

const ReadBack: React.FC = () => (
  <Sequence
    {...SEQ}
    parts={P_READ}
    msgs={[
      { at: 0, from: "web", label: "setInterval(refresh, 10000)" },
      { at: 1, from: "web", to: "api", label: "GET /api/subscriptions" },
      { at: 1, from: "api", to: "pg", label: "one SELECT (pool)" },
      { at: 2, from: "pg", label: "LEFT JOIN summaries", note: true },
      { at: 3, from: "pg", label: "pending = count(NULL)", note: true },
      { at: 4, from: "pg", to: "api", label: "rows as dicts", ret: true },
      { at: 4, from: "api", to: "web", label: "JSON", ret: true },
      { at: 5, from: "web", label: "render the cards" },
      { at: 6, from: "web", to: "api", label: "DELETE /api/subscriptions/7" },
      { at: 6, from: "api", to: "pg", label: "DELETE … CASCADE" },
    ]}
  />
);

const Timeline: React.FC = () => (
  <div style={{ paddingTop: 6 }}>
    <Table
      w={BODY.w}
      size={1.12}
      cols={[{ label: "when", w: 12 }, { label: "who", w: 14 }, { label: "what happens", w: 74 }]}
      rows={[
        { at: 0, cells: ["t = 0 s", "browser → api", "`POST /api/subscriptions` `#kubernetes` → `INSERT subscriptions` → 201"] },
        { at: 1, cells: ["≤ 60 s", "ingestor", "sees the row, `GET searchPosts?q=#kubernetes` → 50 posts inserted with `analyzed_at` NULL"] },
        { at: 1, cells: ["", "ingestor", "`UPDATE subscriptions SET last_polled_at = now(), last_error = NULL`"] },
        { at: 2, cells: ["≤ 10 s", "browser", "the card shows \"pending: 50\", no summary yet"] },
        { at: 3, cells: ["~1.5 s/post", "analyzer → llm", "claim with `SKIP LOCKED`, classify, `UPDATE posts SET sentiment, score, analyzed_at`, COMMIT"] },
        { at: 4, cells: ["", "analyzer → llm", "`#kubernetes` never summarised → advisory lock → summarize → upsert `summaries`"] },
        { at: 5, cells: ["≤ 10 s", "browser", "summary, overall label, counts and \"updated at\" appear"] },
        { at: 6, cells: ["afterwards", "everyone", "ingestor polls every 60 s · summaries refresh on new verdicts, at least every 15 min · posts > 14 days deleted hourly"] },
      ]}
    />
  </div>
);

export const JOURNEY: SceneDef[] = [
  {
    id: "request-path", chapter: CH, title: "An analyst's request, hop by hop", View: RequestPath,
    beats: [
      { say: "An analyst opens `http://localhost:8090`. That port belongs to `k3d-skypulse-serverlb`, an nginx container that forwards to port 80 on any node.", flow: ["1"] },
      { say: "Traefik's Service is a LoadBalancer. On bare metal nobody provides one, so k3s's **ServiceLB** runs a `svclb-traefik` pod on every node: it holds hostPort 80 and forwards with iptables.", flow: ["2"] },
      { say: "One of the two Traefik pods reads the Ingress `skypulse`. With no host set it matches any hostname, and path `/` goes to the Service `api`, port `http`.", code: "ingress_full", focus: ["ingressClassName: traefik", "path: /", "name: api"], flow: ["3"] },
      { say: "The Service picks one ready api pod. The api's NetworkPolicy allows exactly this hop: **only Traefik**, from `kube-system`, on port 8000.", code: "np_api", focus: ["kubernetes.io/metadata.name: kube-system", "app.kubernetes.io/name: traefik", "port: 8000"], flow: ["4", "5"] },
      { say: "`GET /` returns `static/index.html`, one page whose JavaScript calls the API. On-prem, MetalLB would give Traefik a real IP on the analysts' VLAN instead of ServiceLB.", code: "web_refresh", focus: ['fetch("/api/subscriptions")'] },
    ],
  },
  {
    id: "subscribe", chapter: CH, title: "Subscribe: `POST /api/subscriptions`", View: Subscribe,
    beats: [
      { say: "The analyst types `#Kubernetes` and clicks Add. The form's handler posts `{target: \"#Kubernetes\"}` as JSON.", code: "web_submit", focus: ['fetch("/api/subscriptions"', 'method: "POST"', "JSON.stringify({target:"] },
      { say: "FastAPI validates the body against the pydantic model `SubscriptionIn` before `subscribe()` even runs.", code: "api_subscribe", focus: ["def subscribe(body: SubscriptionIn)"] },
      { say: "`parse_target` normalizes the input: a leading `#` means hashtag, the rest is lower-cased. `@bsky.app` would become a handle.", code: "targets_parse", focus: ['kind = "hashtag" if text.startswith("#") else "handle"', 'value = text.lstrip("#").lower()', "return Target(kind=kind, value=value)"] },
      { say: "It only checks the **shape**, with regular expressions. The api has no internet, so it can't ask Bluesky whether the handle exists; the ingestor finds out later.", focus: ["_HASHTAG_RE.match", "_HANDLE_RE.match"] },
      { say: "One `INSERT`, from the connection pool. `ON CONFLICT DO NOTHING RETURNING id` returns no row for a duplicate.", code: "api_subscribe", focus: ["INSERT INTO subscriptions", "ON CONFLICT (kind, value) DO NOTHING RETURNING id"] },
      { say: "A new row returns 201 with its id, and the page refreshes its list.", focus: ['return {"id": row["id"]'] },
      { say: "A duplicate becomes **409** \"already subscribed\"; a malformed target, **422**. The page shows the API's message.", focus: ["status_code=409", "status_code=422"] },
      { say: "And that's all the api does. It doesn't call the ingestor or the analyzer: they discover the new row on their next loop." },
    ],
  },
  {
    id: "ingest", chapter: CH, title: "Ingest: from Bluesky into the queue", View: Ingest,
    beats: [
      { say: "The ingestor's `run()` writes a first heartbeat, connects with `wait_for_db()`, and loops forever.", code: "ing_run", focus: ["def run()", "conn = db.wait_for_db()", "while True:"] },
      { say: "Each round reads the subscriptions: only `id, kind, value`, the three columns its role is allowed to read.", code: "ing_poll", focus: ['"SELECT id, kind, value FROM subscriptions"'] },
      { say: "For a hashtag, `bluesky.py` calls `searchPosts`; for a handle, `getAuthorFeed` without replies. The public API needs no account.", code: "bsky_fetch", focus: ["app.bsky.feed.getAuthorFeed", "app.bsky.feed.searchPosts"] },
      { say: "The parsers skip **reposts**, which aren't the author's own words, and posts **without text**, which carry no readable sentiment.", code: "bsky_parse", focus: ["if not text:", 'if item.get("reason"):'] },
      { say: "All posts go in one transaction. `ON CONFLICT DO NOTHING` skips posts seen before, so only new ones are added, each with `analyzed_at` NULL: queued.", code: "ing_poll", focus: ["with conn.transaction():", "INSERT INTO posts", "ON CONFLICT DO NOTHING"] },
      { say: "Then it records the poll: `last_polled_at = now()`, and `last_error = NULL`, which clears any earlier error.", focus: ["UPDATE subscriptions SET last_polled_at"] },
      { say: "An unknown handle answers 400 and becomes `TargetNotFound`; a network failure is an `HTTPError`. Either way it's written to `last_error`, and the loop moves on to the next subscription.", focus: ["except TargetNotFound", "except httpx.HTTPError", 'error = f"Not found on Bluesky'] },
      { say: "After each round: `heartbeat()` touches `/tmp/heartbeat`, then it sleeps `POLL_INTERVAL_SECONDS`, 60 seconds.", code: "ing_run", focus: ["db.heartbeat()", "time.sleep(settings.poll_interval_seconds)"] },
      { say: "The pod's liveness probe restarts the container if that file is older than 10 minutes: it catches a loop that hangs without crashing.", code: "ingestor_live", focus: ["getmtime('/tmp/heartbeat') > 600"] },
    ],
  },
  {
    id: "queue", chapter: CH, title: "Postgres as a work queue: `SKIP LOCKED`", View: Queue,
    beats: [
      { say: "The queue is just rows: a post with `analyzed_at IS NULL` is waiting. The rule that makes it work: **a row lock lives exactly as long as the transaction that took it.**", code: "an_claim", focus: ["def analyze_one("] },
      { say: "analyzer-1 opens a transaction and selects the newest waiting post `FOR UPDATE`: it gets A, and locks it.", focus: ["with conn.transaction():", "WHERE analyzed_at IS NULL", "FOR UPDATE SKIP LOCKED"] },
      { say: "analyzer-2 runs the same query. `SKIP LOCKED` treats A as invisible, so it takes B instead of waiting. No coordination besides the database.", focus: ["FOR UPDATE SKIP LOCKED"] },
      { say: "Each calls the LLM, about 1.5 s per post, **while still holding its lock**. That is what makes the claim exclusive.", focus: ["label, score = llm.classify(text)"] },
      { say: "Setting `analyzed_at` takes the post out of the queue. Leaving the `with` block commits: the result becomes visible and the lock is released in one step.", focus: ["UPDATE posts SET sentiment = %s, score = %s, analyzed_at = now()", "return True"] },
      { say: "Each analyzer moves on to the next free post. No post is analysed twice, and no analyzer waits for another." },
      { say: "If an analyzer dies mid-classification, its connection drops, Postgres rolls the transaction back, and the lock disappears. The post is still NULL: someone picks it up again." },
      { say: "If the LLM rejects one specific post, it's marked neutral, so a \"poison\" post can't block the head of the queue forever. If the LLM is down, the transaction rolls back and the post waits.", focus: ["except httpx.HTTPStatusError", 'label, score = "neutral", 0.0'] },
      { say: "Why not Redis or RabbitMQ? Postgres is already there and already HA; the post and its queue entry are one row in one transaction; and a broker would be a second place where the zones meet." },
    ],
  },
  {
    id: "llm", chapter: CH, title: "Talking to the LLM: `llm.py`", View: Llm,
    beats: [
      { say: "`llm.classify(text)` sends one post with a **JSON schema**: Ollama can only produce matching JSON, a `sentiment` from three labels and a numeric `score`.", code: "llm_classify", focus: ["_CLASSIFY_SCHEMA = {", '"enum": list(LABELS)', "fmt=_CLASSIFY_SCHEMA"], flow: ["a1"] },
      { say: "Every call goes through `_chat`: no streaming, `temperature: 0` so the same post always gets the same label, and `keep_alive` so the model stays loaded.", code: "llm_chat", focus: ['"stream": False', '"keep_alive": "24h"', '"temperature": 0', 'body["format"] = fmt'], flow: ["a2"] },
      { say: "It's a plain `POST /api/chat` to `http://llm:11434`, the `llm` Service in the same namespace. The llm's NetworkPolicy accepts only the analyzer.", focus: ['self._http.post("/api/chat", json=body)'], flow: ["a3", "a4", "a5"] },
      { say: "`parse_classification` still checks: it clamps the score to [−1, 1], falls back to a regex if the JSON is broken, and fixes a positive label with a negative score.", code: "llm_parse", focus: ["re.search(", "score = max(-1.0, min(1.0, score))", "score = -score"], flow: ["a6"] },
      { say: "The model name isn't configured twice: with `LLM_MODEL` empty, the client asks Ollama's `/api/tags` which model is baked into the image.", code: "llm_model", focus: ['self._http.get("/api/tags")'], flow: ["a7"] },
    ],
  },
  {
    id: "summaries", chapter: CH, title: "Summaries: the analyzer's second job", View: Summaries,
    beats: [
      { say: "`work_once` classifies at most 10 posts, then turns to summaries, so a large backlog never starves them.", code: "an_work", focus: ["for _ in range(POSTS_PER_ROUND):", "_STALE_SUMMARIES"] },
      { say: "`_STALE_SUMMARIES` picks subscriptions never summarised, older than 15 minutes, or with new verdicts once the backlog is drained, or after a minute anyway.", code: "an_stale", focus: ["sm.subscription_id IS NULL", "make_interval(secs => %(max_age)s)", "p.analyzed_at > sm.updated_at", "interval '60 seconds'"] },
      { say: "`refresh_summary` takes `pg_try_advisory_xact_lock(42, sub_id)`: the claim idea again, on a number instead of a row. If another analyzer holds it, this one skips.", code: "an_refresh", focus: ["pg_try_advisory_xact_lock", "if not locked:"] },
      { say: "It reads the newest 50 analysed posts from the last 7 days and counts the labels **in Python**, so the numbers analysts see are exact, not the LLM's guess.", focus: ["analyzed_at IS NOT NULL", "ORDER BY posted_at DESC LIMIT", 'counts[label] += 1'] },
      { say: "`llm.summarize` sends up to 25 posts with their labels and asks for at most two sentences.", code: "llm_summarize", focus: ["posts[:25]", "max_tokens=160"] },
      { say: "The overall label is the mean score: above 0.2 positive, below −0.2 negative; `mixed` when strong opinions pull both ways, otherwise neutral.", code: "llm_overall", focus: ["mean > 0.2", "mean < -0.2", '"mixed"'] },
      { say: "An upsert, `ON CONFLICT (subscription_id) DO UPDATE`, keeps exactly one summary row per subscription. The commit releases the advisory lock.", code: "an_refresh", focus: ["INSERT INTO summaries", "ON CONFLICT (subscription_id) DO UPDATE SET"] },
      { say: "Once an hour, the analyzer deletes posts older than 14 days.", code: "an_run", focus: ["time.monotonic() - last_cleanup > 3600", "DELETE FROM posts WHERE posted_at"] },
      { say: "With nothing to do it sleeps 5 seconds; with a backlog it never sleeps. Each loop ends with a heartbeat, like the ingestor's.", focus: ["db.heartbeat()", "if not did_work:"] },
    ],
  },
  {
    id: "read-back", chapter: CH, title: "Reading it back: the analyst's screen", View: ReadBack,
    beats: [
      { say: "The page calls `refresh()` once, then every 10 seconds. Summaries appear without reloading.", code: "web_refresh", focus: ["setInterval(refresh, 10000)"] },
      { say: "`GET /api/subscriptions` borrows a connection from a pool of up to 10. `check_connection` tests it before lending it out, so after a failover stale connections get replaced.", code: "api_pool", focus: ["pool = ConnectionPool(", "max_size=10", "check=ConnectionPool.check_connection"] },
      { say: "One query builds the whole screen. The `LEFT JOIN` keeps a new subscription with no summary yet: \"Waiting for the first analysis…\"", code: "api_list", focus: ["LEFT JOIN summaries sm ON sm.subscription_id = s.id"] },
      { say: "`pending` counts the posts still in the queue. `last_error` is written by the ingestor: that's how \"Not found on Bluesky\" reaches the analyst.", focus: ["AS pending", "s.last_error"] },
      { say: "`dict_row` makes every row a dict, so FastAPI returns it as JSON directly.", code: "api_pool", focus: ['"row_factory": dict_row'] },
      { say: "The page renders a card per subscription: summary, overall label, positive, neutral and negative counts, pending, and when it was updated.", code: "web_refresh", focus: ["subs.map(card)"] },
      { say: "Unsubscribing is one `DELETE`. `ON DELETE CASCADE` removes the posts and the summary in the same statement.", code: "api_unsubscribe", focus: ["DELETE FROM subscriptions WHERE id = %s"] },
    ],
  },
  {
    id: "timeline", chapter: CH, title: "The whole journey of `#kubernetes`", layout: "full", View: Timeline,
    beats: [
      { say: "Put together: at t = 0 the api writes one row and answers 201." },
      { say: "Within 60 seconds the ingestor picks it up, fetches up to 50 posts and queues them." },
      { say: "Meanwhile the page polls every 10 seconds and shows the queue growing." },
      { say: "The analyzer drains the queue at about 1.5 seconds per post, newest first." },
      { say: "Then it writes the first summary." },
      { say: "Within 10 more seconds, the page shows it." },
      { say: "From then on everything repeats on its own schedule. No process ever called another: every step was a row written by one and read by the next." },
    ],
  },
];
