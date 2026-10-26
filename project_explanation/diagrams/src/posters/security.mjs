import { snip, code, page, b } from "../lib.mjs";

const layer = (n, zone, title, text) => `<div class="step"><div class="n z-${zone}">${n}</div><div><h3 style="font-size:18px;margin-top:6px">${title}</h3>${text}</div></div>`;

export default {
  file: "10-security-boundary.png",
  render: () =>
    page({
      num: 10,
      title: "The security boundary, layer by layer",
      subtitle:
        "The brief: the ingestion side may reach the internet, the analysis side only the analysts' network. Four independent layers " +
        "implement it, and <code>make verify</code> proves it from inside the running pods.",
      body: `
<div class="grid2">
  <div class="col">
    ${layer(1, "plat", "Namespaces = zones", `<p>Each zone is a namespace with a zone label and the <code>restricted</code> Pod Security level ${b("A")}.
      Policies, Secrets and RBAC are all per namespace, so a zone is also the unit of "who can see which password".</p>`)}
    ${code(snip("k8s/base/namespaces.yaml", [{ at: "name: skypulse-analysis", n: 5 }, { at: "name: skypulse-ingestion", n: 5 }], { marks: { "pod-security.kubernetes.io/enforce: restricted": "A" } }))}

    ${layer(2, "ana", "NetworkPolicies: deny everything, then open single paths", `<p>Every namespace uses the same three-step pattern: a <b>default-deny</b> for all pods ${b("B")}, an <b>allow-dns</b>
      rule, then <b>one policy per workload</b> listing exactly who may call it and whom it may call (all paths: poster 4).</p>
      <p>The ingestor's internet rule ${b("C")} allows any address on port 443 <i>except</i> the private, CGNAT and link-local ranges, so a compromised
      ingestor can reach Bluesky but can't scan the LAN or a cloud metadata endpoint. The analysis namespace has no <code>ipBlock</code> rule at all.</p>`)}
    <div class="grid2">
      ${code(snip("k8s/base/analysis/networkpolicies.yaml", [{ at: "name: default-deny-all", n: 6 }], { marks: { "podSelector: {}": "B" } }))}
      ${code(snip("k8s/base/ingestion/networkpolicies.yaml", [{ at: "# The public internet over HTTPS", to: "port: 443 }" }], { marks: { "cidr: 0.0.0.0/0": "C" } }))}
    </div>
  </div>
  <div class="col">
    ${layer(3, "data", "Database least privilege", `<p>Even inside an allowed connection, each zone logs in as its own role. The ingestor can read targets ${b("D")}, record poll status and
      insert posts, nothing more; it can't delete, read summaries, or change the schema. Only the migrate Job, in <code>skypulse-data</code>, holds the owner's
      password. Full column-by-column table: poster 8.</p>`)}
    ${code(snip("src/skypulse/db.py", [{ at: "_grant(conn, os.environ.get(\"INGESTOR_DB_ROLE\"", n: 6 }], { marks: { "GRANT SELECT (id, kind, value) ON subscriptions": "D" } }))}

    ${layer(4, "mon", "Hardened pods", `<p>On every pod SkyPulse defines (most of it required by the <code>restricted</code> level): non-root ${b("E")}, default seccomp filter, no privilege
      escalation, all Linux capabilities dropped, read-only root filesystem (writable <code>emptyDir</code> only where needed). Pods also get no
      Kubernetes API token ${b("F")} (only Prometheus has one, allowed only to get, list and watch pods in two namespaces) and no service-link env vars.</p>`)}
    <div class="grid2">
      ${code(snip("k8s/base/analysis/api.yaml", [{ at: "automountServiceAccountToken: false", n: 1 }, { at: "securityContext:", n: 4 }], { marks: { "runAsNonRoot: true": "E", "automountServiceAccountToken: false": "F" } }))}
      ${code(snip("k8s/base/analysis/api.yaml", [{ at: "allowPrivilegeEscalation: false", n: 4 }], { title: "container level" }))}
    </div>
  </div>
</div>

<div class="section row">
  <div class="col" style="width:760px">
    <h2>Proof, not assumption: <code>make verify</code></h2>
    <p><code>scripts/verify.sh</code> runs a tiny TCP connect ${b("G")} <b>inside the real pods</b> with <code>kubectl exec</code>, so it tests exactly what the
      workloads are allowed to do, and expects some calls to be <b>blocked</b> ${b("H")}. It also tries forbidden SQL with each role, checks that the owner's
      Secret exists only in <code>skypulse-data</code>, that Prometheus scrapes every target, and that replicas run on different nodes.</p>
    ${code(snip("scripts/verify.sh", [{ at: "can_connect() {", n: 13 }], { marks: { "socket.create_connection": "G" } }))}
  </div>
  <div class="col grow">
    ${code(snip("scripts/verify.sh", [{ at: 'echo "== Security boundary: analysis zone', to: 'expect blocked "ingestor -> llm' }], { marks: { 'expect blocked "api      -> internet': "H" } }))}
    <div class="callout z-ana"><b>What is <i>not</i> claimed:</b> NetworkPolicies need a CNI that enforces them (k3s does; Docker Desktop's Kubernetes doesn't).
      Separate clusters or VLANs would isolate the zones even more strongly; the policies map 1:1 onto such firewall rules (DESIGN.md D-6).</div>
  </div>
</div>`,
    }),
};
