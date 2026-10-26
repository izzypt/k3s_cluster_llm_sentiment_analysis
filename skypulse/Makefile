# SkyPulse — build and run the whole system on a local multi-node Kubernetes cluster.
#
#   ./scripts/setup.sh   install any missing prerequisites (make, Docker, kubectl, k3d, uv)
#   make build   install Python deps, run the tests, build the container images
#   make start   create the cluster + registry, install the Postgres operator, deploy everything
#   make update  rebuild the app and roll it out with zero downtime (continuous delivery)
#
# Dashboards: http://grafana.localhost:8090 (Prometheus + Grafana, deployed by `make start`)
#
# Run `make help` for every target.

SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help
# scripts/setup.sh installs kubectl, k3d and uv here; find them even if the shell's PATH doesn't yet.
export PATH := $(HOME)/.local/bin:$(PATH)

CLUSTER        ?= skypulse
REGISTRY       ?= localhost:5050
OLLAMA_VERSION ?= 0.35.1
LLM_MODEL      ?= gemma4:e2b-it-qat
CNPG_VERSION   ?= 1.30.1
CNPG_MANIFEST  := https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-$(basename $(CNPG_VERSION))/releases/cnpg-$(CNPG_VERSION).yaml

APP_IMAGE := $(REGISTRY)/skypulse-app
LLM_IMAGE := $(REGISTRY)/skypulse-llm
# The LLM image is identified by what is inside it: Ollama version + model.
LLM_TAG   := $(OLLAMA_VERSION)-$(subst :,-,$(subst /,-,$(LLM_MODEL)))
# Every app build gets a unique, traceable tag: <git sha>-<timestamp>.
NEW_APP_TAG := $(shell git rev-parse --short HEAD 2>/dev/null || echo local)-$(shell date +%Y%m%d%H%M%S)

BUILD_DIR := .build
NS_A := skypulse-analysis
NS_I := skypulse-ingestion
NS_D := skypulse-data
NS_M := skypulse-monitoring

.PHONY: help
help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

.PHONY: setup
setup: ## Install any missing prerequisites (same as ./scripts/setup.sh)
	./scripts/setup.sh

.PHONY: check-tools
check-tools: ## Verify the required CLI tools are installed and Docker is running
	@./scripts/setup.sh --check

# ---------------------------------------------------------------- build

.PHONY: build
build: check-tools ## Install dependencies, run tests, build the container images
	uv sync --locked
	uv run pytest -q
	docker build -f docker/app.Dockerfile -t $(APP_IMAGE):$(NEW_APP_TAG) .
	@if docker image inspect $(LLM_IMAGE):$(LLM_TAG) >/dev/null 2>&1; then \
	  echo "LLM image $(LLM_IMAGE):$(LLM_TAG) already built, skipping"; \
	else \
	  echo "Building LLM image with $(LLM_MODEL) (downloads several GB, only needed once)"; \
	  docker build -f docker/llm.Dockerfile \
	    --build-arg OLLAMA_VERSION=$(OLLAMA_VERSION) --build-arg LLM_MODEL=$(LLM_MODEL) \
	    -t $(LLM_IMAGE):$(LLM_TAG) . ; \
	fi
	@mkdir -p $(BUILD_DIR)
	@echo "$(NEW_APP_TAG)" > $(BUILD_DIR)/app-tag
	@echo "$(LLM_TAG)" > $(BUILD_DIR)/llm-tag
	@echo "Built $(APP_IMAGE):$(NEW_APP_TAG) and $(LLM_IMAGE):$(LLM_TAG)"

# ---------------------------------------------------------------- start

.PHONY: start
start: check-tools cluster operator secrets push deploy ## Create the cluster (if needed) and deploy everything

.PHONY: cluster
cluster: ## Create (or start) the local k3d cluster and its image registry
	@if k3d cluster get $(CLUSTER) >/dev/null 2>&1; then \
	  echo "Cluster $(CLUSTER) exists, making sure it is running"; k3d cluster start $(CLUSTER); \
	else \
	  k3d cluster create --config cluster/k3d.yaml; \
	fi
	kubectl config use-context k3d-$(CLUSTER)
	kubectl wait --for=condition=Ready nodes --all --timeout=180s
	@# Platform HA: run the bundled ingress controller with 2 replicas (see the file for why)
	kubectl apply -f cluster/traefik-ha.yaml

.PHONY: operator
operator: ## Install the CloudNativePG operator (manages PostgreSQL)
	kubectl apply --server-side --force-conflicts -f $(CNPG_MANIFEST)
	kubectl -n cnpg-system rollout status deployment/cnpg-controller-manager --timeout=300s

