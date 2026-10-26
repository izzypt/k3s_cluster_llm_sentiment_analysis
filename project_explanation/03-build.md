# 3 · Build: how code becomes an image

Parts: [1 Overview](01-overview.md) · [2 Application](02-application.md) · **3 Build** · [4 Platform](04-platform.md) · [5 Delivery & operations](05-delivery-and-operations.md) · [6 Security boundary](06-security-boundary.md) · [7 Runtime](07-runtime.md) · [8 Code flow](08-code-flow.md)

Each piece answers one question:

| File / tool | Question it answers | Written by |
|---|---|---|
| `pyproject.toml` | What is this project and what does it need? | You |
| `uv.lock` | Exactly which versions, down to the file hash? | uv (generated, but committed) |
| `uv` | The tool that reads those two files and builds the environment | – |
| `docker/*.Dockerfile` | How is it packaged into an image Kubernetes can run? | You |

## 3.1 `pyproject.toml`: the project description

It's the standard Python file (PEP 621), so any tool can read it, not just uv. It has four parts:

```toml
[project]                       # identity + runtime needs
name = "skypulse"
requires-python = ">=3.12"
dependencies = ["fastapi>=0.115", "uvicorn>=0.32", "httpx>=0.28", "psycopg[binary]>=3.2", ...]

[project.scripts]               # commands created on install
skypulse = "skypulse.__main__:main"

[dependency-groups]             # needed only for development, not shipped in the image
dev = ["pytest>=8.3"]

[build-system]                  # how to turn src/skypulse/ into an installable package
build-backend = "uv_build"
```

The dependencies are **ranges** (`>=0.115`). They say "any version from 0.115 up works", not which version you'll actually get.

## 3.2 `uv.lock`: exact, reproducible versions

uv resolves those ranges into one exact set of versions. That set covers 28 packages, because FastAPI pulls in starlette, pydantic and others. The lockfile records each one's version, download URL and **sha256 hash**.

Because it's committed, your laptop, a colleague's machine and the Docker build all install byte-identical dependencies. `--locked` (used in the Makefile and the Dockerfile) means "fail if the lock doesn't match `pyproject.toml`, don't silently re-resolve".

You never edit it by hand. `uv add httpx` or `uv lock` updates it.

## 3.3 `uv`: the tool

uv replaces pip, venv and pip-tools with one fast binary. `uv sync` does three things:

1. Creates `.venv/` with Python 3.12 if it doesn't exist.
2. Installs exactly what `uv.lock` lists, including the `dev` group unless you pass `--no-dev`.
3. Installs **skypulse itself** from `src/skypulse/`, using the `uv_build` backend.

`uv run <cmd>` runs a command inside that `.venv` without activating it, for example `uv run pytest` or `uv run skypulse api`.

### Which package? skypulse itself

The package that `uv sync` installs is the project in `src/skypulse/`, not uv. When a Python package is installed, every entry under `[project.scripts]` becomes a small executable in the virtualenv's `bin/` folder. Running it imports `skypulse.__main__` and calls `main()`.

| Where | Command | Executable created |
|---|---|---|
| Your machine | `uv sync` (run by `make build`) | `.venv/bin/skypulse` (on Windows, `.venv\Scripts\skypulse.exe`) |
| The image | `uv sync ... --no-editable` (`docker/app.Dockerfile`) | `/app/.venv/bin/skypulse` |

## 3.4 The images

### `docker/app.Dockerfile`: one image for every Python role

A multi-stage build:

1. **Build stage** (`python:3.12-slim` + uv):
   - `uv sync --locked --no-dev --no-install-project` installs only the dependencies. This layer is cached until `pyproject.toml` or `uv.lock` change.
   - `COPY src` and `uv sync --locked --no-dev --no-editable` install skypulse itself, which creates the `skypulse` command. Code changes rebuild only this step, in seconds.
2. **Runtime stage** (a clean `python:3.12-slim`): copies only `/app/.venv`, so uv, pytest and the build cache never ship. It runs as a fixed non-root UID (10001), which the cluster's `restricted` Pod Security level requires.

```dockerfile
ENV PATH=/app/.venv/bin:$PATH
USER 10001
ENTRYPOINT ["skypulse"]
CMD ["api"]
```

### `docker/llm.Dockerfile`: Ollama with the model baked in

**Why baked in:** the analysis zone has no internet (S2), and the `llm` pod's NetworkPolicy has `egress: []`. A pod that downloaded the model at startup would need an internet hole exactly where the requirement forbids one. Instead the model is downloaded **once, by the build machine, during `make build`**. Nothing in the cluster ever touches the internet to get it, and the weights travel through the same registry and rollout process as the code.

**Why a temporary server:** the `ollama` command is only a **client**. `pull`, `list`, `run` and `create` all send HTTP requests to an Ollama server on `localhost:11434`, and the **server** downloads the blobs and writes them to `OLLAMA_MODELS` (`/models`). Without a running server, `ollama pull` fails with "could not connect to ollama server". So the build does:

```dockerfile
RUN ollama serve >/tmp/ollama.log 2>&1 & pid=$!; \                              # 1. start the server in the background
    for i in $(seq 1 60); do ollama list >/dev/null 2>&1 && break; sleep 1; done; \  # 2. wait until it answers
    ollama pull "${LLM_MODEL}" && \                                             # 3. the client asks it to download
    kill $pid && \                                                              # 4. stop it
    chmod -R a+rX /models && rm -rf /root/.ollama /tmp/ollama.log               # 5. clean up
```

