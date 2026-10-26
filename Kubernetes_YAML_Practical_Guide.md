# Kubernetes YAML — A Practical, Deep Guide

> **Goal:** Learn to *read and write* Kubernetes YAML naturally, instead of memorising random fields.
>
> The central idea is simple:
>
> **YAML describes data. Kubernetes YAML describes a desired object. The Kubernetes API decides what that object means.**

---

# 1. The mental model

When you see a Kubernetes YAML file, do **not** initially think:

> "What do all these fields mean?"

Think:

> **"What object am I asking Kubernetes to create, and what is its desired state?"**

A Kubernetes manifest usually says:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-api
spec:
  ...
```

Read this almost like English:

- `apiVersion`: Which Kubernetes API defines this object?
- `kind`: What type of object is it?
- `metadata`: What is this object called / labelled?
- `spec`: What do I want this object to look like?

This pattern is the foundation of Kubernetes YAML.

---

# 2. YAML itself: the rules you actually need

YAML is a human-readable data serialisation language.

It is **not a Kubernetes language**.

Kubernetes happens to use YAML because YAML is convenient for describing structured data.

The same data could generally be represented as JSON.

For example:

```yaml
name: alice
age: 30
```

is conceptually:

```json
{
  "name": "alice",
  "age": 30
}
```

## 2.1 Key/value pairs

The fundamental YAML structure is:

```yaml
key: value
```

Examples:

```yaml
name: my-api
replicas: 3
enabled: true
port: 8080
```

The `:` separates the key from its value.

### Important

There must normally be whitespace after `:`:

```yaml
name: my-api
```

not:

```yaml
name:my-api
```

---

# 3. Indentation is structure

This is probably the most important YAML rule.

YAML uses **indentation to represent hierarchy**.

```yaml
metadata:
  name: my-api
  labels:
    app: my-api
```

The structure is:

```text
metadata
├── name
└── labels
    └── app
```

So:

```yaml
metadata:
  name: my-api
```

means:

```text
metadata
    └── name
```

while:

```yaml
metadata:
name: my-api
```

means something completely different and is invalid for the intended structure.

## Use spaces, not tabs

Prefer:

```yaml
metadata:
  name: my-api
```

with 2 spaces.

Never mix tabs and spaces.

A very common convention is **2 spaces per indentation level**.

---

# 4. Objects / mappings

A YAML mapping is a collection of key/value pairs:

```yaml
person:
  name: Alice
  age: 30
  city: Lisbon
```

Think:

```text
person
├── name
├── age
└── city
```

Kubernetes manifests are essentially very large nested mappings.

---

# 5. Lists

A dash (`-`) represents an item in a list.

```yaml
containers:
  - name: api
    image: nginx
  - name: worker
    image: redis
```

This means:

```text
containers
├── item 1
│   ├── name: api
│   └── image: nginx
│
└── item 2
    ├── name: worker
    └── image: redis
```

You will see lists **everywhere** in Kubernetes.

For example:

```yaml
ports:
  - containerPort: 8080
  - containerPort: 9090
```

---

# 6. A list item can contain another object

This:

```yaml
containers:
  - name: api
    image: my-api:1.0
    ports:
      - containerPort: 8080
```

means:

```text
containers
└── list item
    ├── name
    ├── image
    └── ports
        └── list item
            └── containerPort
```

This nested-list pattern is one of the main things you need to become comfortable reading.

---

# 7. Strings

Strings can often be written without quotes:

```yaml
name: my-api
image: nginx:1.27
```

You can also quote them:

```yaml
name: "my-api"
image: "nginx:1.27"
```

Quotes are useful when a value could otherwise be interpreted as another YAML type.

For example:

```yaml
version: "1.0"
```

is safer than relying on YAML's automatic type interpretation.

For Kubernetes manifests, you will frequently see:

```yaml
name: "8080"
```

when the Kubernetes API expects a string.

---

# 8. Numbers and booleans

YAML supports values such as:

```yaml
replicas: 3
port: 8080
enabled: true
debug: false
```

These are different from:

```yaml
replicas: "3"
port: "8080"
enabled: "true"
```

The latter are strings.

**Whether Kubernetes accepts a particular type is determined by the Kubernetes API schema.**

Do not assume that quoting or not quoting is interchangeable.

---

# 9. Null

You can represent no value with:

```yaml
value: null
```

or sometimes:

```yaml
value:
```

You will occasionally encounter this in Kubernetes-generated YAML, although you generally don't need it in hand-written manifests unless the API specifically calls for it.

---

# 10. Comments

Comments start with `#`.

```yaml
# Number of desired Pods
replicas: 3
```

You can also put comments after values:

```yaml
replicas: 3 # run three replicas
```

Comments are ignored by Kubernetes.

---

# 11. Multi-line strings

YAML supports block strings.

Literal block:

```yaml
script: |
  echo "hello"
  echo "world"
```

Folded block:

```yaml
description: >
  This is a long description
  that YAML will treat as one
  folded line.
```

This becomes especially useful with:

- ConfigMaps
- shell scripts
- configuration files
- certificates
- large text blocks

Example:

```yaml
data:
  config.sh: |
    #!/bin/sh
    echo "Starting application"
    python app.py
```

---

# 12. Multiple YAML documents in one file

You can put several Kubernetes resources in the same file.

Separate them using:

```yaml
---
```