.PHONY: secrets
secrets: ## Create the per-zone database credentials (generated once, kept in .secrets/)
	kubectl apply -f k8s/base/namespaces.yaml
	@mkdir -p .secrets
	@# Each role's Secret goes to the data namespace (CloudNativePG creates the role from it)
	@# and to the zone's own namespace (the pods log in with it). Nothing else is shared.
	@for pair in ingestor:$(NS_I) analysis:$(NS_A); do \
	  role=$${pair%%:*}; zone_ns=$${pair#*:}; \
	  test -s .secrets/$$role-password || head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' > .secrets/$$role-password; \
	  for ns in $(NS_D) $$zone_ns; do \
	    kubectl -n $$ns create secret generic $$role-db-credentials \
	      --type=kubernetes.io/basic-auth \
	      --from-literal=username=$$role \
	      --from-file=password=.secrets/$$role-password \
	      --dry-run=client -o yaml | kubectl apply -f - ; \
	  done; \
	  kubectl -n $(NS_D) label secret $$role-db-credentials cnpg.io/reload=true --overwrite; \
	done

.PHONY: push
push: ## Push the built images to the cluster's registry
	@test -f $(BUILD_DIR)/app-tag || { echo "ERROR: no images built yet, run 'make build' first"; exit 1; }
	docker push $(APP_IMAGE):$$(cat $(BUILD_DIR)/app-tag)
	docker push $(LLM_IMAGE):$$(cat $(BUILD_DIR)/llm-tag)

.PHONY: deploy
deploy: ## Apply the Kubernetes manifests with the exact image versions just built
	@mkdir -p $(BUILD_DIR)/deploy
	@# A throw-away overlay on top of k8s/overlays/local that pins the image tags.
	@printf '%s\n' \
	  'apiVersion: kustomize.config.k8s.io/v1beta1' \
	  'kind: Kustomization' \
	  'resources:' \
	  '  - ../../k8s/overlays/local' \
	  'images:' \
	  '  - name: $(APP_IMAGE)' \
	  "    newTag: \"$$(cat $(BUILD_DIR)/app-tag)\"" \
	  '  - name: $(LLM_IMAGE)' \
	  "    newTag: \"$$(cat $(BUILD_DIR)/llm-tag)\"" \
	  > $(BUILD_DIR)/deploy/kustomization.yaml
	@# A Job's pod template is immutable: remove the previous run so the new image migrates.
	kubectl -n $(NS_D) delete job migrate --ignore-not-found
	kubectl apply -k $(BUILD_DIR)/deploy
	@echo "Waiting for PostgreSQL (first start pulls images and initialises the database)..."
	kubectl -n $(NS_D) wait cluster.postgresql.cnpg.io/feeddb --for=condition=Ready --timeout=600s
	kubectl -n $(NS_D) wait job/migrate --for=condition=Complete --timeout=600s
	kubectl -n $(NS_A) rollout status deployment/api --timeout=600s
	kubectl -n $(NS_A) rollout status deployment/analyzer --timeout=300s
	kubectl -n $(NS_I) rollout status deployment/ingestor --timeout=300s
	kubectl -n $(NS_A) rollout status deployment/llm --timeout=900s
	kubectl -n $(NS_M) rollout status deployment/prometheus --timeout=300s
	kubectl -n $(NS_M) rollout status deployment/grafana --timeout=300s
	@echo ""
	@echo "SkyPulse is running:  http://localhost:8090"
	@echo "Dashboards (Grafana): http://grafana.localhost:8090"

# ---------------------------------------------------------------- day 2

.PHONY: update
update: build push deploy ## Continuous delivery: rebuild, push and roll out a new version

.PHONY: status
status: ## Show everything running in the SkyPulse namespaces
	kubectl get nodes -o wide
	kubectl -n $(NS_A) get deploy,pods,svc,ingress,hpa,pdb,networkpolicy -o wide
	kubectl -n $(NS_I) get deploy,pods,networkpolicy -o wide
	kubectl -n $(NS_D) get cluster.postgresql.cnpg.io,job,pods,svc,networkpolicy -o wide
	kubectl -n $(NS_M) get deploy,pods,svc,ingress,pvc,networkpolicy -o wide

.PHONY: logs
logs: ## Follow the logs of all SkyPulse components
	kubectl logs -n $(NS_A) -l app.kubernetes.io/part-of=skypulse --all-containers --prefix -f --max-log-requests 20 & \
	kubectl logs -n $(NS_D) -l cnpg.io/cluster=feeddb --prefix -f & \
	kubectl logs -n $(NS_I) -l app.kubernetes.io/part-of=skypulse --prefix -f ; wait

.PHONY: verify
verify: ## Prove the network security boundary and the high-availability setup
	./scripts/verify.sh

.PHONY: test
test: ## Run the unit tests
	uv run pytest -q

.PHONY: stop
stop: ## Stop the cluster (keeps all data)
	k3d cluster stop $(CLUSTER)

.PHONY: clean
clean: ## Delete the cluster, its registry and all data
	k3d cluster delete $(CLUSTER)
	rm -rf $(BUILD_DIR)
