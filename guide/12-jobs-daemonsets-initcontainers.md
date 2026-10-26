# 12 · Jobs, CronJobs, DaemonSets and init containers

🟡 Intermediate · ⏱️ 25 min · [← Previous](11-ingress.md) · [Home](../README.md) · [Next: Namespaces, RBAC and Pod Security →](13-namespaces-rbac-security.md)

Not everything is a long-running web server. This chapter covers the other workload shapes.

## Job: run to completion

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: reindex
spec:
  backoffLimit: 3                 # retry up to 3 times on failure
  activeDeadlineSeconds: 600      # give up after 10 minutes
  ttlSecondsAfterFinished: 3600   # garbage-collect the Job (and its pods) after 1h
  completions: 1                  # how many successful pods are needed
  parallelism: 1                  # how many at once
  template:
    spec:
      restartPolicy: OnFailure    # Never | OnFailure (Always is not allowed for Jobs)
      containers:
        - name: reindex
          image: myapp:1.4.2
          args: ["reindex"]
```

```bash
kubectl apply -f job.yaml
kubectl get jobs; kubectl logs job/reindex
kubectl create job manual-backup --from=cronjob/nightly-backup   # run a CronJob now
```

Jobs fit database migrations, data imports, report generation and one-off maintenance. With `completions` + `parallelism` (and `completionMode: Indexed`) they can also fan work out over many pods.

## CronJob: Jobs on a schedule

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: nightly-backup
spec:
  schedule: "30 2 * * *"            # standard cron: 02:30 every day
  timeZone: "Europe/Lisbon"
  concurrencyPolicy: Forbid         # don't start a new run while the previous one is still going
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: backup
              image: postgres:17
              command: ["sh", "-c", "pg_dump \"$DATABASE_URL\" > /backup/$(date +%F).sql"]
```

## DaemonSet: one pod per node

A DaemonSet runs a copy of a pod on **every** node (or every node matching a selector), and adds one automatically when a node joins. Use it for node-level agents:

- log collectors (Fluent Bit, Vector, Promtail)
- monitoring agents (node-exporter)
- networking (CNI plugins, kube-proxy, k3s's `svclb` load-balancer pods)
- storage drivers (CSI node plugins)

```bash
kubectl get daemonsets -A      # in k3s: svclb-traefik-*, one per node
```

Draining a node ignores DaemonSet pods (`kubectl drain --ignore-daemonsets`), since they belong to the node.

## Init containers: "do this first"

Init containers run **to completion, one after another, before** the main containers start. If one fails, the pod restarts it, and the app never starts on a half-prepared environment.

```yaml
spec:
  initContainers:
    - name: wait-for-db
      image: busybox
      command: ["sh", "-c", "until nc -z feeddb-rw 5432; do echo waiting; sleep 2; done"]
    - name: migrate
      image: myapp:1.4.2
      args: ["migrate"]
  containers:
    - name: app
      image: myapp:1.4.2
```

`kubectl get pods` shows `Init:0/2`, `Init:1/2`… and `Init:CrashLoopBackOff` when one keeps failing. Read its logs with `kubectl logs <pod> -c migrate`.

### Database migrations: init container or Job?

| Option | Pros | Cons |
|---|---|---|
| **Init container in the app Deployment** | Simple; migrations always run before the new code starts; no ordering tooling needed | Runs in every pod (must be idempotent and concurrency-safe) |
| **Job before the rollout** | Runs once; clear logs | Needs ordering: CI step, Helm hook or Argo CD sync wave |
| **Run by the app at startup** | Simplest | Slows startup; same concurrency concerns |

> 🔗 **In the project:** migrations are a **Job** ([`data/migrate.yaml`](../skypulse/k8s/base/data/migrate.yaml)) running the app image with `args: ["migrate"]`. It lives in the `skypulse-data` namespace because it needs the schema owner's credentials, which never leave that namespace (an init container in the API would have needed them in the analysis namespace). A Job's pod template is immutable, so `make deploy` deletes the previous run before applying and then waits with `kubectl wait --for=condition=Complete job/migrate`; Argo CD does the same through hook annotations. Meanwhile the API's readiness probe queries a real table, so no pod receives traffic before the schema exists. [`db.py`](../skypulse/src/skypulse/db.py) keeps the migration safe to re-run: a **PostgreSQL advisory lock** serializes concurrent runs, a `schema_migrations` table makes it idempotent, and it waits for the operator to create the `ingestor` and `analysis` roles before granting them permissions. For zero-downtime upgrades, migrations must also be **backward compatible** (expand → deploy → contract), because old and new pods run side by side during a rolling update.

## Sidecar containers (native)

Since Kubernetes 1.29, an init container with `restartPolicy: Always` is a **native sidecar**. It starts before the app and keeps running alongside it, which fixes old ordering problems with log shippers and proxies.

```yaml
initContainers:
  - name: log-shipper
    image: fluent/fluent-bit:3.0
    restartPolicy: Always
```

## Key takeaways

- **Job** = run to completion with retries; **CronJob** = on a schedule.
- **DaemonSet** = one pod per node, for node agents.
- **Init containers** prepare the ground (wait, migrate) before the app starts. Make them idempotent.

[Next: Namespaces, RBAC and Pod Security →](13-namespaces-rbac-security.md)