Example:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  MODE: production

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app
spec:
  ...
```

Kubernetes treats these as separate objects.

---

# 13. The Kubernetes YAML "grammar"

Kubernetes does **not** have one universal list of YAML keys.

This is extremely important.

There is no rule saying:

> Every Kubernetes YAML file must have these 50 keys.

Instead:

```text
YAML
  ↓
Kubernetes object
  ↓
kind determines the API schema
  ↓
apiVersion determines which version of that schema
  ↓
allowed fields depend on that resource
```

Therefore:

```yaml
kind: Deployment
```

and:

```yaml
kind: Service
```

have different `spec` structures.

---

# 14. The four fields you should recognise immediately

Most normal Kubernetes manifests begin with:

```yaml
apiVersion: ...
kind: ...
metadata:
  ...
spec:
  ...
```

Think:

```text
┌─────────────────────────────┐
│ apiVersion                  │
│ "Which API defines this?"   │
├─────────────────────────────┤
│ kind                        │
│ "What object is this?"      │
├─────────────────────────────┤
│ metadata                    │
│ "Who/what is this?"         │
├─────────────────────────────┤
│ spec                        │
│ "What should it do/be?"     │
└─────────────────────────────┘
```

However, **not every Kubernetes resource has exactly these fields**.

For example, some resources have `data`, `stringData`, `rules`, etc., and some do not have a `spec` in the same sense.

The safest mental model is:

> **`apiVersion`, `kind`, and `metadata` identify the object. The remaining fields depend on the resource's API schema.**

---

# 15. apiVersion

Example:

```yaml
apiVersion: apps/v1
```

This tells Kubernetes which API group/version should interpret the object.

Common examples:

```yaml
apiVersion: v1
```

```yaml
apiVersion: apps/v1
```

```yaml
apiVersion: batch/v1
```

```yaml
apiVersion: networking.k8s.io/v1
```

Think:

```text
apiVersion
    ↓
Which Kubernetes API contract should I use?
```

Do **not** randomly change this value.

Different resources belong to different API groups.

---

# 16. kind

Example:

```yaml
kind: Deployment
```

This tells Kubernetes what object you are creating.

Common kinds:

```text
Pod
Deployment
ReplicaSet
StatefulSet
DaemonSet
Job
CronJob

Service
Ingress
ConfigMap
Secret

Namespace
PersistentVolume
PersistentVolumeClaim

ServiceAccount
Role
RoleBinding
```

The `kind` determines the schema of the rest of the object.

This is why:

```yaml
kind: Deployment
```

and:

```yaml
kind: Service
```

have radically different `spec` sections.

---

# 17. metadata

Metadata describes the Kubernetes object itself.

Typical example:

```yaml
metadata:
  name: my-api
  namespace: production
  labels:
    app: my-api
    environment: production
```

Common metadata fields:

```text
name
namespace
labels
annotations
```

---

# 18. name

Every namespaced Kubernetes object normally needs an identity.

```yaml
metadata:
  name: my-api
```

You interact with it using this name:

```bash
kubectl get deployment my-api
```

The name is effectively the object's identifier inside its namespace.

---

# 19. namespace

You can specify:

```yaml
metadata:
  namespace: production
```

Then the object belongs to:

```text
production namespace
```

Without specifying it, kubectl commonly uses the current/default namespace depending on the operation/context.

Important distinction:

```text
cluster
│
├── namespace A
│   ├── Deployment
│   ├── Service
│   └── Pod
│
└── namespace B
    ├── Deployment
    └── Service
```

Names are generally scoped by namespace.

---

# 20. labels

Labels are **structured metadata used for identification and selection**.

```yaml
labels:
  app: my-api
  environment: production
  team: platform
```

Labels are one of the most important Kubernetes concepts.

A Service can use them to find Pods:

```yaml
selector:
  app: my-api
```

A Deployment uses labels to identify the Pods it manages.

Think:

> **Labels are the tags Kubernetes uses to group and select objects.**

---

# 21. annotations

Annotations are also metadata, but they are generally for information/configuration consumed by tools rather than for selecting objects.

```yaml
annotations:
  description: "Production API"
```

A useful distinction:

```text
labels
  → identity / grouping / selection

annotations
  → extra metadata / tool configuration
```

Do not use annotations as a replacement for labels.

---

# 22. The most important Kubernetes concept: desired state

Suppose you write:

```yaml
spec:
  replicas: 3
```

You are not saying:

> "Create three Pods once."

You are saying:

> **"The desired state is three replicas."**

Kubernetes controllers continuously work to make reality match that desired state.

Conceptually:

```text
                 desired state
                      │
                      ▼
                ┌───────────┐
                │ Deployment│
                │ replicas=3│
                └─────┬─────┘
                      │
                      ▼
               Kubernetes controller
                      │
                      ▼
             actual cluster state
                      │
              ┌───────┼───────┐
              ▼       ▼       ▼
             Pod     Pod     Pod
```

If one Pod dies:

```text
desired = 3
actual  = 2
```

The controller notices and creates another Pod.

This is the heart of Kubernetes.

---

# 23. Deployment: the canonical example

A Deployment is one of the best resources for learning Kubernetes YAML.

```yaml
apiVersion: apps/v1
kind: Deployment

metadata:
  name: my-api
  labels:
    app: my-api

