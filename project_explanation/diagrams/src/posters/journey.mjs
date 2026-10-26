import { snip, code, page, sequence, b } from "../lib.mjs";

const LANES = [
  { id: "web", name: "Browser", sub: "static/index.html", zone: "ext" },
  { id: "api", name: "api", sub: "api.py", zone: "ana" },
  { id: "pg", name: "PostgreSQL", sub: "feeddb-rw", zone: "data" },
  { id: "an", name: "analyzer", sub: "analyzer.py", zone: "ana" },
  { id: "llm", name: "Ollama", sub: "llm pod · llm.py", zone: "llm" },
  { id: "ing", name: "ingestor", sub: "ingestor.py", zone: "ing" },
  { id: "bsky", name: "Bluesky", sub: "api.bsky.app", zone: "ext" },
];

const legend = `<div class="legend" style="margin:-6px 0 18px">
  <span><b>How to read it:</b> each column is a process; time flows downward. Solid arrow = a call, dashed = its answer,
  box on a column = work done inside that process. Letters ${b("A")} point at the line of code that does it.</span></div>`;

const processesNeverCall = `<div class="callout z-data" style="margin-bottom:22px">
  <b>Notice what never happens:</b> no arrow goes from one SkyPulse process to another. The api, the ingestor and the analyzer
  only meet <b>inside PostgreSQL</b>: one writes a row, another reads it later on its own schedule. That is why any of them can
  be down, slow or mid-upgrade without blocking the others.</div>`;

