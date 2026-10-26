import { snip, code, page, b } from "../lib.mjs";

const failRow = (what, who, how) => `<tr><td><b>${what}</b></td><td>${who}</td><td>${how}</td></tr>`;

export default {
  file: "09-loops-and-resilience.png",
  render: () =>
    page({
      num: 9,
      title: "The worker loops, and what happens when things break",
      subtitle:
        "The ingestor and the analyzer are endless loops that expect failure: every exception they know has a planned reaction, " +
        "and Kubernetes restarts them only if the loop itself stops turning. The api survives database failovers through its connection pool.",
      body: `
<div class="grid2">
  <div class="col">
    <h2><span class="pill z-ing">ingestor</span> <code>ingestor.run()</code></h2>
    <p>Start: heartbeat, HTTP client, connect with retries ${b("A")}. Each turn: one <code>poll_once()</code> (poster 6), then heartbeat and sleep 60 s.
      Missing schema on first install ${b("B")} → wait 5 s and retry. Lost connection, e.g. during a database failover ${b("C")} → reconnect.
      Bluesky errors never get here: <code>poll_once()</code> catches them per target and writes them to <code>last_error</code>.</p>
    ${code(snip("src/skypulse/ingestor.py", [{ at: "def run()", to: "time.sleep(settings.poll_interval_seconds)" }], {
      marks: { "conn = db.wait_for_db()": "A", "except (psycopg.errors.UndefinedTable": "B", "except psycopg.OperationalError as exc:": "C" },
    }))}
  </div>
  <div class="col">
    <h2><span class="pill z-ana">analyzer</span> <code>analyzer.run()</code></h2>
    <p>Same shape, one more failure: the LLM. If Ollama is down or restarting ${b("D")}, the transaction is rolled back (the claimed post goes back to the queue)
      and it retries in 5 s. It only sleeps when a round found nothing to do ${b("E")}, so a backlog drains at full speed.</p>
    ${code(snip("src/skypulse/analyzer.py", [{ at: "def run()", to: "if not did_work:" }, { at: "time.sleep(5)", n: 1 }], {
      marks: { "except httpx.HTTPError as exc:": "D", "if not did_work:": "E" },
    }))}
  </div>
</div>

<div class="row section">
  <div class="col" style="width:760px">
    <h2>The shared helpers in <code>db.py</code></h2>
    <p><code>wait_for_db()</code> retries every 3 s for up to 5 minutes, which covers "the database is still starting after a deploy". If it never comes,
      it raises, the process exits and Kubernetes restarts the pod.</p>
    ${code(snip("src/skypulse/db.py", [{ at: "def connect(", n: 3 }, { at: "def wait_for_db(", to: "time.sleep(3)" }]))}
  </div>
  <div class="col grow">
    <h2><span class="pill z-ana">api</span> A pool that heals itself</h2>
    <p>The api never holds a connection across requests: it borrows one from a pool. <code>check=</code> ${b("A")} tests each connection before handing it out,
      so after a failover the connections to the old primary are silently replaced. <code>open(wait=False)</code> ${b("B")} lets the process start even if the
      database isn't up yet; <code>/readyz</code> keeps it out of the load balancer until it is (poster 5).</p>
    ${code(snip("src/skypulse/api.py", [{ at: "pool = ConnectionPool(", to: "pool.close()" }], { marks: { "check=ConnectionPool.check_connection": "A", "pool.open(wait=False)": "B" } }))}
  </div>
</div>

<div class="section">
  <h2>Failure playbook: who notices, what happens</h2>
  <table class="t">
    <tr><th style="width:250px">What breaks</th><th style="width:330px">Who notices</th><th>What happens</th></tr>
    ${failRow("Bluesky slow, down, or a handle doesn't exist", "<code>poll_once()</code> per target", "Error stored in <code>subscriptions.last_error</code>, shown on the analyst's card; other targets keep polling; retried next round.")}
    ${failRow("Ollama restarting / overloaded", "analyzer: <code>httpx.HTTPError</code>", "Rollback, retry in 5 s. Posts wait in the queue (<code>posts_pending</code> metric). Analysts still see the last summaries.")}
    ${failRow("One post the LLM rejects", "analyzer: <code>HTTPStatusError</code> in <code>analyze_one()</code>", "That post is marked neutral so it can't block the queue.")}
    ${failRow("PostgreSQL primary dies", "CloudNativePG", "Promotes the replica; <code>feeddb-rw</code> follows it. Workers get <code>OperationalError</code> → reconnect; the api pool replaces stale connections. Measured: 0 failed api requests.")}
    ${failRow("First install: tables not there yet", "workers: <code>UndefinedTable</code> / <code>InsufficientPrivilege</code>; api: <code>/readyz</code> fails", "Workers wait 5 s and retry; api pods stay out of the Service until the migrate Job has run.")}
    ${failRow("A worker loop hangs", "liveness probe: <code>/tmp/heartbeat</code> older than 600 s", "Kubernetes restarts the container.")}
    ${failRow("An api pod or a node goes away", "readiness probe, Deployment, PDB, HPA", "Traffic goes to the other replicas (≥ 2, on different nodes); a drain can never evict the last one; a replacement is scheduled.")}
    ${failRow("Two replicas of a worker", "nothing to notice", "Inserts are idempotent, posts are claimed with <code>SKIP LOCKED</code>, summaries with an advisory lock: no double work.")}
  </table>
</div>`,
    }),
};