spec:
  replicas: 3

  selector:
    matchLabels:
      app: my-api

  template:
    metadata:
      labels:
        app: my-api

    spec:
      containers:
        - name: api
          image: nginx:1.27

          ports:
            - containerPort: 80
```

Let's break this down.

---

# 24. Deployment structure

Think of it as:

```text
Deployment
│
├── metadata
│
└── spec
    │
    ├── replicas
    │
    ├── selector
    │
    └── template
        │
        ├── metadata
        │   └── labels
        │
        └── spec
            └── containers
                └── container
                    ├── name
                    ├── image
                    └── ports
```

That nested `template` is crucial.

---

# 25. What is template?

A Deployment does not directly describe a Pod.

It describes:

> **"What should the Pods I manage look like?"**

That Pod definition is:

```yaml
template:
  metadata:
    labels:
      app: my-api

  spec:
    containers:
      - name: api
        image: nginx:1.27
```

So:

```text
Deployment
    │
    └── Pod template
            │
            └── Pods created from this template
```

This is why you see:

```yaml
spec:
  template:
    metadata:
    spec:
```

It is essentially a **Pod specification embedded inside the Deployment**.

---

# 26. Deployment replicas

```yaml
spec:
  replicas: 3
```

Desired number of Pod replicas.

If you have:

```yaml
replicas: 5
```

the Deployment attempts to maintain five Pods.

---

# 27. Deployment selector

```yaml
selector:
  matchLabels:
    app: my-api
```

This tells the Deployment which Pods belong to it.

The selector should correspond to labels on the Pod template:

```yaml
template:
  metadata:
    labels:
      app: my-api
```

Conceptually:

```text
Deployment selector
        │
        │ matches
        ▼
Pod label
```

This relationship is fundamental.

---

# 28. Containers

Inside a Pod:

```yaml
spec:
  containers:
    - name: api
      image: nginx:1.27
```

`containers` is a **list**.

That means a Pod can have multiple containers:

```yaml
containers:
  - name: app
    image: my-app:1.0

  - name: sidecar
    image: envoy:latest
```

A Pod is therefore:

```text
Pod
├── container: app
└── container: sidecar
```

---

# 29. Container image

```yaml
image: nginx:1.27
```

This specifies the container image.

Examples:

```yaml
image: nginx:1.27
```

```yaml
image: redis:7
```

```yaml
image: ghcr.io/company/my-api:1.4.2
```

The image can include:

```text
registry
    /
repository
    :
tag
```

For example:

```text
ghcr.io/company/my-api:1.4.2
│       │             │
│       │             └── tag
│       └── repository
└── registry
```

---

# 30. Container ports

```yaml
ports:
  - containerPort: 8080
```

This documents/exposes the port in the container specification.

It does **not automatically make the application reachable from outside the cluster.**

For external or cluster networking, you usually need a Service and/or Ingress.

---

# 31. Service: a completely different spec

A Service might look like:

```yaml
apiVersion: v1
kind: Service

metadata:
  name: my-api

spec:
  selector:
    app: my-api

  ports:
    - port: 80
      targetPort: 8080

  type: ClusterIP
```

Compare the structure with Deployment.

Deployment:

```yaml
spec:
  replicas:
  selector:
  template:
```

Service:

```yaml
spec:
  selector:
  ports:
  type:
```

Same YAML language.

**Different Kubernetes API schema.**

---

# 32. Service selector

The Service:

```yaml
selector:
  app: my-api
```

finds Pods with:

```yaml
labels:
  app: my-api
```

So the relationship is:

```text
Service
   │
   │ selector: app=my-api
   ▼
Pods
   │
   ├── label app=my-api
   ├── label app=my-api
   └── label app=my-api
```

This is one of the most important Kubernetes relationships to understand.

---

# 33. Service ports

Example:

```yaml
ports:
  - port: 80
    targetPort: 8080
```

Think:

```text
Service :80
    │
    ▼
Pod/container :8080
```

`port` is the Service port.

`targetPort` is where traffic is sent on the selected Pods.

---

# 34. Service types

Common:

```yaml
type: ClusterIP
```

```yaml
type: NodePort
```

```yaml
type: LoadBalancer
```

Conceptually:

```text
ClusterIP
    → internal cluster access

NodePort
    → exposes a port on cluster nodes

LoadBalancer
    → requests an external load balancer where supported
```

---

# 35. Pod

A Pod is the smallest deployable unit in Kubernetes.

Minimal example:

```yaml
apiVersion: v1
kind: Pod

metadata:
  name: my-pod

spec:
  containers:
    - name: nginx
      image: nginx:1.27
```

Notice:

```text
Deployment
    └── template
         └── Pod spec

Pod
    └── spec
```

A Pod does not need a Deployment.

But in normal production workloads, you usually use a controller such as a Deployment instead of manually managing Pods.

---

# 36. ReplicaSet

ReplicaSet maintains a desired number of matching Pods.

Example structure:

```yaml
apiVersion: apps/v1
kind: ReplicaSet

metadata:
  name: my-api

spec:
  replicas: 3

  selector:
    matchLabels:
      app: my-api

  template:
    metadata:
      labels:
        app: my-api

    spec:
      containers:
        - name: api
          image: nginx
```

Notice how similar this is to Deployment.

A Deployment usually manages ReplicaSets:

```text
Deployment
    │
    ▼
ReplicaSet
    │
    ▼
