import React from "react";
import { SceneDef } from "../engine";
import { BODY, SPLIT } from "../theme";
import { Board, BoxDef } from "../ui/Board";
import { Pipeline } from "../ui/Lists";

const CH = "Start";

const StartPipeline: React.FC = () => (
  <div style={{ paddingTop: 8 }}>
    <Pipeline
      w={SPLIT.visualW}
      title="$ make start"
      steps={[
        { at: 0, label: "`check-tools`", sub: "same check as `make build`" },
        { at: 1, label: "`cluster`", sub: "`k3d cluster create --config cluster/k3d.yaml` (or start it)" },
        { at: 1, label: "wait until every node is Ready", indent: 1 },
        { at: 2, label: "apply `cluster/traefik-ha.yaml`", sub: "ingress controller: 1 → 2 replicas", indent: 1 },
        { at: 3, label: "`operator`", sub: "install CloudNativePG, wait for its controller" },
        { at: 4, label: "`secrets`", sub: "namespaces + one database login per zone" },
        { at: 4, label: "`push`", sub: "both images → the cluster's registry" },
        { at: 4, label: "`deploy`", sub: "apply every manifest, wait for every rollout" },
      ]}
    />
  </div>
);

const nodeChips = (x: number, server: boolean, at1: number, at2: number): BoxDef[] => {
  const items: [string, number][] = server
    ? [["API server", at1], ["scheduler", at1], ["controller-manager", at1], ["SQLite (kine)", at1]]
    : [];
  const common = ["kubelet", "containerd", "kube-proxy", "flannel", "netpol controller"];
  const all = [...items, ...common.map((c) => [c, at2] as [string, number])];
  const top = server ? 300 : 300 + 4 * 0;
  return all.map(([label, at], i) => ({
    id: `${x}-${label}`, kind: "chip", zone: i < items.length ? "build" : "platform", label, x: x + 16, y: top + i * 46, w: 228, h: 38, at, size: 0.82,
  }));
};

const K3d: React.FC = () => (
  <Board
    w={860} h={758} fitW={SPLIT.visualW} fitH={BODY.h}
    boxes={[
      { id: "host", kind: "zone", zone: "internet", label: "your machine · Docker", x: 6, y: 24, w: 848, h: 726, at: 0 },
      { id: "lb", zone: "lan", label: "k3d-skypulse-serverlb", sub: "nginx · localhost:8090 → :80", x: 36, y: 70, w: 380, h: 96, at: 3 },
      { id: "reg", zone: "build", label: "k3d-skypulse-registry", sub: "localhost:5050", x: 446, y: 70, w: 380, h: 96, at: 4 },
      { id: "n0", kind: "zone", zone: "platform", label: "server-0", sub: "control plane + worker", x: 26, y: 226, w: 262, h: 512, at: 0, size: 0.85 },
      { id: "n1", kind: "zone", zone: "platform", label: "agent-0", sub: "worker", x: 299, y: 226, w: 262, h: 512, at: 0, size: 0.85 },
      { id: "n2", kind: "zone", zone: "platform", label: "agent-1", sub: "worker", x: 572, y: 226, w: 262, h: 512, at: 0, size: 0.85 },
      ...nodeChips(36, true, 1, 2),
      ...nodeChips(309, false, 1, 2).map((b) => ({ ...b, y: b.y })),
      ...nodeChips(582, false, 1, 2),
      { id: "p0", kind: "note", label: "pods run **inside** this container", x: 316, y: 560, w: 230, h: 110, at: 2, size: 0.85, align: "center" },
      { id: "p1", kind: "note", label: "pods run **inside** this container", x: 589, y: 560, w: 230, h: 110, at: 2, size: 0.85, align: "center" },
    ]}
    arrows={[
      { id: "l0", from: "lb", to: [157, 236], zone: "lan", at: 3 },
      { id: "l1", from: "lb", to: [430, 236], zone: "lan", at: 3 },
      { id: "l2", from: "lb", to: [703, 236], zone: "lan", at: 3, label: ":80" },
    ]}
  />
);

