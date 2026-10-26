import { snip, code, page, b } from "../lib.mjs";

// Who may do what with each column, as granted in db.migrate(). Keep in sync with src/skypulse/db.py
// (the GRANT snippet on this poster is pulled from that file, so a mismatch is visible side by side).
const R = (zone, text) => `<span class="pill z-${zone}" style="font-size:11px;padding:1px 7px">${text}</span>`;
const ING = (t) => R("ing", t), ANA = (t) => R("ana", t), MON = (t) => R("mon", t);

const table = (name, note, cols) => `<div class="box entity">
  <h3><span class="mono" style="font-size:16px">${name}</span><span class="muted small" style="font-weight:400">${note}</span></h3>
  <table class="t ent">${cols.map(([c, type, who]) => `<tr><td class="mono">${c}</td><td class="mono muted">${type}</td><td>${who}</td></tr>`).join("")}</table>
</div>`;

export default {
  file: "08-database.png",
  render: () =>
    page({
      num: 8,
      title: "PostgreSQL: the only state, the work queue, and who may touch what",
      subtitle:
        "Three tables hold everything. The schema doubles as the work queue between the processes, and each zone logs in as its own role " +
        "that can touch only the columns it needs. The migrate Job creates all of it, as the owner, on every deploy.",
      body: `
<style>
  .entity { padding:12px 14px; } .entity h3 { justify-content:space-between; }
  table.ent td { padding:4px 8px; font-size:13px; } table.ent td:first-child { font-weight:600; white-space:nowrap; }
  table.ent td:last-child { display:flex; gap:4px; flex-wrap:wrap; }
</style>
<div class="legend" style="margin-bottom:14px"><b>Rights per column:</b> ${ING("ingestor")} the ingestion zone's role · ${ANA("analysis")} api + analyzer ·
  ${MON("pg_monitor")} the metrics exporter · <span class="mono">R</span> read · <span class="mono">W</span> insert/update · <span class="mono">D</span> delete rows.
  Anything not listed is denied.</div>
<p class="small muted" style="margin:-6px 0 14px">The owner role <code>skypulse</code>, used only by the migrate Job, can do everything.</p>
<div class="row">
  <div class="col" style="width:820px">
    ${table("subscriptions", "what analysts follow", [
      ["id", "bigint PK", `${ING("R")} ${ANA("R")} ${MON("R")}`],
      ["kind", "'handle' | 'hashtag'", `${ING("R")} ${ANA("R W")} ${MON("R")}`],
      ["value", "text", `${ING("R")} ${ANA("R W")} ${MON("R")}`],
      ["created_at", "timestamptz", `${ANA("R")} ${MON("R")}`],
      ["last_polled_at", "timestamptz", `${ING("W")} ${ANA("R")} ${MON("R")}`],
      ["last_error", "text", `${ING("W")} ${ANA("R")} ${MON("R")}`],
      ["(rows)", "UNIQUE (kind, value)", `${ANA("insert, D")} <span class="muted small">delete cascades to posts + summary</span>`],
    ])}
    ${table("posts", "the queue: analyzed_at IS NULL = waiting for the LLM", [
      ["id · subscription_id", "bigint · FK ON DELETE CASCADE", `${ANA("R")} ${MON("R subscription_id")}`],
      ["uri · author · text · posted_at", "from Bluesky", `${ING("W insert")} ${ANA("R")}`],
      ["ingested_at", "default now()", `${ING("set on insert")} ${ANA("R")} ${MON("R")}`],
      ["sentiment · score", "label · −1…1", `${ANA("R W")}`],
      ["analyzed_at", "timestamptz", `${ANA("R W")} ${MON("R")}`],
      ["(rows)", "UNIQUE (subscription_id, uri)", `${ING("insert")} ${ANA("D (14-day retention)")}`],
    ])}
    ${table("summaries", "one row per subscription, upserted", [
      ["subscription_id", "PK + FK ON DELETE CASCADE", `${ANA("R W")} ${MON("R")}`],
      ["summary · overall", "LLM text · positive/neutral/negative/mixed", `${ANA("R W")}`],
      ["positive · neutral · negative", "counts", `${ANA("R W")}`],
      ["item_count", "how many posts (brief F3)", `${ANA("R W")} ${MON("R")}`],
      ["window_start · window_end", "oldest / newest post", `${ANA("R W")}`],
      ["updated_at", "when (brief F4)", `${ANA("R W")} ${MON("R")}`],
    ])}
    <div class="box z-data">
      <h3>Four database patterns that replace a message broker</h3>
      <ul class="tight">
        <li><b>Idempotent insert</b>: <code>UNIQUE(subscription_id, uri)</code> + <code>ON CONFLICT DO NOTHING</code>. Re-polling never duplicates.</li>
        <li><b>Work queue</b>: <code>WHERE analyzed_at IS NULL … FOR UPDATE SKIP LOCKED</code> on a partial index. Replicas never take the same post.</li>
        <li><b>One summarizer per subscription</b>: <code>pg_try_advisory_xact_lock(42, id)</code>, released with the transaction.</li>
        <li><b>One migration at a time</b>: <code>pg_advisory_lock(727274)</code> around the migration run.</li>
      </ul>
    </div>
  </div>
  <div class="col grow">
    <h2>The migrate Job: schema + grants, on every deploy</h2>
    <p>Runs in <code>skypulse-data</code> with the owner's URI from the CNPG-generated Secret <code>feeddb-app</code>, the only place that credential exists.
      It is safe to run any number of times: an advisory lock serializes runs ${b("A")}, <code>schema_migrations</code> remembers what's applied ${b("B")},
      and each migration commits together with its version row ${b("C")}. The grants ${b("D")} are re-applied every time, so they can't drift.</p>
    ${code(snip("src/skypulse/db.py", [{ at: "with wait_for_db() as conn:", n: 1 }, { at: 'conn.execute("SELECT pg_advisory_lock', to: 'conn.execute("INSERT INTO schema_migrations' }, { at: "# The internet-facing ingestor may only", to: "finally:" }], {
      marks: { "pg_advisory_lock(%s)": "A", "applied = {row[0]": "B", "with conn.transaction():": "C", 'os.environ.get("INGESTOR_DB_ROLE"': "D" },
    }))}
    <p class="small muted">The roles themselves are created by CloudNativePG from the Secrets of <code>make secrets</code>; <code>_grant()</code> waits for them to exist.
      The tables and indexes themselves are migration 1 in the <code>MIGRATIONS</code> list of the same file.</p>
    ${code(snip("k8s/base/data/migrate.yaml", [{ at: "annotations:", n: 4 }, { at: "args: [\"migrate\"]", to: "key: uri" }], { title: "the Job's only credential" }))}
  </div>
</div>`,
    }),
};
