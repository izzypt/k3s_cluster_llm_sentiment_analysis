# ★ Cheat sheet

[Home](../README.md)

## Cluster and context

```bash
k3d cluster create NAME --agents 2 -p "8081:80@loadbalancer"   # or --config file.yaml
k3d cluster list | stop | start | delete NAME
kubectl config get-contexts
kubectl config use-context k3d-NAME
kubectl config set-context --current --namespace=NS
kubectl cluster-info; kubectl get nodes -o wide; kubectl api-resources
```

## Read

```bash
kubectl get pods|deploy|svc|ing|cm|secret|pvc|netpol|hpa|pdb|events [-n NS | -A] [-o wide|yaml|name] [-w] [-l key=value]
kubectl describe pod POD                       # EVENTS at the bottom
kubectl logs POD [-c CONTAINER] [-f] [--previous] [--since=10m]
kubectl logs deploy/NAME --all-containers --prefix
kubectl get events --sort-by=.lastTimestamp
kubectl top nodes | pods
kubectl explain deployment.spec.strategy [--recursive]
kubectl get pods -o custom-columns=NAME:.metadata.name,NODE:.spec.nodeName,IP:.status.podIP
kubectl get pods -o jsonpath='{.items[*].metadata.name}'
```

## Write

```bash
kubectl apply -f FILE.yaml | -f DIR/ | -k KUSTOMIZE_DIR
kubectl diff -f FILE.yaml                      # preview
kubectl delete -f FILE.yaml | pod POD | deploy NAME
kubectl create deployment web --image=nginx --replicas=2 --dry-run=client -o yaml > web.yaml
kubectl create secret generic NAME --from-literal=k=v --dry-run=client -o yaml
kubectl create configmap NAME --from-env-file=app.env
kubectl label | annotate RESOURCE NAME key=value [--overwrite]
kubectl scale deploy NAME --replicas=3
kubectl edit deploy NAME                       # live edit (not in Git!)
```

## Rollouts

```bash
kubectl set image deploy/NAME CONTAINER=IMAGE:TAG
kubectl rollout status | history | undo [--to-revision=N] | restart | pause | resume deploy/NAME
```

## Interact and debug

```bash
kubectl exec -it POD [-c C] -- sh
kubectl port-forward svc/NAME 8080:80
kubectl run tmp --rm -it --image=busybox --restart=Never -- sh
kubectl debug -it POD --image=nicolaka/netshoot --target=CONTAINER
kubectl cp POD:/path ./local
kubectl auth can-i VERB RESOURCE [--as=system:serviceaccount:NS:SA] [-n NS]
kubectl get endpointslices -l kubernetes.io/service-name=SVC
```

## Nodes

```bash
kubectl cordon | uncordon NODE
kubectl drain NODE --ignore-daemonsets --delete-emptydir-data
kubectl taint nodes NODE key=value:NoSchedule[-]
kubectl describe node NODE | grep -A8 "Allocated resources"
```

## Kustomize and Helm

```bash
kubectl kustomize DIR                          # render
helm repo add NAME URL && helm repo update
helm install|upgrade --install REL CHART -n NS --create-namespace -f values.yaml
helm list -A; helm rollback REL N; helm template REL CHART -f values.yaml; helm uninstall REL
```

## Pod status decoder

| Status | First command |
|---|---|
| Pending | `kubectl describe pod` (FailedScheduling, PVC) |
| ImagePullBackOff | `kubectl describe pod` (name/tag/registry) |
| CrashLoopBackOff | `kubectl logs POD --previous` |
| OOMKilled | raise the memory limit / fix the leak |
| Running 0/1 | readiness probe: `kubectl describe pod` |
| Init:x/y | `kubectl logs POD -c INIT_CONTAINER` |
| CreateContainerConfigError | missing ConfigMap/Secret key |

## Manifest skeletons

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: app, labels: { app.kubernetes.io/name: app } }
spec:
  selector: { matchLabels: { app.kubernetes.io/name: app } }
  strategy: { rollingUpdate: { maxSurge: 1, maxUnavailable: 0 } }
  template:
    metadata: { labels: { app.kubernetes.io/name: app } }
    spec:
      automountServiceAccountToken: false
      enableServiceLinks: false
      securityContext: { runAsNonRoot: true, seccompProfile: { type: RuntimeDefault } }
      containers:
        - name: app
          image: registry/app:1.0.0
          ports: [{ name: http, containerPort: 8000 }]
          envFrom: [{ configMapRef: { name: app-config } }]
          resources: { requests: { cpu: 100m, memory: 128Mi }, limits: { memory: 256Mi } }
          readinessProbe: { httpGet: { path: /readyz, port: http } }
          livenessProbe: { httpGet: { path: /healthz, port: http } }
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
---
apiVersion: v1
kind: Service
metadata: { name: app }
spec:
  selector: { app.kubernetes.io/name: app }
  ports: [{ name: http, port: 80, targetPort: http }]
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata: { name: app }
spec:
  minAvailable: 1
  selector: { matchLabels: { app.kubernetes.io/name: app } }
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: default-deny-all }
spec: { podSelector: {}, policyTypes: [Ingress, Egress] }
```

## SkyPulse

```bash
make build | start | update | verify | status | logs | test | stop | clean
open http://localhost:8090
```

## Glossary

| Term | One-liner |
|---|---|
| **Pod** | One or more containers scheduled together, sharing IP and volumes |
| **Deployment / ReplicaSet** | Keeps N identical pods running; rolling updates |
| **StatefulSet** | Pods with stable names and per-pod storage |
| **DaemonSet** | One pod per node |
| **Job / CronJob** | Run to completion / on a schedule |
| **Service** | Stable virtual IP + DNS name load-balancing over ready pods |
| **Ingress / Gateway API** | HTTP routing into the cluster, implemented by a controller |
| **ConfigMap / Secret** | Configuration / credentials injected into pods |
| **PV / PVC / StorageClass** | Storage / a request for storage / a type of storage |
| **Namespace** | A named partition for objects and policies |
| **RBAC** | Who may do what to which API resources |
| **NetworkPolicy** | Pod-level firewall rules (allow-lists) |
| **Probe** | Kubelet health check: readiness, liveness, startup |
| **HPA** | Scales replicas on metrics |
| **PDB** | Limits voluntary disruptions (drains) |
| **CRD / Operator** | A custom API type / the controller that manages it |
| **Kustomize / Helm** | Overlay-based / template-based YAML packaging |
| **GitOps** | Git as the source of truth, reconciled by an in-cluster agent |
| **CNI / CSI / CRI** | Plugin interfaces for networking / storage / container runtime |