export const journeyIngest = {
  file: "06-journey-subscribe-and-ingest.png",
  render: () =>
    page({
      num: 6,
      title: "One subscription's journey, part 1: subscribe and ingest",
      subtitle:
        "An analyst types <code>#kubernetes</code>. The api stores the wish; a minute later the ingestor, the only process allowed on the " +
        "internet, fetches matching posts from Bluesky and drops them into the <code>posts</code> table.",
      body: `${legend}${processesNeverCall}${sequence({
        lanes: LANES,
        rows: [
          {
            n: 1, zone: "ext", title: "The analyst subscribes",
            text: `<p>The page is plain HTML + JavaScript served by the api itself. The form posts the raw text ${b("A")};
              the server decides whether it is a handle or a hashtag.</p>`,
            items: [{ from: "web", to: "api", label: "POST /api/subscriptions {target: \"#kubernetes\"}" }],
            right: code(snip("src/skypulse/static/index.html", [{ at: '$("#add").addEventListener', n: 7 }], { lang: "javascript", marks: { "body: JSON.stringify": "A" } })),
          },
          {
            n: 2, zone: "ana", title: "The api validates and stores it",
            text: `<p><code>parse_target()</code> ${b("A")} only checks the <i>shape</i> (the api has no internet, so it can't ask Bluesky whether
              a handle exists). <code>ON CONFLICT DO NOTHING RETURNING id</code> ${b("B")} makes duplicates a clean 409 instead of an error.
              That's all: no Bluesky call and no LLM call on the request path.</p>`,
            items: [
              { lane: "api", note: "parse_target(): <b>#kubernetes</b> → hashtag" },
              { from: "api", to: "pg", label: "INSERT INTO subscriptions … ON CONFLICT DO NOTHING RETURNING id" },
              { from: "pg", to: "api", label: "id, or no row", reply: true },
              { from: "api", to: "web", label: "201 · 409 duplicate · 422 invalid", reply: true },
            ],
            right: `${code(snip("src/skypulse/api.py", [{ at: '@app.post("/api/subscriptions"', to: 'return {"id": row["id"]' }], {
              marks: { "target = parse_target(": "A", "ON CONFLICT (kind, value) DO NOTHING RETURNING id": "B" },
            }))}${code(snip("src/skypulse/targets.py", [{ at: "if kind is None:", n: 2 }, { at: 'if kind == "hashtag":', n: 4 }]))}`,
          },
          {
            n: 3, zone: "ing", title: "Every 60 s the ingestor reads the list",
            text: `<p>The ingestor is a plain <code>while True</code> loop ${b("B")}. Each round starts by reading all targets ${b("A")}. Its database role can
              only see the columns <code>id, kind, value</code>: it can't read who subscribed when, or any summary.</p>`,
            items: [
              { lane: "ing", note: "loop: poll_once(), then sleep 60 s" },
              { from: "ing", to: "pg", label: "SELECT id, kind, value FROM subscriptions" },
              { from: "pg", to: "ing", label: "[(7, 'hashtag', 'kubernetes'), …]", reply: true },
            ],
            right: `${code(snip("src/skypulse/ingestor.py", [{ at: "def poll_once(", n: 3 }, { at: "while True:", n: 2 }, { at: "time.sleep(settings.poll_interval_seconds)", n: 1 }], {
              marks: { 'conn.execute("SELECT id, kind, value FROM subscriptions")': "A", "while True:": "B" },
            }))}`,
          },
          {
            n: 4, zone: "ing", title: "It fetches recent posts from Bluesky",
            text: `<p>The public AppView API needs no account. Handles use <code>getAuthorFeed</code> ${b("A")}, hashtags use <code>searchPosts</code> ${b("B")}.
              A 400 means "no such handle" ${b("C")}: it's stored in <code>last_error</code> and shown on the analyst's card.</p>
              <p>The parsers drop reposts and image-only posts, which carry no text to judge.</p>`,
            items: [
              { from: "ing", to: "bsky", label: "GET /xrpc/app.bsky.feed.searchPosts?q=#kubernetes" },
              { from: "bsky", to: "ing", label: "JSON: up to 50 posts", reply: true },
              { lane: "ing", note: "parse_search(): skip posts without text" },
            ],
            right: code(snip("src/skypulse/bluesky.py", [{ at: "def fetch(self", to: "return parse(resp.json())" }], {
              marks: { '"/xrpc/app.bsky.feed.getAuthorFeed"': "A", '"/xrpc/app.bsky.feed.searchPosts"': "B", "raise TargetNotFound": "C" },
            })),
          },
          {
            n: 5, zone: "ing", title: "…and drops them into posts, idempotently",
            text: `<p>All inserts for one target run in one transaction ${b("A")}. <code>UNIQUE(subscription_id, uri)</code> + <code>ON CONFLICT DO NOTHING</code> ${b("B")}
              make re-polling the same posts harmless, so two ingestor replicas would also be safe.</p>
              <p>Then it records the poll ${b("C")}: <code>last_polled_at</code> and the error (or <code>NULL</code>). If the analyst unsubscribed mid-poll,
              the foreign key fails ${b("D")} and the target is skipped.</p>
              <p class="muted small">New rows have <code>analyzed_at IS NULL</code>: that alone puts them in the analyzer's queue (part 2).</p>`,
            items: [
              { from: "ing", to: "pg", label: "INSERT INTO posts … ON CONFLICT DO NOTHING (×N)" },
              { from: "ing", to: "pg", label: "UPDATE subscriptions SET last_polled_at = now(), last_error = …" },
            ],
            right: code(snip("src/skypulse/ingestor.py", [{ at: "posts = client.fetch(", to: "(error, sub_id)," }], {
              marks: { "with conn.transaction():": "A", "ON CONFLICT DO NOTHING": "B", "psycopg.errors.ForeignKeyViolation": "D", '"UPDATE subscriptions SET last_polled_at': "C" },
            })),
          },
        ],
      })}`,
    }),
};

export const journeyAnalyze = {
  file: "07-journey-analyze-and-read.png",
  render: () =>
    page({
      num: 7,
      title: "One subscription's journey, part 2: analyze, summarize, read",
      subtitle:
        "The analyzer works through the queue of unanalyzed posts with the local LLM, keeps one summary per subscription up to date, " +
        "and the analyst's page simply reads the result every 10 seconds.",
      body: `${legend}${sequence({
        lanes: LANES,
        rows: [
          {
            n: 6, zone: "ana", title: "The analyzer claims the newest unanalyzed post",
            text: `<p>The queue is just a query ${b("A")}: <code>WHERE analyzed_at IS NULL</code>, served by a partial index.
              <code>FOR UPDATE SKIP LOCKED</code> locks the row; a second analyzer replica would skip it and take the next one, so no post is
              classified twice and nobody waits.</p>
              <p>If Ollama rejects one post ${b("B")}, it's marked neutral rather than blocking the queue forever.</p>`,
            items: [
              { lane: "an", note: "loop: up to 10 posts per round" },
              { from: "an", to: "pg", label: "SELECT id, text FROM posts WHERE analyzed_at IS NULL … FOR UPDATE SKIP LOCKED" },
              { from: "pg", to: "an", label: "(4711, 'K8s 1.36 is out…')", reply: true },
            ],
            right: code(snip("src/skypulse/analyzer.py", [{ at: "def analyze_one(", to: "return True" }], {
              marks: { '"SELECT id, text FROM posts WHERE analyzed_at IS NULL"': "A", "except httpx.HTTPStatusError": "B", '"UPDATE posts SET sentiment': "C" },
            })),
          },
          {
            n: 7, zone: "llm", title: "Ollama classifies it, constrained by a JSON schema",
            text: `<p>The schema ${b("A")} is passed as Ollama's <code>format</code> ${b("B")}: the model can only answer with valid JSON whose sentiment is one of
              three labels. <code>temperature 0</code> makes the answer repeatable. <code>parse_classification()</code> still double-checks it (clamps
              the score to [-1, 1] and makes sign and label agree).</p>
              <p>The result is written back in the same transaction (step 6, line ${b("C")}), which also releases the row lock.</p>`,
            items: [
              { from: "an", to: "llm", label: "POST /api/chat  system prompt + post text, format = schema" },
              { from: "llm", to: "an", label: "{\"sentiment\": \"positive\", \"score\": 0.7}", reply: true },
              { lane: "an", note: "parse_classification()" },
              { from: "an", to: "pg", label: "UPDATE posts SET sentiment, score, analyzed_at = now()" },
            ],
            right: `${code(snip("src/skypulse/llm.py", [{ at: "_CLASSIFY_SCHEMA = {", n: 8 }, { at: '"options": {"temperature": 0', n: 4 }, { at: "def classify(self", n: 3 }], {
              marks: { "_CLASSIFY_SCHEMA = {": "A", 'body["format"] = fmt': "B" },
            }))}`,
          },
          {
            n: 8, zone: "ana", title: "Which summaries are stale?",
            text: `<p>After each batch, one query decides which subscriptions need a new summary: never summarized ${b("A")}, older than 15 min so the 7-day
              window slides ${b("B")}, or new posts were analyzed since ${b("C")}. While a backlog is still being processed, it refreshes at most once a minute ${b("D")}.</p>`,
            items: [
              { from: "an", to: "pg", label: "_STALE_SUMMARIES (subscriptions ⟕ summaries)" },
              { from: "pg", to: "an", label: "[(7, 'hashtag', 'kubernetes')]", reply: true },
            ],
            right: code(snip("src/skypulse/analyzer.py", [{ at: "_STALE_SUMMARIES = ", to: "ORDER BY s.id" }], {
              marks: { "sm.subscription_id IS NULL": "A", "OR sm.updated_at < now() - make_interval": "B", "p.analyzed_at > sm.updated_at": "C", "interval '60 seconds'": "D" },
            })),
          },
          {
            n: 9, zone: "ana", title: "Refresh one summary",
            text: `<p>An advisory lock ${b("A")} makes sure only one replica summarizes a subscription at a time. It reads the newest ≤ 50 analyzed posts of
              the last 7 days ${b("B")}, counts the labels in Python, asks the LLM for ≤ 2 sentences ${b("C")}, derives the overall label from the
              scores (<code>overall_label()</code>) and upserts the one row for this subscription ${b("D")}.</p>
              <p class="muted small"><code>item_count</code> and <code>updated_at</code> are exactly what the brief asks to display (how many posts, and when).</p>`,
            items: [
              { from: "an", to: "pg", label: "pg_try_advisory_xact_lock(42, id); SELECT window posts" },
              { from: "pg", to: "an", label: "≤ 50 (text, label, score)", reply: true },
              { from: "an", to: "llm", label: "POST /api/chat  summary prompt (≤ 25 posts)" },
              { from: "llm", to: "an", label: "\"Mostly upbeat about the 1.36 release…\"", reply: true },
              { lane: "an", note: "counts + overall_label(scores)" },
              { from: "an", to: "pg", label: "INSERT INTO summaries … ON CONFLICT DO UPDATE" },
            ],
            right: code(snip("src/skypulse/analyzer.py", [{ at: "def refresh_summary(", to: "if not locked:" }, { at: "posts = conn.execute(", n: 6 }, { at: "if posts:", n: 2 }, { at: "INSERT INTO summaries", n: 4 }], {
              marks: { "pg_try_advisory_xact_lock(42": "A", "make_interval(hours => %s)": "B", "summary = llm.summarize(": "C", "ON CONFLICT (subscription_id) DO UPDATE": "D" },
            })),
          },
          {
            n: 10, zone: "ext", title: "The page reads the result every 10 s",
            text: `<p><code>setInterval</code> ${b("A")} re-fetches the list. The api answers with one query ${b("B")}: subscriptions left-joined with their summary,
              plus how many posts still wait for the LLM. It's a plain read, so it stays fast however slow the LLM or Bluesky are.</p>`,
            items: [
              { from: "web", to: "api", label: "GET /api/subscriptions" },
              { from: "api", to: "pg", label: "_LIST_SQL" },
              { from: "pg", to: "api", label: "rows", reply: true },
              { from: "api", to: "web", label: "JSON → one card per subscription", reply: true },
            ],
            right: `${code(snip("src/skypulse/api.py", [{ at: "_LIST_SQL = ", to: "ORDER BY s.created_at" }], { marks: { "LEFT JOIN summaries sm": "B" } }))}
              ${code(snip("src/skypulse/static/index.html", [{ at: "async function refresh()", n: 3 }, { at: "setInterval(refresh", n: 1 }], { lang: "javascript", marks: { "setInterval(refresh, 10000)": "A" } }))}`,
          },
          {
            n: 11, zone: "ana", title: "Unsubscribe, and housekeeping",
            text: `<p>Deleting the subscription ${b("A")} is enough: <code>ON DELETE CASCADE</code> removes its posts and summary. Separately, once an hour the
              analyzer deletes posts older than 14 days ${b("B")}, so the table doesn't grow forever.</p>`,
            items: [
              { from: "web", to: "api", label: "DELETE /api/subscriptions/7" },
              { from: "api", to: "pg", label: "DELETE FROM subscriptions WHERE id = 7  (cascades)" },
              { from: "an", to: "pg", label: "hourly: DELETE FROM posts WHERE posted_at < now() − 14 days" },
            ],
            right: `<div class="col">${code(snip("src/skypulse/api.py", [{ at: "def unsubscribe(", n: 3 }], { marks: { '"DELETE FROM subscriptions WHERE id = %s"': "A" } }))}
              ${code(snip("src/skypulse/analyzer.py", [{ at: "if time.monotonic() - last_cleanup > 3600", n: 4 }], { marks: { '"DELETE FROM posts WHERE posted_at': "B" } }))}</div>`,
          },
        ],
      })}`,
    }),
};
