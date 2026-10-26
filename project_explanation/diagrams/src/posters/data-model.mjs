import { snip, code, page, esc, b } from "../lib.mjs";

// UML class diagram: the four tables (<<table>>) and the Python models that become their rows.
// Kept in step with MIGRATIONS in src/skypulse/db.py by hand; the snippets below are read from the code.
const UML = `classDiagram
  direction LR
  class SubscriptionIn["api.SubscriptionIn"] {
    <<pydantic request body>>
    +str target
    +str | None kind
  }
  class Target["targets.Target"] {
    <<frozen dataclass>>
    +str kind
    +str value
    +display() str
  }
  class BskyPost["bluesky.Post"] {
    <<frozen dataclass>>
    +str uri
    +str author
    +str text
    +datetime posted_at
  }
  class subscriptions {
    <<table>>
    +BIGINT id PK identity
    +TEXT kind  handle | hashtag
    +TEXT value
    +TIMESTAMPTZ created_at
    +TIMESTAMPTZ last_polled_at
    +TEXT last_error
    UNIQUE kind, value
  }
  class posts {
    <<table · work queue>>
    +BIGINT id PK identity
    +BIGINT subscription_id FK
    +TEXT uri
    +TEXT author
    +TEXT text
    +TIMESTAMPTZ posted_at
    +TIMESTAMPTZ ingested_at
    +TEXT sentiment  positive | neutral | negative
    +REAL score  -1 … 1
    +TIMESTAMPTZ analyzed_at  NULL = queued
    UNIQUE subscription_id, uri
  }
  class summaries {
    <<table · precomputed>>
    +BIGINT subscription_id PK FK
    +TEXT summary
    +TEXT overall
    +INT positive
    +INT neutral
    +INT negative
    +INT item_count
    +TIMESTAMPTZ window_start
    +TIMESTAMPTZ window_end
    +TIMESTAMPTZ updated_at
  }
  class schema_migrations {
    <<table · bookkeeping>>
    +INT version PK
  }
  SubscriptionIn ..> Target : parse_target
  Target ..> subscriptions : api INSERT
  BskyPost ..> posts : ingestor INSERT
  subscriptions "1" *-- "0..*" posts : ON DELETE CASCADE
  subscriptions "1" *-- "0..1" summaries : ON DELETE CASCADE`;

const W = (cols) => cols.map((c) => `<code>${c}</code>`).join(", ");

export default {
  file: "13-data-model.png",
  render: () =>
    page({
      num: 13,
      title: "The data model in UML",
      subtitle:
        "Three application tables and one bookkeeping table in PostgreSQL, plus the three small Python models that become their rows. " +
        "Composition (filled diamond) means the rows can't outlive their subscription: deleting it cascades to its posts and summary.",
      body: `
<style>
  .mermaid { background:#fff; border:1.5px solid var(--line); border-radius:12px; padding:18px; display:flex; justify-content:center; }
  .mermaid svg { max-width:100% !important; height:auto; }
</style>
<pre class="mermaid" style="margin:0 0 10px">${esc(UML)}</pre>
<div class="legend" style="margin-bottom:24px">
  <span><b>How to read it:</b> <code>&lt;&lt;table&gt;&gt;</code> = a PostgreSQL table, created by the migrate Job.
  Dashed arrow = "is turned into" (Python model → row). Filled diamond = composition with multiplicity: one subscription has 0..* posts and 0..1 summary.</span></div>

<div class="grid3">
  <div class="col">
    <h2>Keys, constraints, indexes</h2>
    <ul class="tight">
      <li><b>subscriptions</b>: <code>UNIQUE (kind, value)</code>, so the api answers <code>409</code> to a duplicate; <code>kind</code> is CHECKed.</li>
      <li><b>posts</b>: <code>UNIQUE (subscription_id, uri)</code> is what <code>ON CONFLICT DO NOTHING</code> relies on: duplicates are per subscription.</li>
      <li><b>posts</b>: <code>sentiment</code> is CHECKed; <code>analyzed_at IS NULL</code> marks the queue.</li>
      <li><b>summaries</b>: the PK <i>is</i> the FK, so at most one row per subscription: the analyzer upserts it.</li>
      <li><b>Partial index</b> <code>posts_unanalyzed (posted_at DESC) WHERE analyzed_at IS NULL</code> holds only the queue.</li>
      <li><b>Index</b> <code>posts_by_subscription (subscription_id, posted_at DESC)</code> serves the summary query.</li>
    </ul>
  </div>
  <div class="col">
    <h2>Who may write which columns</h2>
    <table class="t">
      <tr><th>DB role</th><th>Rights (column-level GRANTs)</th></tr>
      <tr><td><span class="pill z-ing">ingestor</span></td><td>read ${W(["id", "kind", "value"])} of subscriptions; update ${W(["last_polled_at", "last_error"])}; <b>insert</b> posts</td></tr>
      <tr><td><span class="pill z-ana">analysis</span></td><td>select/insert/delete subscriptions; select/delete posts; update ${W(["sentiment", "score", "analyzed_at"])}; select/insert/update summaries</td></tr>
      <tr><td><span class="pill z-mon">pg_monitor</span></td><td>timestamps and counters only, never post text or summaries</td></tr>
      <tr><td><span class="pill z-data">skypulse</span></td><td>schema owner: used only by the migrate Job</td></tr>
    </table>
  </div>
  <div class="col">
    <h2>One row's life in <code>posts</code></h2>
    <p>${b("1")} The ingestor inserts it from a <code>bluesky.Post</code>: sentiment, score and analyzed_at are NULL.
      ${b("2")} The analyzer claims it, asks the LLM and fills those three columns.
      ${b("3")} It counts towards its subscription's summary for 7 days.
      ${b("4")} After 14 days the analyzer's hourly cleanup deletes it.</p>
    <div class="callout z-data">No ORM: the models are plain dataclasses and SQL. The tables are the contract between the zones; the Python classes never leave their process.</div>
  </div>
</div>

<div class="grid3 section">
  ${code(snip("src/skypulse/api.py", [{ at: "class SubscriptionIn(BaseModel):", n: 3 }], { title: "request body" }))}
  ${code(snip("src/skypulse/targets.py", [{ at: "@dataclass(frozen=True)", n: 8 }], { title: "validated target" }))}
  ${code(snip("src/skypulse/bluesky.py", [{ at: "@dataclass(frozen=True)", n: 6 }], { title: "a fetched post" }))}
</div>`,
    }),
};