const Secrets: React.FC = () => (
  <Board
    w={860} h={758} fitW={SPLIT.visualW} fitH={BODY.h}
    boxes={[
      { id: "cnpg", kind: "zone", zone: "data", label: "cnpg-system", x: 10, y: 24, w: 840, h: 116, at: 0 },
      { id: "op", zone: "data", label: "cnpg-controller-manager", sub: "the CloudNativePG operator", x: 200, y: 50, w: 460, h: 76, at: 0 },
      { id: "zd", kind: "zone", zone: "data", label: "skypulse-data", x: 10, y: 190, w: 840, h: 140, at: 1 },
      { id: "di", kind: "chip", zone: "ingestion", label: "ingestor-db-credentials", sub: "operator creates the role", x: 34, y: 232, w: 380, h: 70, at: 3 },
      { id: "da", kind: "chip", zone: "analysis", label: "analysis-db-credentials", sub: "operator creates the role", x: 446, y: 232, w: 380, h: 70, at: 3 },
      { id: "dot", kind: "zone", zone: "build", label: ".secrets/ on your machine", x: 10, y: 380, w: 840, h: 116, at: 2 },
      { id: "pi", kind: "chip", zone: "ingestion", label: "ingestor-password", x: 64, y: 414, w: 320, h: 56, at: 2 },
      { id: "pa", kind: "chip", zone: "analysis", label: "analysis-password", x: 476, y: 414, w: 320, h: 56, at: 2 },
      { id: "zi", kind: "zone", zone: "ingestion", label: "skypulse-ingestion", x: 10, y: 560, w: 410, h: 150, at: 1 },
      { id: "za", kind: "zone", zone: "analysis", label: "skypulse-analysis", x: 440, y: 560, w: 410, h: 150, at: 1 },
      { id: "si", kind: "chip", zone: "ingestion", label: "ingestor-db-credentials", sub: "the pods log in with it", x: 34, y: 604, w: 362, h: 70, at: 3 },
      { id: "sa", kind: "chip", zone: "analysis", label: "analysis-db-credentials", sub: "the pods log in with it", x: 464, y: 604, w: 362, h: 70, at: 3 },
    ]}
    arrows={[
      { id: "x1", from: "pi", to: "si", zone: "ingestion", at: 3 },
      { id: "x2", from: "pi", to: "di", zone: "ingestion", at: 3 },
      { id: "x3", from: "pa", to: "sa", zone: "analysis", at: 3 },
      { id: "x4", from: "pa", to: "da", zone: "analysis", at: 3 },
      { id: "x5", from: "di", to: "op", zone: "data", at: 4, label: "cnpg.io/reload" },
      { id: "x6", from: "da", to: "op", zone: "data", at: 4 },
    ]}
  />
);

const Registry: React.FC = () => (
  <Board
    w={860} h={758} fitW={SPLIT.visualW} fitH={BODY.h}
    boxes={[
      { id: "m", kind: "zone", zone: "internet", label: "your machine", x: 10, y: 24, w: 840, h: 270, at: 0 },
      { id: "dk", zone: "build", label: "your Docker", sub: "skypulse-app:<sha>-<time>\nskypulse-llm:0.35.1-gemma4-…", x: 40, y: 80, w: 330, h: 120, at: 0 },
      { id: "rg", zone: "build", label: "k3d-skypulse-registry", sub: "published on localhost:5050", x: 490, y: 80, w: 330, h: 120, at: 0 },
      { id: "nd", kind: "zone", zone: "platform", label: "node container (server-0 / agent-0 / agent-1)", x: 10, y: 360, w: 840, h: 380, at: 1 },
      { id: "ct", zone: "platform", label: "containerd", sub: "pulls image: localhost:5050/…", x: 40, y: 430, w: 330, h: 110, at: 1 },
      { id: "self", kind: "chip", zone: "platform", label: "localhost = the node itself", x: 470, y: 450, w: 350, h: 70, at: 1, until: 2 },
      { id: "mirror", kind: "chip", zone: "build", label: "mirror → k3d-skypulse-registry:5000", x: 420, y: 450, w: 410, h: 70, at: 2 },
      { id: "pod", zone: "analysis", label: "pod starts", sub: "image found, no internet used", x: 40, y: 600, w: 330, h: 100, at: 3 },
    ]}
    arrows={[
      { id: "push", from: "dk", to: "rg", label: "docker push", zone: "build", at: 0 },
      { id: "bad", from: "ct", to: "self", blocked: true, at: 1, until: 2 },
      { id: "pull", from: "ct", to: "mirror", zone: "build", at: 2 },
      { id: "pull2", from: "mirror", to: "rg", zone: "build", at: 2, label: "pull" },
      { id: "run", from: "ct", to: "pod", zone: "analysis", at: 3 },
    ]}
  />
);