Pods
```

You normally create Deployments rather than directly managing ReplicaSets.

---

# 37. StatefulSet

StatefulSets are designed for workloads requiring stable identity and/or persistent storage.

Example:

```yaml
apiVersion: apps/v1
kind: StatefulSet

metadata:
  name: postgres

spec:
  serviceName: postgres
  replicas: 3

  selector:
    matchLabels:
      app: postgres

  template:
    metadata:
      labels:
        app: postgres

    spec:
      containers:
        - name: postgres
          image: postgres:17
```

It looks familiar because Kubernetes deliberately reuses many structures.

But the semantics are different.

---

# 38. DaemonSet

A DaemonSet is conceptually:

> "Run a Pod on every eligible node."

Example:

```yaml
apiVersion: apps/v1
kind: DaemonSet

metadata:
  name: node-agent

spec:
  selector:
    matchLabels:
      app: node-agent

  template:
    metadata:
      labels:
        app: node-agent

    spec:
      containers:
        - name: agent
          image: my-agent:1.0
```

Common use cases:

- logging agents
- monitoring agents
- node-level networking components

---

# 39. Job

A Job represents work that should complete.

```yaml
apiVersion: batch/v1
kind: Job

metadata:
  name: database-migration

spec:
  template:
    spec:
      restartPolicy: Never

      containers:
        - name: migration
          image: my-app:1.0
          command:
            - python
            - manage.py
            - migrate
```

Think:

```text
Deployment
    → keep application running

Job
    → perform work until completion
```

---

# 40. CronJob

A CronJob creates Jobs according to a schedule.

```yaml
apiVersion: batch/v1
kind: CronJob

metadata:
  name: nightly-job

spec:
  schedule: "0 2 * * *"

  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: Never

          containers:
            - name: backup
              image: my-backup:1.0
```

Notice the nesting:

```text
CronJob
└── jobTemplate
    └── spec
        └── template
            └── spec
                └── containers
```

This can look intimidating.

But it is logical:

```text
CronJob
    creates
Job
    creates
Pod
    runs
Container
```

---

# 41. ConfigMap

ConfigMaps store non-secret configuration.

```yaml
apiVersion: v1
kind: ConfigMap

metadata:
  name: app-config

data:
  APP_ENV: production
  LOG_LEVEL: info
  API_URL: https://api.example.com
```

Notice there is no normal:

```yaml
spec:
```

The resource schema is different.

This is why memorising "every Kubernetes object must have spec" is wrong.

---

# 42. Secret

Secrets hold sensitive configuration.

```yaml
apiVersion: v1
kind: Secret

metadata:
  name: app-secret

type: Opaque

stringData:
  DATABASE_USER: app
  DATABASE_PASSWORD: my-password
```

You may also see:

```yaml
data:
  DATABASE_PASSWORD: ...
```

`data` values are expected to be base64-encoded.

Important:

> **Base64 is encoding, not encryption.**

Kubernetes Secret objects therefore should not be treated as automatically equivalent to a secure external secret-management system.

---

# 43. PersistentVolumeClaim

A PVC asks Kubernetes for persistent storage.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim

metadata:
  name: app-data

spec:
  accessModes:
    - ReadWriteOnce

  resources:
    requests:
      storage: 10Gi
```

Think:

```text
PVC
  │
  │ requests
  ▼
persistent storage
```

Important fields include:

```text
accessModes
resources.requests.storage
storageClassName
```

---

# 44. Ingress

Ingress defines HTTP/HTTPS routing into services.

Example:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress

metadata:
  name: my-api

spec:
  rules:
    - host: api.example.com

      http:
        paths:
          - path: /
            pathType: Prefix

            backend:
              service:
                name: my-api
                port:
                  number: 80
```

Conceptually:

```text
Internet
   │
   ▼
Ingress
   │
   │ host/path
   ▼
Service
   │
   ▼
Pods
```

Ingress is another excellent example of a resource whose `spec` is completely different from a Deployment's.

---

# 45. Labels: the glue between resources

This deserves special emphasis.

Imagine:

```yaml
# Deployment
metadata:
  labels:
    app: my-api

spec:
  selector:
    matchLabels:
      app: my-api

  template:
    metadata:
      labels:
        app: my-api
```

and:

```yaml
# Service
spec:
  selector:
    app: my-api
```

The same label connects everything:

```text
                 app=my-api
                     │
          ┌──────────┴──────────┐
          ▼                     ▼
     Deployment              Service
          │                     │
          │ selector             │ selector
          ▼                     ▼
        Pods ◄───────────────────┘
```

This is much more important than memorising YAML syntax.

---

# 46. YAML structure vs Kubernetes semantics

Always separate these two questions.

## Question 1 — Is the YAML structurally valid?

For example:

```yaml
metadata:
  name: api
```

This is YAML syntax.

## Question 2 — Is the Kubernetes object valid?

For example:

```yaml
kind: Deployment

spec:
  banana: 123
```

This may be valid YAML but invalid Kubernetes because `banana` is not a valid Deployment field.

Therefore:

```text
YAML parser
    ↓
"Is this valid YAML?"
    ↓
Kubernetes API validation
    ↓
"Is this valid for this apiVersion + kind?"
```

---

# 47. How to read a Kubernetes YAML file

Use this exact method.

## Step 1 — Find apiVersion

```yaml
apiVersion: apps/v1
```

Ask:

> Which API contract am I dealing with?

## Step 2 — Find kind

```yaml
kind: Deployment
```

Ask:

> What object is this?

## Step 3 — Read metadata

```yaml
metadata:
  name: api
  namespace: production
