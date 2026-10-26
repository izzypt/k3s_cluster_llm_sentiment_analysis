# Kubernetes operations handbook: beyond the project

A companion to the guide and to SkyPulse. The guide teaches the concepts one at a time and the project uses them; **this file collects the operational knowledge around them**: core concepts in short form, common errors and how to fix them, a debugging method, Linux and networking, containers, delivery, observability, security, air-gapped and on-prem operations, PostgreSQL incidents, worked incident scenarios, small design questions and flashcards.

It's written from the point of view of someone who deploys and runs Kubernetes **in someone else's environment**: on-premises, often without internet access, and responsible for everything *from the application down to storage and networking*.

## Contents

1. [Kubernetes: core concepts](#1-kubernetes-core-concepts)
2. [Kubernetes: common errors and how to fix them](#2-kubernetes-common-errors-and-how-to-fix-them)
3. [The debugging method and toolkit](#3-the-debugging-method-and-toolkit)
4. [Linux and networking](#4-linux-and-networking)
5. [Containers and images](#5-containers-and-images)
6. [Cluster operations: upgrades, certificates, backups](#6-cluster-operations-upgrades-certificates-backups)
7. [Air-gapped and on-prem specifics](#7-air-gapped-and-on-prem-specifics)
8. [IaC, CI/CD and release strategies](#8-iac-cicd-and-release-strategies)
9. [Observability and incident response](#9-observability-and-incident-response)
10. [Security](#10-security)
11. [PostgreSQL in production: incidents](#11-postgresql-in-production-incidents)
12. [Incident scenarios: walk-throughs to practise](#12-incident-scenarios-walk-throughs-to-practise)
13. [Small design questions](#13-small-design-questions)
14. [Rapid-fire flashcards](#14-rapid-fire-flashcards)

---

## 1. Kubernetes: core concepts

### 1.1 Architecture

**Q: What happens when you run `kubectl apply -f deployment.yaml`?**
1. kubectl sends the object to the **API server**, which authenticates you, checks RBAC, runs admission controllers (Pod Security, policy engines, defaults), and stores it in **etcd**.
2. The **Deployment controller** (in `kube-controller-manager`) sees it and creates a **ReplicaSet**; the ReplicaSet controller creates **Pod** objects.
3. The **scheduler** sees Pods with no node, filters nodes (resources, taints, affinity) and scores them, then writes the chosen node into each Pod.
4. The **kubelet** on that node sees the Pod, asks the container runtime (**containerd**) to pull the image and start the containers, sets up networking through the **CNI** plugin and volumes through **CSI**, and runs the probes.
5. When readiness passes, the **EndpointSlice controller** adds the Pod IP to its Service, and **kube-proxy** (or the CNI) updates the routing rules on every node.

Key point: **nothing is called directly.** Every component watches the API server and reconciles desired state against actual state.

**Q: What's in the control plane, and what happens if it goes down?**
- API server, etcd, scheduler, controller manager (+ cloud controller manager in clouds).
- If it's down, **running Pods keep running** (the kubelet and the data path don't need it), but nothing new is scheduled, failed Pods aren't replaced, Service endpoints stop updating and `kubectl` doesn't work.
- That's why production runs **3 control-plane nodes**: etcd needs a **quorum** (majority), so 3 nodes survive 1 failure and 5 survive 2. An even number doesn't help (4 still only survives 1).

**Q: What is etcd and why does it matter?**
A consistent, distributed key-value store holding **all cluster state**. Lose it without a backup and you lose the cluster's definition (not the app data on volumes). Back it up (`etcdctl snapshot save`, or `k3s etcd-snapshot save`), keep it on fast disks (it's sensitive to disk latency), and encrypt Secrets at rest.

### 1.2 Workload types

| Type | Use for | Key property |
|---|---|---|
| **Deployment** | Stateless apps | Interchangeable Pods, rolling updates via ReplicaSets |
| **StatefulSet** | Databases, queues, anything with identity | Stable names (`db-0`, `db-1`), **one PVC per Pod** (`volumeClaimTemplates`), ordered start and stop, needs a headless Service |
| **DaemonSet** | One Pod per node: log shippers, CNI, node exporters, GPU device plugins | Follows nodes as they join or leave |
| **Job** | Run to completion: migrations, batch work | Retries up to `backoffLimit` |
| **CronJob** | Scheduled Jobs: backups, reports | `concurrencyPolicy`, history limits |

**Q: Why not just run a database as a Deployment with a PVC?** With `ReadWriteOnce` storage, two Pods can't mount it, and a rolling update would deadlock (the new Pod waits for the volume the old one holds). It has no stable identity for replication either. A StatefulSet gives identity and storage per Pod, but **still no failover logic**. That's why operators exist (CloudNativePG, Strimzi for Kafka…).

### 1.3 Services and networking

| Service type | What it does |
|---|---|
| **ClusterIP** (default) | A stable virtual IP and DNS name inside the cluster |
| **NodePort** | Also opens a port (30000–32767) on every node |
| **LoadBalancer** | Also asks for an external IP (cloud LB, or **MetalLB** / ServiceLB on-prem) |
| **Headless** (`clusterIP: None`) | No virtual IP; DNS returns the Pod IPs directly (StatefulSets, client-side balancing) |
| **ExternalName** | A DNS CNAME to an outside name |

**Q: How does a Service actually route traffic?** A Service is just a selector plus a virtual IP. The EndpointSlice controller tracks the **ready** Pods matching the selector; kube-proxy (iptables or IPVS mode) or an eBPF CNI (Cilium) rewrites packets sent to the virtual IP to one of those Pod IPs. There's no proxy process in the path by default.

**Q: Ingress vs Gateway API?** Ingress is the older, simpler HTTP routing API; features beyond host and path live in controller-specific annotations. **Gateway API** is its successor: role-oriented (the platform team owns the `Gateway`, app teams own `HTTPRoute`s), with header matching, traffic splitting, TCP/gRPC routes, and no annotation sprawl. Also worth knowing: the community **ingress-nginx** controller has been retired, so new installs are moving to Gateway API implementations or other controllers.

**Q: How do Pods talk to each other?** Every Pod gets its own IP, and every Pod can reach every other Pod without NAT (the Kubernetes network model). The **CNI plugin** makes that true: Flannel (simple overlay, **no NetworkPolicy support on its own**), Calico (BGP or overlay, policies), Cilium (eBPF, policies, observability).

**Q: What does a NetworkPolicy do, and what's the classic trap?** It selects Pods and allow-lists traffic in and/or out. Once a Pod is selected by any policy for a direction, everything not allowed is denied. Traps:
- **The CNI must enforce it.** Flannel alone or Docker Desktop's Kubernetes accept the objects and ignore them.
- **Default-deny egress also blocks DNS.** Always add a rule for CoreDNS on port 53 (UDP **and** TCP).
- Policies only see **Pod traffic**. Node traffic (kubelet probes, image pulls) isn't filtered.

**Q: How does DNS work in a Pod?** `/etc/resolv.conf` points at CoreDNS, with search domains (`<ns>.svc.cluster.local`, `svc.cluster.local`, `cluster.local`) and `options ndots:5`. So a name with fewer than 5 dots is tried with each search domain first: `api.example.com` triggers several failed lookups before the real one. Fix in hot paths: use a fully qualified name with a trailing dot, or lower `ndots` in `dnsConfig`.

### 1.4 Configuration and secrets

- **ConfigMap**: non-secret config, as environment variables or files.
- **Secret**: **base64 is encoding, not encryption.** Anyone who can read the Secret, or etcd, can read the value. Protect with: RBAC (who can `get secrets`), **encryption at rest** (`EncryptionConfiguration`, ideally KMS), and external managers (Vault + External Secrets Operator, Sealed Secrets, SOPS) so plain secrets never sit in Git.
- **Environment variables vs mounted files:** env vars are fixed at container start; mounted files update when the ConfigMap/Secret changes (not with `subPath`), but the app has to re-read them. A common pattern is to roll the Pods when config changes (a hash in the name or an annotation).

### 1.5 Probes

| Probe | Question it answers | On failure |
|---|---|---|
| **Startup** | "Has it finished starting?" | Liveness and readiness are held off until it passes; if it never does, restart |
| **Readiness** | "Should it get traffic right now?" | Removed from Service endpoints; **not restarted** |
| **Liveness** | "Is it stuck beyond recovery?" | Container **restarted** |

**The classic mistake:** a liveness probe that checks the database. If the database blips, every Pod restarts at once, which turns a short blip into an outage (a cascading failure). Dependencies belong in **readiness**; liveness should only check the process itself.

### 1.6 Resources, QoS and eviction

- **Requests** are what the scheduler reserves; **limits** are the ceiling enforced at runtime.
- **CPU over the limit → throttled** (slower, not killed). Some teams set CPU requests but no CPU limit to avoid throttling latency-sensitive apps.
- **Memory over the limit → OOMKilled** (exit code 137). Memory can't be throttled.
- **QoS classes** decide who's evicted first when a node runs short:
  - **Guaranteed**: requests = limits for CPU and memory in every container (evicted last);
  - **Burstable**: some requests set;
  - **BestEffort**: nothing set (evicted first).
- **Node pressure eviction:** the kubelet evicts Pods when memory, disk or PIDs run low (`Evicted` status, `DiskPressure` condition).

### 1.7 Scheduling

- **nodeSelector / node affinity**: run on nodes with these labels (e.g. `gpu=true`).
- **Pod anti-affinity**: don't put two replicas together (`required` = hard, `preferred` = soft).
- **Topology spread constraints**: spread evenly across nodes or zones (`maxSkew`).
- **Taints and tolerations**: a taint **repels** Pods; only Pods that tolerate it may land there. Use for dedicated nodes (GPU, control plane). A toleration *allows* scheduling there; it doesn't *force* it, so combine it with affinity.
- **PriorityClass**: higher-priority Pods can **preempt** (evict) lower ones when the cluster is full.

### 1.8 Availability tools

- **Rolling update:** `maxSurge` (extra Pods during the update) and `maxUnavailable`. `maxUnavailable: 0` + readiness probes = no capacity loss.
- **PodDisruptionBudget**: limits **voluntary** disruptions (`kubectl drain`, cluster upgrades). It doesn't protect against node crashes. A PDB with `minAvailable` equal to the replica count makes drains hang forever.
- **Graceful shutdown:** on delete, the Pod is removed from endpoints **and** sent SIGTERM at the same time, so for a moment traffic can still arrive. Fix: a short `preStop` sleep, then the app handles SIGTERM and finishes in-flight requests within `terminationGracePeriodSeconds` (default 30 s), after which it gets SIGKILL.
- **Rollback:** `kubectl rollout undo deployment/x` (or revert in Git with GitOps).

### 1.9 Scaling

- **HPA**: scales replicas on CPU/memory (needs **metrics-server** and **requests** set) or custom metrics (Prometheus Adapter, KEDA for queue length).
- **VPA**: adjusts requests and limits; don't run it on the same metric as the HPA.
- **Cluster Autoscaler / Karpenter**: adds nodes in clouds. **On-prem with fixed hardware there's nothing to add**, so capacity planning, quotas (`ResourceQuota`, `LimitRange`) and priorities matter much more.

### 1.10 Storage

- **PV** (a real volume), **PVC** (a request for one), **StorageClass** (how to create PVs on demand: the provisioner and its parameters).
- **Access modes:** `ReadWriteOnce` (one node), `ReadWriteMany` (many nodes, needs NFS, CephFS…), `ReadOnlyMany`, `ReadWriteOncePod`.
- **`volumeBindingMode: WaitForFirstConsumer`**: the PVC stays `Pending` until a Pod uses it, so the volume is created where the Pod is scheduled. That's normal, not a bug.
- **`reclaimPolicy`**: `Delete` (the volume goes with the PVC) or `Retain` (keep the data; safer for databases).
- **On-prem options:** local-path (simple, tied to one node), Longhorn (replicated block storage), Rook-Ceph (block, file and object; powerful but complex), NFS (easy RWX, a single point of failure unless the NFS itself is HA).

### 1.11 Access control

- **RBAC:** `Role`/`ClusterRole` (verbs on resources) bound to users, groups or **ServiceAccounts** with `RoleBinding`/`ClusterRoleBinding`. Check with `kubectl auth can-i list pods --as=system:serviceaccount:ns:sa`.
- **ServiceAccount tokens:** a Pod's identity for the API. Disable automounting (`automountServiceAccountToken: false`) when the app never calls the API.
- **Pod Security Standards** (`privileged` / `baseline` / `restricted`), enforced per namespace by label. PodSecurityPolicy was removed in 1.25.
- **Policy engines** (Kyverno, OPA Gatekeeper): custom rules at admission, e.g. "images must come from our registry and be signed", "every Pod needs resource limits".

### 1.12 Extending Kubernetes

- **CRD**: a new object type (`kind: Cluster`).
- **Operator**: a controller that watches that type and encodes operational knowledge (failover, backups, upgrades).
- **Helm vs Kustomize:** Helm = templating + packaging + release tracking (charts are a distribution format, and OCI registries can hold them, which helps offline). Kustomize = patches over plain YAML, built into kubectl. Many teams use both: vendor software from Helm charts, their own apps with Kustomize.
- **GitOps (Argo CD / Flux):** the cluster **pulls** its desired state from Git and corrects drift. Good for air-gapped sites: no inbound access needed, Git is the audit trail, and rollback is `git revert`.

---

## 2. Kubernetes: common errors and how to fix them

**Always start with:** `kubectl get pods -o wide`, `kubectl describe pod <p>` (**read the Events at the bottom**), `kubectl logs <p> --previous`, `kubectl get events -n <ns> --sort-by=.lastTimestamp`.

### 2.1 Pod status cheat sheet

| Symptom | What it means | Likely causes | How to find out | Fix |
|---|---|---|---|---|
| **`ImagePullBackOff` / `ErrImagePull`** | The node can't get the image | Typo in name or tag; private registry without `imagePullSecrets`; registry unreachable from the **node** (DNS, firewall, proxy); untrusted TLS (internal CA not on the node); **wrong CPU architecture** (arm64 vs amd64, shows as `exec format error` once running); rate limits (Docker Hub); signature policy rejected it | `describe pod` Events show the exact registry error. On the node: `crictl pull <image>` | Fix the reference or credentials; mirror the image to the internal registry; add the CA to the node's trust store or containerd config; build multi-arch |
| **`CrashLoopBackOff`** | The container starts, exits, and restarts with growing delays (up to 5 min) | App error at startup (missing env var, bad config, can't reach a dependency and exits); wrong command; permissions (read-only filesystem, non-root user can't write); liveness probe killing it | `logs --previous` (the crashed run); `describe` → **Last State: exit code**; run the image locally with the same env | Fix the config; make the app retry dependencies instead of exiting; give it writable `emptyDir` mounts; fix the probe |
| **`OOMKilled`** (exit 137) | Went over its memory limit | Limit too low; memory leak; JVM/Python not aware of the container limit; a big request or file loaded fully into memory | `describe` → `Reason: OOMKilled`; `kubectl top pod`; memory graph over time (rising sawtooth = leak) | Right-size from real usage; fix the leak; stream instead of loading; set runtime memory flags (e.g. `-XX:MaxRAMPercentage`) |
| **`Pending`** | Not scheduled yet | `Insufficient cpu/memory` (requests too big for any node); taints with no toleration; node affinity or anti-affinity impossible to satisfy; **PVC not bound**; ResourceQuota exceeded | `describe pod` → `FailedScheduling` message says exactly why (e.g. `0/3 nodes are available: 3 Insufficient memory`) | Lower requests or add capacity; add the toleration; relax `required` to `preferred`; fix the PVC (below) |
| **`ContainerCreating`** for a long time | Scheduled but can't start | Large image still pulling; volume can't attach or mount (RWO volume still attached to another node, NFS unreachable); missing Secret/ConfigMap used as a **volume**; CNI failure (`failed to set up sandbox`) | `describe` Events | Wait or pre-pull; force-detach the volume after confirming the old node is really dead; create the missing object; check the CNI Pods |
| **`CreateContainerConfigError`** | Can't build the container's config | A referenced Secret/ConfigMap or **key** doesn't exist (as an env var) | `describe` → `secret "x" not found` / `couldn't find key` | Create it, fix the key name, or mark it `optional: true` |
| **`Init:CrashLoopBackOff` / `Init:0/1`** | An init container fails or waits forever | Waiting on a dependency that never comes up; migration failing | `logs <pod> -c <init-container>` | Fix the dependency or the migration |
| **`Evicted`** | The kubelet removed it under node pressure | Node disk full (logs, images, `emptyDir`), memory pressure | `describe node` → Conditions (`DiskPressure`, `MemoryPressure`); `df -h` on the node | Clean images (`crictl rmi --prune`), log rotation, `ephemeral-storage` limits, bigger disks |
| **`Terminating`** forever | Can't finish deletion | **Finalizers** waiting on a controller that's gone; node unreachable (the kubelet never confirms); a process ignoring SIGTERM | `kubectl get pod -o yaml` → `finalizers`, `deletionTimestamp`; node status | Fix or restore the controller; for a dead node, `kubectl delete pod --grace-period=0 --force` **after** confirming the node is really down (StatefulSets: risk of two writers) |
| **`Running` but 0/1 `READY`** | Readiness probe failing | Wrong path or port; app not listening on `0.0.0.0`; a dependency down (if readiness checks it); slow start | `describe` → `Readiness probe failed: …`; `kubectl exec` and `curl localhost:<port>/path` | Fix the probe, the bind address, or add a startupProbe |
| **`Completed`** in a Deployment | The main process exited with 0 | The container is a script, not a long-running server; a command override that returns | `logs` | Run in the foreground; use a Job if it should finish |

### 2.2 Container exit codes

| Code | Meaning |
|---|---|
| 0 | Exited normally (a problem only if it was meant to keep running) |
| 1 | Generic application error: read the logs |
| 126 | Command found but not executable (permissions, wrong format) |
| 127 | Command not found (typo, missing binary, wrong `PATH`, a distroless image with no shell) |
| 137 | 128 + 9 = **SIGKILL**: OOMKilled, or killed after the grace period |
| 139 | 128 + 11 = **SIGSEGV**: crashed (native code, wrong architecture, broken library) |
| 143 | 128 + 15 = **SIGTERM**: asked to stop (normal during rollouts and drains) |

### 2.3 Services, Ingress and DNS

| Symptom | Likely causes | How to find out |
|---|---|---|
| **Service doesn't answer**, other Pods get "connection refused" or time out | **Selector doesn't match the Pod labels** (endpoints are empty); `targetPort` wrong; Pods not ready; NetworkPolicy blocking; app listening on `127.0.0.1` | `kubectl get endpointslices -l kubernetes.io/service-name=<svc>` (empty = selector or readiness problem); `kubectl exec` into a debug Pod: `curl <svc>.<ns>:<port>`, then curl the Pod IP directly |
| **Ingress returns 404** | No rule matches the host or path; wrong `ingressClassName`; path type (`Prefix` vs `Exact`) | `kubectl describe ingress`; the controller's logs |
| **Ingress returns 502 / 503** | Backend Service has no ready endpoints; wrong service port; backend uses HTTPS but the controller speaks HTTP; NetworkPolicy blocks the ingress controller | Endpoints; controller logs; test from the controller's namespace |
| **Ingress returns 504** | Backend too slow; controller timeout too short | Backend latency; controller timeout settings |
| **DNS fails** (`could not resolve host`, `SERVFAIL`) | CoreDNS Pods down or overloaded; NetworkPolicy blocks port 53 (**UDP and TCP**); upstream DNS unreachable (common on air-gapped sites); `ndots` causing slow lookups; conntrack races on UDP | `kubectl exec <pod> -- nslookup kubernetes.default`; CoreDNS logs; `cat /etc/resolv.conf` in the Pod |
| **Works for small requests, hangs on large ones** | **MTU mismatch**: overlay (VXLAN adds 50 bytes) on a network with a smaller MTU, ICMP "fragmentation needed" blocked, so Path MTU Discovery fails (a "black hole") | `ping -M do -s 1472 <ip>` to find the largest packet that passes; compare the CNI MTU to the underlay MTU |

### 2.4 Deployments, Jobs, autoscaling, storage, access

| Symptom | Likely causes | How to find out / fix |
|---|---|---|
| **Rollout stuck** (`Waiting for deployment … to finish`) | New Pods never become ready (bad image, config, probe); not enough capacity for `maxSurge`; a PDB blocking | `kubectl rollout status`; `describe` the new Pods; `rollout undo` to recover first, then investigate |
| **Job `BackoffLimitExceeded`** | The task keeps failing | `logs` of the failed Pods (`kubectl get pods -l job-name=<job>`) |
| **HPA shows `<unknown>`** for targets | metrics-server not installed or not working; **no CPU requests** on the containers | `kubectl top pods`; `describe hpa` |
| **PVC `Pending`** | No default StorageClass; the provisioner isn't running; `WaitForFirstConsumer` (normal until a Pod uses it); no PV matches the size or access mode | `describe pvc`; `kubectl get storageclass` |
| **`Multi-Attach error` for volume** | An RWO volume is still attached to another node (often after a node crash) | Confirm the old node is down, then let the attach-detach controller time out or delete the `VolumeAttachment` |
| **`forbidden: User … cannot list resource …`** | RBAC missing for that user or ServiceAccount | `kubectl auth can-i <verb> <resource> --as=<subject> -n <ns>`; add a Role/RoleBinding with the least privilege needed |
| **`x509: certificate signed by unknown authority`** | Internal CA not trusted (by the client, the node, or the container image) | Add the CA bundle to the trust store or the client's config |
| **`x509: certificate has expired or is not yet valid`** | Expired certificate, **or clock skew** | Check `date` on both sides and NTP; check expiry with `openssl x509 -enddate -noout` |
| **Node `NotReady`** | Kubelet stopped or crashed; container runtime down; disk full; expired kubelet certificate; network to the API server broken; clock skew | `kubectl describe node`; on the node: `systemctl status kubelet`, `journalctl -u kubelet -e`, `df -h`, `crictl ps` |
| **Namespace stuck `Terminating`** | A resource with a finalizer whose controller is gone; an unavailable aggregated API (e.g. a broken metrics API) | `kubectl api-resources --verbs=list -o name \| xargs -n1 kubectl get -n <ns>`; `kubectl get apiservice` (look for `False`) |

---

## 3. The debugging method and toolkit

### 3.1 The method

1. **Communicate first.** Tell the customer what you know, the impact, and when you'll update them next.
2. **Scope it.** What changed recently (deploy, config, certificate, upgrade, traffic)? Everyone or some users? One Pod, one node, or everything?
3. **Narrow the layer, top-down or bottom-up:** app → container → Pod → Service/DNS → network policy → node → storage → network/MTU → hardware. One question decides each layer, e.g. *"Can I reach the Pod IP directly? Yes → the problem is above the Pod."*
4. **One hypothesis at a time, with evidence.** Change one thing, then observe.
5. **Mitigate before you fix.** Roll back, fail over, scale up, and restore service first. Find the root cause after.
6. **Close the loop.** A blameless write-up, a fix for the root cause, and a check or alert so it can't come back silently (e.g. a pre-flight check in the installer).

### 3.2 Commands worth knowing by heart

```bash
# What's wrong, and where
kubectl get pods -A -o wide | grep -v Running
kubectl describe pod <p>                       # Events at the bottom
kubectl logs <p> [-c <container>] --previous   # the crashed run
kubectl get events -A --sort-by=.lastTimestamp | tail -30
kubectl top nodes; kubectl top pods -A --sort-by=memory

# Inside the network
kubectl run tmp --rm -it --image=nicolaka/netshoot -- bash   # dig, curl, tcpdump, mtr (mirror it on air-gapped sites)
kubectl debug -it <p> --image=busybox --target=<container>   # ephemeral container sharing the Pod's processes
kubectl exec <p> -- cat /etc/resolv.conf
kubectl get endpointslices -l kubernetes.io/service-name=<svc>

# Access
kubectl auth can-i --list --as=system:serviceaccount:<ns>:<sa>

# Rollouts
kubectl rollout status|history|undo deployment/<d>

# On the node (ssh)
systemctl status kubelet containerd; journalctl -u kubelet -e
crictl ps -a; crictl logs <id>; crictl pull <image>
df -h; df -i; free -m; dmesg -T | tail        # disk, inodes, memory, OOM-killer messages
ss -tlnp; ip addr; ip route; tcpdump -i any port 5432
```

---

## 4. Linux and networking

Most problems that look like "Kubernetes is broken" end up here: DNS, TCP, TLS, MTU, disks.

**Q: What happens when you `curl https://api.example.com`?**
1. **DNS:** `/etc/hosts`, then the resolver in `/etc/resolv.conf` → an A/AAAA record.
2. **TCP** three-way handshake (SYN, SYN-ACK, ACK) to port 443, routed by the routing table, through NAT and firewalls.
3. **TLS** handshake: the server sends its certificate chain; the client checks the chain against trusted CAs, the hostname (SAN) and the validity dates (**clock matters**); they agree on keys.
4. The **HTTP** request and response over the encrypted connection.
5. Each step has its own failure: NXDOMAIN, connection refused (nothing listening) vs timeout (dropped by a firewall), certificate errors, HTTP 4xx/5xx.

**Q: "Connection refused" vs "connection timed out"?** *Refused* = the host answered with a reset: reachable, but nothing listening on that port (or a firewall that rejects). *Timed out* = no answer: packets dropped (firewall, NetworkPolicy, wrong route, host down). It tells you which layer to look at.

**Q: MTU, MSS, and why overlays break things.**
- **MTU** = the largest packet a link carries (usually 1500 bytes). **MSS** = the largest TCP payload (MTU − 40 bytes of IP and TCP headers).
- An overlay network (VXLAN) wraps each packet in about **50 extra bytes**, so Pod MTU must be ~1450 on a 1500 network. If not, and ICMP "fragmentation needed" messages are blocked, Path MTU Discovery fails: **the handshake and small requests work, large transfers hang.** It's a classic on-prem issue (VPNs and IPsec add overhead too).

**Q: The disk is full. What do you check?**
`df -h` (space) and `df -i` (**inodes**: millions of tiny files fill a disk that shows free space). `du -sh /* | sort -h` to find where. If `df` says full but `du` doesn't add up: **deleted files still held open** by a process (`lsof +L1`); restart that process or truncate the file. On Kubernetes nodes the usual culprits are container logs, unused images and `emptyDir` volumes.

**Q: The server is slow. What do you look at?**
The **USE method** for each resource (Utilization, Saturation, Errors):
- **CPU:** `top`/`htop`, load average vs number of cores, `%st` (steal time on VMs);
- **memory:** `free -m`, swap use, `dmesg` for OOM-killer messages;
- **disk:** `iostat -x` (`%util`, `await`), `iotop`;
- **network:** `ss -s`, `sar -n DEV`, retransmits.

On Linux, **load average counts processes waiting on I/O** (D state) as well as on CPU, so a high load with idle CPU usually means slow storage.

**Q: "Too many open files"?** The process hit its file-descriptor limit (each socket is a file). Check `ulimit -n` and `/proc/<pid>/limits`, count with `ls /proc/<pid>/fd | wc -l`. Raise the limit (systemd `LimitNOFILE`) **and** check for a leak (sockets never closed).

**Q: Packets randomly dropped on a busy node?** Check for `nf_conntrack: table full, dropping packet` in `dmesg`. The connection-tracking table is full (lots of short connections through NAT). Raise `nf_conntrack_max`, or reduce connection churn (keep-alive, pooling).

**Q: Why does time sync matter so much?** TLS validity checks, JWT/token expiry, etcd and distributed consensus, log correlation across machines. Air-gapped sites have no public NTP, so you need an **internal NTP source**. A drifting clock shows up as "certificate not yet valid" or random authentication failures.

**Q: TLS terms to explain simply.** A **certificate** binds a public key to a name, signed by a **CA**. The **chain**: leaf → intermediate(s) → root, and the server must send the intermediates. **mTLS**: both sides present certificates (service-to-service identity). Typical errors: unknown authority (CA not trusted), hostname mismatch (SAN), expired or not yet valid (dates, clock).

**Q: Useful tools by layer.** DNS: `dig`, `nslookup`. Reachability: `ping`, `mtr`/`traceroute`, `nc -zv host port`. HTTP/TLS: `curl -v`, `openssl s_client -connect host:443 -servername host`. Sockets: `ss -tlnp`. Packets: `tcpdump`. Routes/firewall: `ip route`, `iptables -L -n -v` / `nft list ruleset`.

---

## 5. Containers and images

**Q: What *is* a container?** A normal Linux process isolated with **namespaces** (its own view of PIDs, network, mounts, hostname, users) and limited with **cgroups** (CPU, memory, I/O), started from an image's filesystem. It's not a VM: it shares the host's kernel.

**Q: Docker vs containerd vs CRI-O?** Docker is a developer toolkit (build, CLI) built on top of **containerd**. Kubernetes talks to a runtime through the **CRI**: containerd or CRI-O. The dockershim was removed in 1.24, but Docker-built images are standard OCI images and run everywhere.

**Q: How do you make a good production image?**
- **Multi-stage build:** compile in one stage, copy only the result into a minimal runtime image (slim, distroless).
- **Order layers by how often they change:** dependencies first, code last, so rebuilds reuse the cache.
- **Non-root user with a fixed UID**, read-only root filesystem compatible (write only to mounted volumes).
- No secrets in layers (they stay in the history even if deleted later; use build secrets).
- `.dockerignore`, pinned base image versions (or digests), scan it, and sign it.

**Q: Why does my container ignore SIGTERM and take 30 s to stop?** The process isn't PID 1 or doesn't handle signals. With the **shell form** (`CMD python app.py`), PID 1 is `/bin/sh`, which doesn't forward SIGTERM. Use the **exec form** (`CMD ["python", "app.py"]`), or a tiny init (`tini`, `--init`) to forward signals and reap zombie processes.

**Q: Tag vs digest?** A tag (`:1.4.2`, `:latest`) is a movable pointer; a digest (`@sha256:…`) is the content's fingerprint and can't change. Deploy with immutable tags, or pin digests, so what you tested is exactly what runs. `latest` makes rollbacks and audits impossible.

**Q: Why run as non-root if it's in a container anyway?** A container escape (kernel or runtime bug) gives the attacker the process's user on the host. Non-root + no capabilities + seccomp + no privilege escalation shrinks that risk a lot, and the `restricted` Pod Security Standard requires it.

---

## 6. Cluster operations: upgrades, certificates, backups

**Q: How do you upgrade a Kubernetes cluster safely?**
1. Read the release notes for **removed APIs** (scan the manifests with `pluto` or `kubent`), and check that add-ons (CNI, ingress, operators) support the new version.
2. Back up **etcd** first.
3. **One minor version at a time** (1.30 → 1.31 → 1.32). Control plane first, then workers.
4. Workers one at a time (or in small batches): `kubectl cordon` → `kubectl drain --ignore-daemonsets --delete-emptydir-data` → upgrade → `uncordon` → check health → next.
5. PDBs and multiple replicas keep the apps up during drains.
6. Version skew rule: the kubelet may be **older** than the API server (up to 3 minor versions), never newer.
7. Rehearse on a staging cluster that matches production. On-prem, have a tested way back (snapshots or a restore).

**Q: Cluster certificates expiring?** kubeadm and k3s issue internal certificates valid for **1 year**. kubeadm renews them during upgrades (or `kubeadm certs renew all`); k3s rotates them on restart when they're close to expiry. A cluster nobody upgraded for a year **stops working on the anniversary**, a classic on-prem incident. Monitor the expiry dates.

**Q: What do you back up, and how do you prove it works?**
- **etcd** (the cluster's definition), **persistent volumes** (application data: Velero, storage snapshots, or the database's own backups), **the manifests** (Git), **secrets and keys** (escrowed safely).
- Databases: their own tools for consistency (base backup + WAL archive for PostgreSQL), not just disk snapshots.
- **3-2-1 rule:** 3 copies, 2 media, 1 off-site (on an air-gapped site, "off-site" means another room or another system).
- **A backup you haven't restored is a hope, not a backup.** Run scheduled restore drills and measure **RPO** (how much data you can lose) and **RTO** (how long recovery takes).

**Q: Draining a node hangs. Why?** A PDB that can't be satisfied (e.g. `minAvailable: 1` with 1 replica), Pods with local storage needing `--delete-emptydir-data`, or Pods not managed by a controller (needs `--force`). Fix the PDB or the replica count instead of forcing it.

---

## 7. Air-gapped and on-prem specifics

The part that makes on-prem different from the cloud: no managed services, often no internet, and someone else's network and hardware.

**Q: What breaks when there's no internet?**
- **Images:** every image (yours **and** third-party: CNI, ingress, operators, monitoring) must be in an internal registry. Point containerd at it with mirror configuration (k3s/RKE2: `registries.yaml`).
- **Helm charts, OS packages, Python/Go dependencies, model weights:** each needs its own mirror (an OCI registry for charts, an apt/yum mirror, a PyPI mirror like devpi/Nexus, object storage with checksums for models).
- **Things that phone home:** telemetry, update checks, license servers, plugin downloads. Disable them; they fail slowly (timeouts) rather than cleanly.
- **DNS and NTP:** internal servers only. No public DNS fallback.
- **Certificates:** an internal CA, trusted by nodes, containers and clients. No Let's Encrypt.
- **Support:** no remote access for you either. Bring diagnostic tools **in the bundle** (a netshoot-like image, `crictl`, a support-bundle script that collects logs and state into one file the customer can hand over).

**Q: How do you ship a release into an air-gapped site?**
1. **Build a bundle** outside: every image (by digest), charts or manifests, the installer, the SBOM, signatures and checksums. Tools: **Zarf**, **Hauler**, the RKE2/k3s air-gap image tarballs, or `skopeo`/`oras` scripts.
2. **Scan and sign** it; produce a manifest of what's inside.
3. **Transfer** through the customer's approved path (data diode, approved media), often with their own security scan on the way in.
4. **Verify** checksums and signatures inside, **push** to the internal registry and Git server.
5. **Deploy** with GitOps from the internal Git (Argo CD/Flux), run **pre-flight checks** (versions, storage class, DNS, NTP, CA trust, free resources), then smoke tests.
6. Keep the **previous bundle** on site for rollback.

**Q: Bare-metal Kubernetes: what do you need that a cloud gives you for free?**
- **Load balancer IPs:** MetalLB or kube-vip;
- **storage:** Longhorn, Ceph or local NVMe;
- **a virtual IP for the API server:** kube-vip or keepalived;
- **node provisioning:** PXE, Ansible;
- **an identity provider:** the customer's LDAP/AD via OIDC (Keycloak/Dex);
- **backups to on-prem object storage:** MinIO;
- **monitoring** that stays inside;
- **capacity planning**, because you can't autoscale hardware.

Distributions often chosen: **RKE2** (security-focused, used in government), k3s (edge, small), OpenShift (common in large enterprises and defence), or kubeadm.

**Q: The customer's network is different from your lab. What do you check first?** Their MTU and any VPN/IPsec overhead, proxy settings (`HTTP_PROXY`/`NO_PROXY`, including the cluster CIDRs), DNS search domains, firewall rules between nodes (API 6443, kubelet 10250, etcd 2379-2380, CNI ports such as VXLAN 8472/UDP), allowed CIDRs (does the Pod CIDR clash with their LAN?), NTP, CA trust, and SELinux/AppArmor enforcement. **Put these in a pre-flight script** so the next site takes minutes, not days.

---

## 8. IaC, CI/CD and release strategies

**Q: Terraform in a few points.**
- Declarative: you describe the end state, `terraform plan` shows the diff, `apply` makes it so.
- **State** maps the code to real resources. Keep it in a remote backend **with locking** (S3 + DynamoDB, or an on-prem backend like Consul/PostgreSQL/GitLab), never on a laptop. It can contain secrets: protect it.
- **Drift** = someone changed things by hand; `plan` reveals it.
- Modules for reuse; pin provider versions. For air-gapped sites, **mirror the providers** (`terraform providers mirror`).

**Q: Ansible in a few points.** Agentless (SSH), push-based. **Idempotent** modules: running the playbook twice changes nothing the second time. Use `--check --diff` for a dry run. Typical on-prem use: prepare nodes (packages, kernel settings, NTP, firewall, container runtime) and install k3s/RKE2. Terraform creates infrastructure; Ansible configures machines.

**Q: Push vs pull deployment (CI/CD vs GitOps)?** Push: CI runs `kubectl apply` with cluster credentials, so CI needs network access to the cluster. Pull: an agent in the cluster (Argo CD/Flux) syncs from Git: no inbound access, drift correction, Git as the audit log. Pull fits secure sites better.

**Q: Release strategies.**
| Strategy | How | Good for | Cost |
|---|---|---|---|
| **Rolling** | Replace Pods gradually | The default; stateless apps | Two versions run together for a while |
| **Blue/green** | Run the new version fully beside the old, switch traffic at once | Instant rollback | Twice the resources during the switch |
| **Canary** | Send a small % of traffic to the new version, watch metrics, increase | Catching problems with real traffic | Needs traffic splitting and good metrics (Argo Rollouts, Flagger, service mesh) |
| **Feature flags** | Ship the code turned off, enable it separately | Separating deploy from release | Flag cleanup discipline |

**Q: Database migrations without downtime?** **Expand → migrate → contract.** Add the new column or table in a way the old code ignores; deploy code that writes both and reads the new; backfill; then remove the old column in a **later** release. Never rename or drop in the same release that stops using it, because old and new versions run side by side during a rollout.

**Q: What belongs in a CI pipeline?** Lint and type-check → unit tests → build the image (with an immutable tag) → **scan** (Trivy/Grype, fail on critical issues) → generate an **SBOM** → **sign** (cosign) → push → integration tests against a real database → update the GitOps repo. For offline CI: self-hosted runners and mirrored dependencies.

---

## 9. Observability and incident response

**Q: Metrics, logs and traces: what's each for?**
- **Metrics:** cheap numbers over time; alerting and trends. Prometheus.
- **Logs:** detailed events; use structured JSON. Loki, Elasticsearch/OpenSearch.
- **Traces:** one request's path through services; finds where latency comes from. OpenTelemetry + Tempo/Jaeger.

**Q: What would you monitor for a service?**
- **RED** for services: **R**ate, **E**rrors, **D**uration (latency percentiles: p95/p99, not averages).
- **USE** for resources: **U**tilization, **S**aturation, **E**rrors.
- Plus the **four golden signals** (latency, traffic, errors, saturation), queue depth and age for pipelines, certificate expiry, disk-fill prediction, and backup success.

**Q: SLI, SLO, SLA and error budgets.**
- **SLI**: the measurement (e.g. % of requests answered under 300 ms).
- **SLO**: the internal target (99.9 % over 30 days).
- **SLA**: the contract with consequences, looser than the SLO.
- The **error budget** is what's left: 99.9 % allows about **43 minutes** of failure per 30 days. When it's spent, you slow releases and fix reliability.

**Q: What makes a good alert?** It fires on **symptoms users feel** (error rate, latency, freshness), not causes (high CPU on its own); it's actionable, with a runbook link; and it's rare enough that people don't ignore it. Page for "users are affected now", ticket for "this will break this week" (disk 80 % and rising).

**Q: Prometheus pitfalls.** **High-cardinality labels** (user IDs, request IDs, full URLs) explode memory. `rate()` needs a range at least 4× the scrape interval. Prometheus isn't long-term storage: use Thanos/Mimir/VictoriaMetrics for retention and HA.

**Q: How do you run an incident?** Clear roles (incident lead, communicator, people fixing), one channel, regular status updates to stakeholders, **mitigate first**, keep a timeline, then a **blameless postmortem**: what happened, impact, root cause and contributing factors, what went well, and action items with owners.

---

## 10. Security

**Q: How do you harden a Kubernetes workload?**
- Non-root, read-only root filesystem, drop all capabilities, `allowPrivilegeEscalation: false`, seccomp `RuntimeDefault` (= Pod Security `restricted`).
- Default-deny NetworkPolicies, then allow-list.
- No ServiceAccount token unless needed; least-privilege RBAC.
- Resource limits (a noisy or compromised Pod can't starve others).
- Images: minimal, scanned, signed, from your registry only (admission policy).
- Secrets from a secret manager, encrypted at rest; rotate them.

**Q: Cluster-level hardening?** API server not publicly exposed; RBAC audit (who has `cluster-admin`, who can read Secrets or `exec` into Pods); audit logging on; etcd encrypted and access-restricted; the kubelet's anonymous auth off; nodes patched; the **CIS Kubernetes Benchmark** (`kube-bench`). In government settings, distributions like RKE2 come close to these defaults (CIS, FIPS options).

**Q: Supply chain security?** Know what's in your software (**SBOM**: Syft), scan it (Trivy/Grype), sign it (cosign/Sigstore), **verify at admission** (Kyverno / policy-controller), pin dependencies with lock files, build in a controlled CI (SLSA levels). In air-gapped deployments the customer will often require all of this as evidence.

**Q: A critical CVE is announced in a base image. What do you do?** Find out where it's deployed (SBOM search / registry scan), whether it's actually **exploitable** in your context (is the vulnerable code path reachable? is the component even used?), rebuild on the patched base, test, roll out through the normal pipeline, and tell affected customers clearly. For air-gapped sites, ship a patch bundle. Record the decision if you accept a risk for a while.

**Q: Where should secrets live?** Not in Git, not in images, not in environment variables printed in logs. A secret manager (Vault, the cloud KMS, or Sealed Secrets/SOPS for GitOps), injected at runtime, with rotation and audit. Short-lived credentials (Vault dynamic database credentials) beat long-lived ones.

---

## 11. PostgreSQL in production: incidents

This section is about incidents: what breaks in a running PostgreSQL and how to tell what it is. (For how the project runs PostgreSQL, see [chapter 18](guide/18-operators-and-crds.md).)

| Symptom | Likely cause | What to check / do |
|---|---|---|
| `FATAL: sorry, too many clients already` | Connection exhaustion: each app replica opens its own pool; autoscaling multiplies it | `SELECT count(*), state FROM pg_stat_activity GROUP BY state;` Use **PgBouncer**, smaller pools, `max_connections` sized for memory |
| Queries suddenly slow | A changed plan (stale statistics), missing index, **lock waits**, bloat, disk I/O | `EXPLAIN (ANALYZE, BUFFERS)`; `pg_stat_statements` for the top queries; `ANALYZE` the table |
| Everything blocked | A long transaction holding a lock, often `ALTER TABLE` waiting behind it and blocking everyone after it | `SELECT * FROM pg_stat_activity WHERE wait_event_type = 'Lock';` `pg_blocking_pids()`; terminate the blocker; use `lock_timeout` in migrations |
| Table and disk keep growing | **Bloat**: autovacuum can't clean because of a long-running or **idle in transaction** session, or an abandoned replication slot | `pg_stat_activity` for old `xact_start`; `pg_replication_slots` for inactive slots; set `idle_in_transaction_session_timeout` |
| Disk filling with WAL | WAL archiving failing, or a replication slot whose consumer is gone | Check archiver status (`pg_stat_archiver`), drop dead slots, fix the archive target |
| Replica lagging | Heavy writes, slow replica disk or network, long queries on the replica | `pg_stat_replication` (`replay_lag`); fix I/O; tune `hot_standby_feedback` |
| Transaction ID wraparound warnings | Vacuum not keeping up on huge or neglected tables | Urgent manual `VACUUM (FREEZE)`; never ignore those warnings |

---

## 12. Incident scenarios: walk-throughs to practise

Each walk-through follows the same shape: method, commands, mitigation, root cause, prevention. Try working through the symptom yourself before reading the answer.

### 12.1 "The site went down after a deployment."
- **Mitigate first:** `kubectl rollout undo` (or revert in Git). Is it back? Then the change is the cause.
- **Investigate:** compare the two versions: image, config, migrations, resource limits. New Pods' `describe` and `logs --previous`.
- **Typical roots:** a missing env var or Secret in the new release; a migration that dropped something the old code still used (no expand/contract); a new readiness endpoint failing; resource limits too low.
- **Prevent:** readiness gates + `maxUnavailable: 0` (a bad version never takes traffic), canary releases, a smoke test in the pipeline.

### 12.2 "Pods on one node can't reach a database on another node, but on the same node it works."
- That points below Kubernetes: **the overlay between nodes**.
- Check the CNI Pods on both nodes, the firewall between nodes (VXLAN `8472/udp` for Flannel, BGP `179/tcp` for Calico), and **MTU** (a ping with "don't fragment" at full size).
- **Typical root on-prem:** the customer's firewall blocks the overlay port between racks, or their network has a smaller MTU (VPN/IPsec), so large packets vanish.

### 12.3 "Everything was fine for a year, then today nothing works."
- The one-year clue = **certificates**. `kubectl` says `x509: certificate has expired`; the kubelet logs the same.
- **Fix:** renew (`kubeadm certs renew all` + restart the control plane components, or restart k3s/RKE2 so they rotate), then check each node's kubelet certificate.
- **Prevent:** monitor certificate expiry (Prometheus has the metrics), upgrade regularly, and put "certificate expiry" in the operations runbook you leave with the customer.

### 12.4 "The app works, but every few hours it restarts."
- `describe` → `OOMKilled`, exit 137, restart count rising. The memory graph shows a slow climb = **a leak**, or spikes = a large request or batch.
- **Mitigate:** raise the limit temporarily, add replicas.
- **Root-cause:** heap profiling (e.g. `tracemalloc`/`memray` for Python), look for unbounded caches or lists, loading whole files instead of streaming.
- **Prevent:** a memory alert at 80 % of the limit, load tests with production-like data.

### 12.5 "Random 5xx errors, about 1 % of requests, during deploys."
- **Graceful shutdown.** A Pod being deleted is removed from endpoints at the same moment it gets SIGTERM; the ingress still sends a few requests; the app exits immediately.
- **Fix:** a `preStop` sleep of a few seconds, the app finishing in-flight requests on SIGTERM, exec-form `CMD` so the app actually receives the signal, `maxUnavailable: 0`, and a PDB.

### 12.6 "DNS lookups are slow or fail intermittently."
- Look at CoreDNS: CPU, restarts, logs. Is the upstream resolver reachable (on air-gapped sites it may not exist, so lookups for external names wait for timeouts)? `ndots:5` making every external lookup try 4–5 names first. A UDP conntrack race (known for parallel A/AAAA lookups).
- **Fixes:** scale CoreDNS / add **NodeLocal DNSCache**, set `ndots` lower or use fully qualified names, configure forwarding correctly for the site.

### 12.7 "A PersistentVolume won't attach after a node died."
- `Multi-Attach error`: the RWO volume is still recorded as attached to the dead node.
- **Confirm the node is really dead** (power off or fence it). Two writers on one volume corrupts data. Then let Kubernetes detach it after its timeout, or delete the `VolumeAttachment`. For StatefulSets, deleting the Pod with `--force` is only safe after fencing.
- **Prevent:** database replication at the application level (one replica per node), so losing a node means failover, not waiting on a disk.

### 12.8 "The customer says 'it's slow'."
- **Turn it into numbers first:** which page or API call, since when, for whom, how slow? Ask for a timestamp.
- Follow the request: ingress latency → app latency → database query time → host saturation (USE). Compare with before the complaint.
- **Typical roots:** a growing table without an index, a noisy neighbour on shared hardware, disk latency on the storage system, the network path through the customer's proxy.
- Report back what you found **and** what you changed, with the before/after numbers.

### 12.9 "A Pod can't pull its image on the customer's air-gapped cluster."
- `describe pod`: is it `not found` (not mirrored, or the reference isn't rewritten to the internal registry), `x509` (internal CA not trusted by containerd), `unauthorized` (credentials), or `no match for platform` (amd64 vs arm64)?
- On the node: `crictl pull` with the same reference. Check containerd's mirror configuration.
- **Prevent:** the bundle contains **every** image by digest, a pre-flight check pulls each one, and the installer configures the registry mirror and CA on every node.

---

## 13. Small design questions

Short design sketches, each stating its assumptions and trade-offs.

**"Design a pipeline that ingests large geospatial images (e.g. aerial or drone photos) and makes them searchable."**
Object storage (MinIO on-prem) for the raw files; a message on arrival (a queue: Kafka/NATS/Postgres); stateless workers that process and tile each image (scaled on queue length with KEDA); metadata and footprints in PostgreSQL + **PostGIS** (spatial index) for search; an API on top; idempotent processing (a re-run never duplicates); backpressure and dead-letter handling; metrics on queue depth and processing age. Mention data volume and the network: move compute to the data, not the reverse.

**"How would you make a service highly available on three on-prem servers?"**
3 control-plane nodes (etcd quorum), app replicas spread across nodes with PDBs, a replicated database with automatic failover (CNPG/Patroni), replicated storage or replication at the app level, 2+ ingress replicas behind a virtual IP (kube-vip/MetalLB), and **tested failure drills** (drain a node, kill the primary). Be honest about what isn't covered: a single rack, power, or the site's network.

**"How do you capacity-plan on fixed hardware?"**
Measure real usage per component (requests vs actual), plan for **N−1** (everything must still fit with one node down), leave headroom for rollouts (`maxSurge` needs room), set ResourceQuotas per team or namespace, priority classes for what must survive, and track growth trends to tell the customer *before* they run out.

**"Kafka vs a database table as a queue?"**
A table (`SELECT … FOR UPDATE SKIP LOCKED`) is great at modest volume: transactional with your data, one less system to run. Kafka wins for high throughput, many independent consumers (fan-out), replay and long retention, at the cost of running and securing another stateful cluster.

**"How would you serve an LLM on-prem with GPUs?"**
GPU nodes tainted and labelled; the **NVIDIA GPU Operator** (driver, device plugin, DCGM metrics); a serving engine such as **vLLM** (batching, KV cache) behind an internal API; model weights from an internal registry or object storage with checksums; capacity in tokens per second; queueing and timeouts; monitoring of GPU memory and utilisation.

---

## 14. Rapid-fire flashcards

Cover the right column and test yourself.

| Question | Answer |
|---|---|
| Pod vs container? | A Pod is one or more containers sharing a network namespace (same IP, `localhost`) and volumes; the smallest thing Kubernetes schedules |
| Why are Pods "cattle"? | They're replaceable: new name, new IP. Anything that must persist lives in volumes or external services |
| What does `kubectl apply` do differently from `create`? | Declarative: creates or updates to match the file, tracking what you last applied (three-way merge) |
| Readiness fails: restart or not? | **Not restarted**, only removed from Service endpoints |
| Exit code 137? | SIGKILL: usually OOMKilled |
| CPU limit exceeded? | Throttled, not killed |
| Memory limit exceeded? | OOMKilled |
| QoS class evicted first? | BestEffort (no requests or limits) |
| Taint vs affinity? | A taint repels Pods without a toleration; affinity attracts Pods to nodes |
| How many etcd members for 2 failures? | 5 (quorum = majority) |
| Default `terminationGracePeriodSeconds`? | 30 s |
| Default `ndots` in Pods? | 5 |
| Are Secrets encrypted? | Only base64 by default; enable encryption at rest |
| What removed PodSecurityPolicy? | Pod Security Admission (Standards: privileged/baseline/restricted), since 1.25 |
| Service with no endpoints: first check? | The selector vs the Pod labels, then readiness |
| `WaitForFirstConsumer`? | The PVC binds only when a Pod using it is scheduled |
| Does a PDB protect against node crashes? | No, only voluntary disruptions (drain, upgrades) |
| Upgrade order? | etcd backup → control plane → workers, one minor version at a time |
| Kubelet newer than the API server? | Never allowed; older is OK (up to 3 minors) |
| What's in an air-gap bundle? | All images by digest, charts/manifests, installer, SBOM, signatures, checksums |
| "Connection refused" means? | Host reachable, nothing listening on the port |
| "Timeout" means? | Packets dropped: firewall, policy, routing, host down |
| VXLAN overhead? | About 50 bytes, so Pod MTU 1450 on a 1500 network |
| Disk full but `du` disagrees? | Deleted files still open (`lsof +L1`), or inodes (`df -i`) |
| Shell-form CMD problem? | `/bin/sh` is PID 1 and doesn't forward SIGTERM |
| Tag vs digest? | A tag can move; a digest is the content's fingerprint |
| RED vs USE? | RED for services (rate, errors, duration); USE for resources (utilisation, saturation, errors) |
| 99.9 % over 30 days allows? | About 43 minutes of failure |
| Expand/contract? | Add new → write both → backfill → remove old in a later release |
| Push vs pull deploys? | Push: CI applies to the cluster. Pull: an in-cluster agent (Argo CD/Flux) syncs from Git |
