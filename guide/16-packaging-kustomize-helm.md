# 16 · Packaging: Kustomize and Helm

🟠 Advanced · ⏱️ 40 min · [← Previous](15-high-availability-and-scaling.md) · [Home](../README.md) · [Next: Continuous delivery and GitOps →](17-continuous-delivery-gitops.md)

You have YAML that works locally. Production needs the same YAML with a different registry, more replicas, bigger disks and a real hostname. Copy-pasting folders per environment drifts quickly. Two tools dominate:

| | **Kustomize** | **Helm** |
|---|---|---|
| Approach | **Patching** plain YAML (overlays on a base) | **Templating** YAML with Go templates + `values.yaml` |
| Built into kubectl | ✅ `kubectl apply -k` | ❌ separate CLI |
| Learning curve | Low: it's still plain YAML | Medium: template syntax, chart structure |
| Release management | None (just apply) | Releases, `helm upgrade`, `helm rollback`, hooks |
| Distribution | Git folders | Charts in repositories / OCI registries |
| Best for | **Your own apps** across environments | **Installing third-party software**, sharing configurable packages |

Most teams use both: Helm to install off-the-shelf components (ingress controllers, monitoring, cert-manager) and Kustomize, or a simple Helm chart, for their own apps. Argo CD and Flux support both.

## Kustomize

```text
k8s/
├── base/
│   ├── kustomization.yaml
│   ├── api.yaml
│   └── config.env
└── overlays/
    ├── local/kustomization.yaml
    └── production/kustomization.yaml
```

### The base

```yaml
# k8s/base/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:                        # plain manifests (or other kustomization directories)
  - api.yaml
  - networkpolicies.yaml
labels:                           # add labels to every object (and pod templates)
  - pairs: { app.kubernetes.io/part-of: skypulse }
    includeTemplates: true
configMapGenerator:               # generate a ConfigMap with a content-hash suffix (Chapter 08)
  - name: analysis-config
    envs: [config.env]
```

### An overlay

```yaml
# k8s/overlays/production/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../base
images:                           # retarget images without touching the base
  - name: skypulse-app
    newName: registry.analysts.internal/skypulse/app
    newTag: "0.1.0"
patches:                          # JSON6902 or strategic-merge patches
  - target: { kind: HorizontalPodAutoscaler, name: api }
    patch: |
      - op: replace
        path: /spec/minReplicas
        value: 3
```

```bash
kubectl kustomize k8s/overlays/production      # render to stdout: always look before applying
kubectl diff -k k8s/overlays/production
kubectl apply -k k8s/overlays/production
```

Other useful features: `namespace:` (set it on everything), `namePrefix`/`nameSuffix`, `secretGenerator`, `replicas:`, **components** (reusable optional features), `helmCharts:` (inflate a chart inside Kustomize).

> 🔗 **In the project:** [`k8s/base`](../skypulse/k8s/base/) holds the whole system; [`overlays/local`](../skypulse/k8s/overlays/local/kustomization.yaml) points the images at the k3d registry; [`overlays/production`](../skypulse/k8s/overlays/production/kustomization.yaml) shows a realistic on-prem setup (3 PostgreSQL instances, 50Gi disks, 2 LLM replicas, hostname + TLS). `make deploy` generates one more tiny overlay on the fly (`.build/deploy/`) that pins the exact image tags just built.

## Helm

A **chart** is a package of templates plus default values:

```text
mychart/
├── Chart.yaml            # name, version, appVersion, dependencies
├── values.yaml           # default configuration
└── templates/
    ├── deployment.yaml   # Go templates
    ├── service.yaml
    └── _helpers.tpl
```

```yaml
# templates/deployment.yaml (excerpt)
spec:
  replicas: {{ .Values.replicaCount }}
  template:
    spec:
      containers:
        - name: {{ .Chart.Name }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
          {{- with .Values.resources }}
          resources:
            {{- toYaml . | nindent 12 }}
          {{- end }}
```

### Using charts (the common case)

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm search repo ingress-nginx
helm show values ingress-nginx/ingress-nginx > values.yaml        # read the knobs
helm install ingress ingress-nginx/ingress-nginx -n ingress --create-namespace -f my-values.yaml
helm upgrade ingress ingress-nginx/ingress-nginx -n ingress -f my-values.yaml
helm list -A
helm rollback ingress 1 -n ingress
helm template ingress ingress-nginx/ingress-nginx -f my-values.yaml   # render without installing
helm uninstall ingress -n ingress
```

Charts can also come from OCI registries: `helm install x oci://registry.example.com/charts/x --version 1.2.3`.

> 💡 k3s installs its bundled components (like Traefik) through Helm charts managed by a built-in controller. You customize them with a `HelmChartConfig`. That's exactly what [`cluster/traefik-ha.yaml`](../skypulse/cluster/traefik-ha.yaml) does to make the ingress controller highly available. The project itself doesn't need the Helm CLI.

### Writing your own chart

```bash
helm create skypulse     # scaffolds a working chart to learn from
helm lint skypulse
```

Good charts expose a small, documented `values.yaml`, use `_helpers.tpl` for names and labels, and avoid templating every single field.

## Which should I use?

- **Your own service, a few environments:** Kustomize. Your YAML stays readable, reviewable and greppable.
- **Many installations with many knobs, or software for other teams:** Helm.
- **Third-party software:** its official Helm chart (or operator).

## Key takeaways

- **Kustomize** = base + overlays, patching plain YAML; built into kubectl.
- **Helm** = templated charts with values; releases and rollbacks; the standard for third-party software.
- Always render (`kubectl kustomize`, `helm template`) and diff before applying.

[Next: Continuous delivery and GitOps →](17-continuous-delivery-gitops.md)