```

Ask:

> What is this object called and where does it live?

## Step 4 — Find spec

```yaml
spec:
```

Ask:

> What desired state is being requested?

## Step 5 — Identify the major blocks

For a Deployment:

```text
replicas
selector
template
```

For a Service:

```text
selector
ports
type
```

For a ConfigMap:

```text
data
```

## Step 6 — Follow indentation

Don't read it as a flat document.

Read it as a tree.

---

# 48. How to write Kubernetes YAML

Do not start by writing random fields.

Use this process.

### Step 1

Decide:

> What Kubernetes object do I need?

Example:

> I need a Deployment.

### Step 2

Find the correct API version.

```yaml
apiVersion: apps/v1
```

### Step 3

Set the kind.

```yaml
kind: Deployment
```

### Step 4

Give it an identity.

```yaml
metadata:
  name: my-api
```

### Step 5

Define the desired state.

```yaml
spec:
```

### Step 6

Build the resource according to its schema.

```yaml
spec:
  replicas: 3
  ...
```

### Step 7

Add the relationships.

For example:

```yaml
selector:
  matchLabels:
    app: my-api
```

### Step 8

Define the Pod/container if the resource creates Pods.

```yaml
template:
  metadata:
    labels:
      app: my-api

  spec:
    containers:
      - name: api
        image: my-api:1.0
```

---

# 49. Don't memorise every key

This is probably the most important learning advice.

You should memorise **patterns**, not every field.

Know these patterns extremely well:

```text
apiVersion
kind
metadata
spec
```

Then know the major Kubernetes relationships:

```text
Deployment
    ↓
ReplicaSet
    ↓
Pod
    ↓
Container
```

and:

```text
Service
    ↓ selector
Pods
```

and:

```text
Ingress
    ↓
Service
    ↓
Pods
```

and:

```text
PVC
    ↓
Persistent storage
```

Once you understand these relationships, the YAML becomes much easier.

---

# 50. The "schema tree" mental model

When learning a new resource, think:

```text
kind: X
│
└── spec
    │
    ├── field A
    │
    ├── field B
    │
    └── field C
```

Then learn the type of each field:

```text
field A → scalar
field B → object
field C → list
```

For example:

```yaml
spec:
  replicas: 3
```

`replicas` is a scalar.

```yaml
spec:
  selector:
    matchLabels:
      app: api
```

`selector` is an object.

```yaml
spec:
  containers:
    - name: api
      image: nginx
```

`containers` is a list of objects.

This way of thinking makes complex manifests much easier.

---

# 51. Scalar vs object vs list

You should be able to recognise these instantly.

## Scalar

```yaml
replicas: 3
```

One value.

## Object

```yaml
selector:
  matchLabels:
    app: api
```

Nested key/value structure.

## List

```yaml
containers:
  - name: api
    image: nginx
  - name: worker
    image: redis
```

Multiple objects.

---

# 52. Kubernetes YAML as a tree

Take:

```yaml
spec:
  containers:
    - name: api
      image: nginx
      ports:
        - containerPort: 8080
```

Mentally convert it into:

```text
spec
└── containers [LIST]
    └── item 0 [OBJECT]
        ├── name
        ├── image
        └── ports [LIST]
            └── item 0 [OBJECT]
                └── containerPort
```

If you can do this mentally, Kubernetes YAML becomes much less mysterious.

---

# 53. Common container fields

Inside a container you will commonly encounter:

```yaml
containers:
  - name: api
    image: my-api:1.0

    command:
      - python
      - app.py

    args:
      - --port
      - "8080"

    ports:
      - containerPort: 8080

    env:
      - name: APP_ENV
        value: production

    resources:
      requests:
        cpu: "100m"
        memory: "128Mi"
      limits:
        cpu: "500m"
        memory: "512Mi"

    readinessProbe:
      httpGet:
        path: /health
        port: 8080

    livenessProbe:
      httpGet:
        path: /health
        port: 8080
```

Do not memorise all of this immediately.

Recognise the pattern:

```text
container
├── identity
├── image
├── process
├── networking
├── environment
├── resources
└── health
```

---

# 54. Environment variables

Example:

```yaml
env:
  - name: APP_ENV
    value: production

  - name: PORT
    value: "8080"
```

Notice:

```yaml
env:
  -
```

because `env` is a list.

You can also load variables from a ConfigMap or Secret.

For example:

```yaml
envFrom:
  - configMapRef:
      name: app-config
```

or:

```yaml
envFrom:
  - secretRef:
      name: app-secret
```

---

# 55. Resources: requests and limits

Example:

```yaml
resources:
  requests:
    cpu: "100m"
    memory: "128Mi"

  limits:
    cpu: "500m"
    memory: "512Mi"
```

Think:

```text
requests
    → resources Kubernetes should reserve/schedule around

limits
    → maximum resource consumption allowed by the container runtime/kernel mechanisms
```

The details of CPU and memory enforcement matter, but the YAML structure is simply:

```text
resources
├── requests
│   ├── cpu
│   └── memory
└── limits
    ├── cpu
    └── memory
```

---

# 56. Probes

Health checks are commonly:

```yaml
livenessProbe:
```

and:

```yaml
readinessProbe:
```

Conceptually:

```text
liveness
    → "Is this container still alive?"