const Deploy: React.FC = () => (
  <div style={{ paddingTop: 8 }}>
    <Pipeline
      w={SPLIT.visualW}
      title="$ make deploy"
      steps={[
        { at: 0, label: "write `.build/deploy/kustomization.yaml`", sub: "`overlays/local` + the exact tags just built" },
        { at: 1, label: "new tag → new pod template", sub: "every deploy is a real rolling update", indent: 1 },
        { at: 2, label: "`kubectl delete job migrate`", sub: "a Job's pod template is immutable" },
        { at: 3, label: "`kubectl apply -k .build/deploy`", sub: "Kustomize renders base + overlays → API server" },
        { at: 4, label: "wait: PostgreSQL `Cluster` Ready" },
        { at: 4, label: "wait: Job `migrate` Complete", indent: 1 },
        { at: 4, label: "wait: api, analyzer, ingestor, llm rolled out", indent: 1 },
        { at: 4, label: "wait: Prometheus, Grafana rolled out", indent: 1 },
        { at: 5, label: "http://localhost:8090", sub: "and Grafana on http://grafana.localhost:8090" },
      ]}
    />
  </div>
);

export const START: SceneDef[] = [
  {
    id: "make-start", chapter: CH, title: "`make start`: six steps", View: StartPipeline,
    beats: [
      { say: "`make start` is a single line of the Makefile: `check-tools`, then `cluster`, `operator`, `secrets`, `push` and `deploy`, in that order.", code: "mk_start", focus: ["start: check-tools"] },
      { say: "`cluster` creates the k3d cluster from `cluster/k3d.yaml`, or just starts it if it exists, then waits until every node reports Ready.", focus: ["k3d cluster create", "kubectl wait --for=condition=Ready nodes"] },
      { say: "It then applies `cluster/traefik-ha.yaml`, which raises the bundled ingress controller from one replica to two.", focus: ["kubectl apply -f cluster/traefik-ha.yaml"] },
      { say: "`operator` installs CloudNativePG from its release manifest and waits for its controller. The next scenes take each step in turn.", focus: ["$(CNPG_MANIFEST)", "cnpg-controller-manager"] },
      { say: "Then `secrets`, `push` and `deploy`. Every step is idempotent, so you can run `make start` again on an existing cluster." },
    ],
  },
  {
    id: "k3d", chapter: CH, title: "The cluster: k3s nodes as Docker containers", View: K3d,
    beats: [
      { say: "`k3d` runs Kubernetes nodes as Docker containers. `cluster/k3d.yaml` asks for **one server and two agents**: three \"machines\" on your laptop, each running k3s.", code: "k3d", focus: ["servers: 1", "agents: 2"] },
      { say: "k3s is a lightweight, certified Kubernetes. The server also runs the control plane: API server, scheduler, controller-manager, and the datastore, SQLite through kine.", focus: ["image: rancher/k3s"] },
      { say: "Every node runs a kubelet, containerd, kube-proxy, flannel for the pod network, and the **network policy controller** that will enforce the security zones.", focus: ["agents: 2"] },
      { say: "A load balancer container, `k3d-skypulse-serverlb`, maps `localhost:8090` on your machine to port 80 on the nodes. That's how the browser gets in.", focus: ["- port: 8090:80", "- loadbalancer"], flow: ["l0", "l1", "l2"] },
      { say: "And a private registry, `k3d-skypulse-registry`, on `localhost:5050`, like the Harbor or Zot an on-prem site would run.", focus: ["name: k3d-skypulse-registry", 'hostPort: "5050"'], hl: ["reg"] },
      { say: "One control plane is a single point of failure, accepted locally because all nodes share one laptop anyway. Production runs three servers with embedded etcd: a quorum of two survives losing one.", focus: ["servers: 1"], hl: ["n0"] },
      { say: "k3s installs Traefik with one replica, yet every analyst request goes through it. `traefik-ha.yaml`, a `HelmChartConfig`, runs two, spread over nodes, with a PodDisruptionBudget.", code: "traefik_ha", focus: ["replicas: 2", "minAvailable: 1", "whenUnsatisfiable: DoNotSchedule"] },
    ],
  },
  {
    id: "secrets", chapter: CH, title: "The operator, the zones and their logins", View: Secrets,
    beats: [
      { say: "`make operator` applies the CloudNativePG manifest. Its controller runs in `cnpg-system` and will turn a short `kind: Cluster` into a replicated PostgreSQL.", code: "mk_start", focus: ["$(CNPG_MANIFEST)", "cnpg-controller-manager"], hl: ["op"] },
      { say: "`make secrets` first applies `namespaces.yaml`, so the zones exist: each one labelled `pod-security.kubernetes.io/enforce: restricted`.", code: "mk_secrets", focus: ["kubectl apply -f k8s/base/namespaces.yaml"] },
      { say: "For each zone role, `ingestor` and `analysis`, it generates a random password **once**, into `.secrets/`. Running it again keeps the same one.", focus: ["test -s .secrets/$$role-password"], hl: ["pi", "pa"] },
      { say: "Each password becomes a Secret in **two** namespaces: `skypulse-data`, where the operator creates the database role from it, and the zone's own, where the pods log in with it.", focus: ["for ns in $(NS_D) $$zone_ns", "create secret generic $$role-db-credentials"], flow: ["x1", "x2", "x3", "x4"] },
      { say: "Neither zone ever holds the other's password. The `cnpg.io/reload` label tells the operator to pick up a password change.", focus: ["cnpg.io/reload=true"], flow: ["x5", "x6"] },
    ],
  },
  {
    id: "push", chapter: CH, title: "`make push`: from your Docker to the nodes", View: Registry,
    beats: [
      { say: "`make push` pushes both images, by the tags saved in `.build/`, to `localhost:5050`: the registry container k3d created.", code: "mk_push", focus: ["docker push $(APP_IMAGE)", "docker push $(LLM_IMAGE)"], flow: ["push"] },
      { say: "Pulling is the tricky part. The manifests say `image: localhost:5050/…`, but inside a node container, `localhost` is the **node itself**, not your machine.", code: "k3d", focus: ['"localhost:5050":'], flow: ["bad"] },
      { say: "`cluster/k3d.yaml` fixes it with a registry mirror: containerd in each node redirects `localhost:5050` to `k3d-skypulse-registry:5000` on the Docker network.", focus: ["- http://k3d-skypulse-registry:5000"], flow: ["pull", "pull2"] },
      { say: "So the same image name works for `docker push` on your machine and for the pull inside the cluster. In production, CI pushes to the site's registry instead, where images are scanned and signed.", flow: ["run"] },
    ],
  },
  {
    id: "deploy", chapter: CH, title: "`make deploy`: apply, then wait in order", View: Deploy,
    beats: [
      { say: "`make deploy` writes a throw-away overlay, `.build/deploy/kustomization.yaml`, on top of `overlays/local`, pinning the exact tags just built.", code: "mk_deploy", focus: ["../../k8s/overlays/local", "app-tag)", "llm-tag)"] },
      { say: "Every deploy therefore changes the image tag, and so the pod templates: a real rolling update, never a silent no-op.", focus: ["newTag"] },
      { say: "It deletes the previous `migrate` Job first: a Job's pod template is immutable, so a new image couldn't be applied over it.", focus: ["delete job migrate"] },
      { say: "`kubectl apply -k` lets Kustomize render the base plus the overlays, and sends every object to the API server.", focus: ["kubectl apply -k $(BUILD_DIR)/deploy"] },
      { say: "Then it waits, in order: the Postgres `Cluster` Ready, the `migrate` Job Complete, then each Deployment rolled out.", focus: ["wait cluster.postgresql.cnpg.io/feeddb", "wait job/migrate", "rollout status deployment/"] },
      { say: "When it returns, SkyPulse answers on `http://localhost:8090`. But a lot happened inside the cluster in between: that's the next chapter." },
    ],
  },
];