Everything has to happen in **one `RUN`**. Each `RUN` executes in its own temporary container, and only the files it leaves behind are saved into the layer; a background process started in one `RUN` is gone by the next. What remains in the image is just `/models`. When the pod starts, the image's default command, `ollama serve`, starts the server for real, finds the model already on disk and serves it.

### Tags

| Image | Tag | Why |
|---|---|---|
| `skypulse-app` | `<git sha>-<timestamp>` | Every build is unique and traceable to a commit |
| `skypulse-llm` | `<ollama version>-<model>` | Named after its content; rebuilt only when that changes (several GB). `make build` skips it when the tag already exists |

### From your machine to the pods: build, push, pull

Both images are built by **your machine's Docker**, not inside the cluster, and reach the pods through the k3d registry:

| Stage | Command | What happens |
|---|---|---|
| Build | `make build` | `docker build` → `localhost:5050/skypulse-app:<tag>` and `localhost:5050/skypulse-llm:<tag>` in your local Docker |
| Push | `make push` | `docker push` → the `k3d-skypulse-registry` container (port 5050 on your machine) |
| Pull | `make deploy` | The manifests say `image: localhost:5050/...:<tag>`; the **containerd inside the node container** pulls it when a pod is scheduled there |

There's a catch at the pull: inside a node container, `localhost` is the node itself, not your machine. `cluster/k3d.yaml` solves it with a registry mirror:

```yaml
mirrors:
  "localhost:5050":
    endpoint:
      - http://k3d-skypulse-registry:5000   # the registry container, by its Docker network name
```

containerd transparently redirects `localhost:5050/...` to the registry container, so the same image name works for `docker push` on your machine and for the pull inside the cluster.

```
make build   your Docker:  ollama pull (internet) → image with /models inside
make push    your Docker → k3d-skypulse-registry  (localhost:5050)
make deploy  kubectl apply: image = localhost:5050/skypulse-llm:<tag>
             node's containerd → mirror → k3d-skypulse-registry:5000 → pulls the image
             llm pod starts, model already on disk, no network needed
```

**In production** it's the same idea with other machines: CI (which has internet) builds the image and pushes it to the site's registry (Harbor), where it can be scanned and signed. At an air-gapped site the image is carried across with `docker save` / `load` or registry replication. The nodes pull from Harbor on the local network.

## 3.5 How the role reaches `main()`

One image runs as four different components. Following the API pod from the YAML down to the `if` in `main()`:

**Step 1: the Kubernetes manifest sets the argument.** `k8s/base/analysis/api.yaml`:

```yaml
containers:
  - name: api
    image: skypulse-app      # the image built by make build
    args: ["api"]            # ← the role is set here
```

**Step 2: Kubernetes combines it with the image.** When the container starts, the runtime builds the command line as **ENTRYPOINT + arguments**:

| Kubernetes field | Replaces | SkyPulse sets it? |
|---|---|---|
| `command:` | the image's `ENTRYPOINT` | No, so `skypulse` stays |
| `args:` | the image's `CMD` | Yes, the role |

**Step 3: `skypulse` is the installed command.** `/app/.venv/bin/skypulse` is the script `uv sync` created from `[project.scripts]`. The operating system passes the command line to the process, and Python exposes it as `sys.argv == ["/app/.venv/bin/skypulse", "api"]`.

**Step 4: argparse reads it.** `parser.parse_args()` reads `sys.argv[1:]`, so `args.role == "api"`, which starts uvicorn with FastAPI. Any other value makes argparse print an error and exit.

```
api.yaml  args: ["api"]
   ↓  replaces CMD ["api"] in the Dockerfile
container starts:  skypulse api            (ENTRYPOINT + args)
   ↓  /app/.venv/bin/skypulse → main()
sys.argv = ["skypulse", "api"]
   ↓  argparse
args.role = "api"  →  uvicorn.run("skypulse.api:app")
```

| Manifest | `args` | Runs |
|---|---|---|
| `k8s/base/analysis/api.yaml` | `["api"]` | `skypulse api` |
| `k8s/base/analysis/analyzer.yaml` | `["analyzer"]` | `skypulse analyzer` |
| `k8s/base/ingestion/ingestor.yaml` | `["ingestor"]` | `skypulse ingestor` |
| `k8s/base/data/migrate.yaml` | `["migrate"]` | `skypulse migrate` |

The same mechanism works outside Kubernetes:

```bash
uv run skypulse api                                   # your machine (.venv)
docker run localhost:5050/skypulse-app:<tag> analyzer # Docker: overrides CMD
docker run localhost:5050/skypulse-app:<tag>          # no argument → CMD default → api
```

Any role except `api` needs a database, and the analyzer also needs the LLM. Without them they start, then retry in a loop.

## 3.6 How it all connects

```
pyproject.toml ──(uv lock)──► uv.lock
        │                        │
        └──────(uv sync)─────────┘
                   │
         .venv/  (laptop: tests, local runs)
         /app/.venv  (inside the image: production)
                   │
          `skypulse <role>`  ◄── chosen by args: in k8s/base/*.yaml
```

The key idea is that the same two files produce the environment on your laptop and in the container. If the tests pass locally, they ran against the same dependency versions that ship in the image.