readiness
    → "Can this Pod receive traffic?"
```

A readiness failure does not necessarily mean the container should be restarted.

That distinction is important.

---

# 57. Volumes

A Pod can define volumes:

```yaml
spec:
  volumes:
    - name: app-data
      emptyDir: {}
```

Then mount them into a container:

```yaml
containers:
  - name: api
    image: my-api:1.0

    volumeMounts:
      - name: app-data
        mountPath: /data
```

Notice the relationship:

```text
volumes
   │
   │ name: app-data
   ▼
volumeMounts
   │
   ▼
/data
```

The name connects the two sections.

---

# 58. The importance of names

Kubernetes YAML contains many internal references.

For example:

```yaml
volumes:
  - name: app-data
```

and:

```yaml
volumeMounts:
  - name: app-data
```

The names connect them.

Likewise:

```yaml
service:
  name: my-api
```

references:

```yaml
kind: Service
metadata:
  name: my-api
```

This is another major reading skill:

> **When you see a `name:` inside a nested object, ask what other object it references.**

---

# 59. A complete small application

Here is a realistic simple application consisting of a Deployment + Service.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  labels:
    app: web

spec:
  replicas: 3

  selector:
    matchLabels:
      app: web

  template:
    metadata:
      labels:
        app: web

    spec:
      containers:
        - name: web
          image: nginx:1.27
          ports:
            - containerPort: 80

---
apiVersion: v1
kind: Service
metadata:
  name: web

spec:
  selector:
    app: web

  ports:
    - port: 80
      targetPort: 80

  type: ClusterIP
```

Read it as:

```text
Deployment "web"
    │
    │ wants 3 Pods
    ▼
Pods labelled app=web
    ▲
    │
Service "web"
    │
    │ selects app=web
    ▼
Pods
```

This is much easier to understand than memorising the raw YAML.

---

# 60. kubectl is your feedback loop

You should rarely write Kubernetes YAML blindly.

Use:

```bash
kubectl apply -f deployment.yaml
```

Then inspect:

```bash
kubectl get deployments
kubectl get pods
kubectl get services
```

More detail:

```bash
kubectl describe deployment web
kubectl describe pod <pod-name>
```

Logs:

```bash
kubectl logs <pod-name>
```

---

# 61. Validate before applying

A useful workflow is:

```bash
kubectl apply --dry-run=client -f app.yaml
```

For stronger API-side validation against the cluster:

```bash
kubectl apply --dry-run=server -f app.yaml
```

You can also use:

```bash
kubectl explain deployment
```

and:

```bash
kubectl explain deployment.spec
```

and:

```bash
kubectl explain deployment.spec.template
```

This is extremely useful.

---

# 62. kubectl explain: your built-in dictionary

Instead of memorising everything, use:

```bash
kubectl explain deployment
```

Then:

```bash
kubectl explain deployment.spec
```

Then:

```bash
kubectl explain deployment.spec.template.spec.containers
```

You are effectively walking down the schema tree.

Think:

```text
kubectl explain
       ↓
resource
       ↓
field
       ↓
nested field
       ↓
nested field
```

This is one of the best ways to learn Kubernetes YAML.

---

# 63. How to discover fields

Suppose you want to know whether a Deployment supports:

```yaml
strategy:
```

Ask:

```bash
kubectl explain deployment.spec.strategy
```

For a Service:

```bash
kubectl explain service.spec
```

For a Pod:

```bash
kubectl explain pod.spec
```

You don't need to rely exclusively on memory.

---

# 64. `kubectl get -o yaml`

A very useful learning trick:

```bash
kubectl get deployment web -o yaml
```

This shows the object as Kubernetes sees it.

But be careful:

**The output may contain fields Kubernetes generated or manages itself.**

For example, you may see:

```yaml
status:
```

You generally do not write `status` into your normal desired-state manifest.

Think:

```text
spec
    → what you want

status
    → what Kubernetes reports is happening
```

---

# 65. spec vs status

This is a foundational Kubernetes idea.

```text
spec
  = desired state

status
  = observed/current state
```

Example:

```yaml
spec:
  replicas: 3
```

Kubernetes may report:

```yaml
status:
  readyReplicas: 3
```

You request the first.

Kubernetes/controllers produce the second.

---

# 66. Why generated YAML can look enormous

If you run:

```bash
kubectl get deployment web -o yaml
```

you may see:

```yaml
metadata:
  creationTimestamp:
  generation:
  resourceVersion:
  uid:
```

and:

```yaml
status:
```

Do not copy everything into your own manifest.

A hand-written manifest should normally contain only the configuration you actually intend to manage.

This keeps it:

- readable
- portable
- maintainable
- easier to understand

---

# 67. Fields you should usually NOT hand-write

You will often see fields such as:

```yaml
metadata:
  uid:
  resourceVersion:
  creationTimestamp:
  generation:
```

and:

```yaml
status:
```

These are generally managed by Kubernetes.

Do not treat the output of:

```bash
kubectl get -o yaml
```

as a clean template for your source-control manifest.

---

# 68. Declarative vs imperative

Kubernetes strongly encourages declarative configuration.

Imperative:

```bash
kubectl create deployment web --image=nginx
```

Declarative:

```yaml
apiVersion: apps/v1
kind: Deployment
...
```

then:

```bash
kubectl apply -f deployment.yaml
```

Declarative means:

> "Here is the state I want."

Rather than:

> "Execute these exact steps."

This is one of the reasons YAML manifests are so central to Kubernetes.

---

# 69. `apply` mental model

When you run:

```bash
kubectl apply -f app.yaml
```

you are essentially saying:

> "Make the cluster converge toward the configuration described by this manifest."

The controllers then work continuously to maintain the desired state.

---

# 70. Common YAML mistakes

## Mistake 1 — Wrong indentation

Bad:

```yaml
metadata:
name: api
```

Good:

```yaml
metadata:
  name: api
```

---

## Mistake 2 — Wrong list indentation

Bad:

```yaml
containers:
- name: api
image: nginx
```

Good:

```yaml
containers:
  - name: api
    image: nginx
```

Some YAML parsers accept multiple indentation styles, but consistent indentation is far easier to read.

---

## Mistake 3 — Wrong hierarchy

Bad:

```yaml
spec:
  replicas: 3

template:
  ...
```

For a Deployment, `template` belongs inside `spec`:

```yaml
spec:
  replicas: 3

  template:
    ...
```

---

## Mistake 4 — Wrong API version

```yaml
apiVersion: v1
kind: Deployment
```

This is wrong because Deployment belongs to the `apps` API group.

Typically:

```yaml
apiVersion: apps/v1
kind: Deployment
```

---

## Mistake 5 — Confusing Pod and Deployment spec

Deployment:

```yaml
spec:
  template:
    spec:
      containers:
```

Pod:

```yaml
spec:
  containers:
```

Why?

Because:

```text
Deployment
    └── Pod template
        └── Pod spec
```

---

# 71. Another common mistake: selector mismatch

Deployment:

```yaml
selector:
  matchLabels:
    app: web
```

but:

```yaml
template:
  metadata:
    labels:
      app: api
```

Now the selector and Pod label don't match.

Correct:

```yaml
selector:
  matchLabels:
    app: web

template:
  metadata:
    labels:
      app: web
```

Likewise, a Service selecting:

```yaml
selector:
  app: web
```

needs Pods carrying:

```yaml
labels:
  app: web
```

---

# 72. A powerful way to visualise Kubernetes YAML

Imagine every manifest as a tree.

Example:

```yaml
apiVersion: apps/v1
kind: Deployment

metadata:
  name: web

spec:
  replicas: 3

  template:
    metadata:
      labels:
        app: web

    spec:
      containers:
        - name: web
          image: nginx
```

Tree:

```text
Deployment
│
├── apiVersion
│
├── metadata
│   └── name
│
└── spec
    ├── replicas
    │
    └── template
        │
        ├── metadata
        │   └── labels
        │       └── app
        │
        └── spec
            └── containers
                └── item
                    ├── name
                    └── image
```

The indentation is simply the textual representation of this tree.

---

# 73. Resource cheat sheet

| Resource | Main purpose | Important fields |
|---|---|---|
| Pod | Run containers | `containers`, `volumes`, `restartPolicy` |
| Deployment | Manage stateless Pods | `replicas`, `selector`, `template`, `strategy` |
| ReplicaSet | Maintain Pod count | `replicas`, `selector`, `template` |
| StatefulSet | Stateful workloads | `serviceName`, `replicas`, `selector`, `template`, storage |
| DaemonSet | One Pod per eligible node | `selector`, `template` |
| Job | Run-to-completion work | `template`, completion settings |
| CronJob | Scheduled Jobs | `schedule`, `jobTemplate` |
| Service | Stable network endpoint | `selector`, `ports`, `type` |
| Ingress | HTTP/HTTPS routing | `rules`, `tls` |
| ConfigMap | Non-secret configuration | `data`, `binaryData` |
| Secret | Sensitive configuration | `data`, `stringData`, `type` |
| PVC | Request persistent storage | `accessModes`, `resources`, `storageClassName` |
| Namespace | Logical cluster partition | `metadata` |

---

# 74. The patterns worth memorising

If you want to become good at Kubernetes, memorise these patterns.

## Pattern A — Resource identity

```yaml
apiVersion: ...
kind: ...
metadata:
  name: ...
```

## Pattern B — Desired state

```yaml
spec:
  ...
```

## Pattern C — Pod-producing controller

```yaml
spec:
  ...
  template:
    metadata:
      labels:
        ...
    spec:
      containers:
        - ...
```

## Pattern D — Selector

```yaml
selector:
  matchLabels:
    app: my-app
```

## Pattern E — List

```yaml
containers:
  - name: app
    image: ...
  - name: sidecar
    image: ...
```

## Pattern F — Reference by name

```yaml
service:
  name: my-service
```

or:

```yaml
secretRef:
  name: my-secret
```

---

# 75. How to approach a new resource you have never used

Suppose someone gives you:

```yaml
kind: StatefulSet
```

and you've never written one.

Don't panic.

Use this process:

```text
1. Identify kind
       ↓
2. Find apiVersion
       ↓
3. Read metadata
       ↓
4. Look at spec
       ↓
5. Use kubectl explain
       ↓
6. Identify lists vs objects vs scalar fields
       ↓
7. Understand what other resources it references
```

For example:

```bash
kubectl explain statefulset
kubectl explain statefulset.spec
kubectl explain statefulset.spec.template
kubectl explain statefulset.spec.template.spec
```

You can learn almost any Kubernetes resource this way.

---

# 76. The deeper truth: Kubernetes YAML is an API contract

This is the most useful advanced mental model.

A manifest is not merely a configuration file.

It is a request to the Kubernetes API.

For example:

```yaml
apiVersion: apps/v1
kind: Deployment
...
```

means:

> "Send this object to the Kubernetes API, and interpret it according to the `apps/v1 Deployment` schema."

Therefore:

```text
YAML syntax
     ↓
Object representation
     ↓
Kubernetes API schema
     ↓
Validation
     ↓
Controller
     ↓
Actual cluster resources
```

---

# 77. The complete flow

Suppose you write:

```yaml
apiVersion: apps/v1
kind: Deployment

metadata:
  name: web

spec:
  replicas: 3

  selector:
    matchLabels:
      app: web

  template:
    metadata:
      labels:
        app: web

    spec:
      containers:
        - name: web
          image: nginx:1.27
```

Then:

```text
YAML
 │
 ▼
kubectl
 │
 ▼
Kubernetes API server
 │
 ▼
Validate apps/v1 Deployment schema
 │
 ▼
Store desired object
 │
 ▼
Deployment controller
 │
 ▼
ReplicaSet
 │
 ▼
Pods
 │
 ▼
Scheduler
 │
 ▼
Node
 │
 ▼
Container runtime
 │
 ▼
nginx container
```

That is what the YAML is ultimately driving.

---

# 78. Your learning progression

A good order for learning Kubernetes YAML is:

### Level 1 — YAML

Learn:

```text
key/value
indentation
objects
lists
strings
numbers
booleans
comments
multi-document files
```

### Level 2 — Kubernetes object structure

Learn:

```text
apiVersion
kind
metadata
spec
status
```

### Level 3 — Pods

Learn:

```text
containers
image
ports
env
resources
probes
volumes
volumeMounts
```

### Level 4 — Controllers

Learn:

```text
Deployment
ReplicaSet
StatefulSet
DaemonSet
Job
CronJob
```

### Level 5 — Networking

Learn:

```text
Service
ClusterIP
NodePort
LoadBalancer
Ingress
selectors
ports
targetPorts
```

### Level 6 — Configuration and storage

Learn:

```text
ConfigMap
Secret
PVC
PV
StorageClass
```

### Level 7 — Security

Learn:

```text
ServiceAccount
Role
RoleBinding
ClusterRole
ClusterRoleBinding
SecurityContext
```

---

# 79. A practical exercise

Create a file:

```text
web.yaml
```

Start with:

```yaml
apiVersion: apps/v1
kind: Deployment

metadata:
  name: web

spec:
  replicas: 3

  selector:
    matchLabels:
      app: web

  template:
    metadata:
      labels:
        app: web

    spec:
      containers:
        - name: web
          image: nginx:1.27
```

Apply it:

```bash
kubectl apply -f web.yaml
```

Then:

```bash
kubectl get deployment
kubectl get replicaset
kubectl get pods
```

Then:

```bash
kubectl describe deployment web
```

Then:

```bash
kubectl get deployment web -o yaml
```

Compare the YAML you wrote with the YAML Kubernetes returns.

That exercise teaches a huge amount.

---

# 80. The five questions to ask when reading ANY Kubernetes YAML

Whenever you open a manifest, ask:

### 1. What is it?

```yaml
kind:
```

### 2. Which API defines it?

```yaml
apiVersion:
```

### 3. What is it called?

```yaml
metadata:
  name:
```

### 4. What does it want?

```yaml
spec:
```

### 5. What does it connect to?

Look for:

```text
selector
name
ref
service
secret
configMap
volume
```

Those five questions will let you understand most manifests surprisingly quickly.

---

# 81. The one rule that prevents most confusion

Do **not** learn Kubernetes YAML as:

> `Deployment has these 25 keys, Service has these 12 keys, Pod has these 30 keys...`

Learn it as:

> **"Each `kind` has a schema. YAML expresses that schema as a tree."**

Then:

```text
kind = Deployment
       ↓
learn Deployment schema

kind = Service
       ↓
learn Service schema

kind = StatefulSet
       ↓
learn StatefulSet schema
```

This is why Kubernetes documentation and:

```bash
kubectl explain
```

are so useful.

---

# 82. Final mental model

If you remember nothing else, remember this:

```text
                    KUBERNETES YAML

                         YAML
                          │
                  indentation = tree
                          │
                          ▼
                 Kubernetes Object
                          │
              ┌───────────┴───────────┐
              │                       │
          apiVersion                 kind
              │                       │
       API contract              object type
                                      │
                                      ▼
                                  metadata
                                      │
                                identity/labels
                                      │
                                      ▼
                                    spec
                                      │
                              desired state
                                      │
                                      ▼
                              Kubernetes controllers
                                      │
                                      ▼
                              actual cluster state
```

And for the most common application:

```text
Deployment
    │
    ├── replicas
    ├── selector
    │
    └── template
          │
          └── Pod
                │
                └── containers
                      │
                      └── image

Service
    │
    └── selector
          │
          ▼
        Pods

Ingress
    │
    ▼
Service
    │
    ▼
Pods
```

Once you see Kubernetes YAML as **a typed tree describing relationships between Kubernetes objects**, rather than as a collection of magical keys, it becomes much easier to write and understand.
