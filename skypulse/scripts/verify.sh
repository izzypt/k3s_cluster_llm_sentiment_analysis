#!/usr/bin/env bash
# Proves, against the running cluster, that the security boundary and the HA setup work.
# Every check runs a tiny Python snippet *inside* a real pod, so it tests exactly what the
# workloads themselves are allowed to do.
set -uo pipefail

NS_A=skypulse-analysis
NS_I=skypulse-ingestion
NS_D=skypulse-data
NS_M=skypulse-monitoring
DB=feeddb-rw.$NS_D.svc.cluster.local
pass=0
fail=0

green() { printf '\033[32m%s\033[0m\n' "$*"; }
red() { printf '\033[31m%s\033[0m\n' "$*"; }

# can_connect <namespace> <deployment> <host> <port>  -> exit 0 if a TCP connection succeeds
can_connect() {
  if [[ $1 == "$NS_M" ]]; then  # the monitoring images have no Python, but busybox's nc
    kubectl -n "$1" exec "deploy/$2" -c "$2" -- nc -z -w 4 "$3" "$4" >/dev/null 2>&1
    return
  fi
  kubectl -n "$1" exec "deploy/$2" -c "$2" -- python -c "
import socket, sys
try:
    socket.create_connection(('$3', $4), timeout=4).close()
except OSError:
    sys.exit(1)
" >/dev/null 2>&1
}

expect() {  # expect <allowed|blocked> <description> <can_connect args...>
  local want=$1 desc=$2
  shift 2
  if can_connect "$@"; then got=allowed; else got=blocked; fi
  if [[ $got == "$want" ]]; then
    green "  PASS  $desc ($got)"
    pass=$((pass + 1))
  else
    red "  FAIL  $desc (expected $want, got $got)"
    fail=$((fail + 1))
  fi
}

echo "== Security boundary: analysis zone has no internet access"
expect blocked "api      -> internet (api.bsky.app:443)" $NS_A api api.bsky.app 443
expect blocked "analyzer -> internet (1.1.1.1:443)" $NS_A analyzer 1.1.1.1 443
expect allowed "api      -> postgres (feeddb-rw.$NS_D:5432)" $NS_A api "$DB" 5432
expect allowed "analyzer -> llm (llm:11434)" $NS_A analyzer llm 11434
expect blocked "api      -> llm (not needed, so not allowed)" $NS_A api llm 11434

echo "== Security boundary: ingestion zone reaches the internet, but not the local network"
expect allowed "ingestor -> internet (api.bsky.app:443)" $NS_I ingestor api.bsky.app 443
expect allowed "ingestor -> postgres (feeddb-rw.$NS_D:5432)" $NS_I ingestor "$DB" 5432
expect blocked "ingestor -> api (api.$NS_A:80)" $NS_I ingestor "api.$NS_A.svc.cluster.local" 80
expect blocked "ingestor -> llm (llm.$NS_A:11434)" $NS_I ingestor "llm.$NS_A.svc.cluster.local" 11434

echo "== Least privilege: the zones' database roles"
if kubectl -n $NS_I exec deploy/ingestor -- python -c "
import psycopg
c = psycopg.connect('')
c.execute('DELETE FROM subscriptions')  # raises if not permitted
c.rollback()                            # never keep the change, even if it was allowed
" >/dev/null 2>&1; then
  red "  FAIL  ingestor could DELETE subscriptions"; fail=$((fail + 1))
else
  green "  PASS  ingestor cannot delete subscriptions (permission denied)"; pass=$((pass + 1))
fi
if kubectl -n $NS_A exec deploy/api -- python -c "
import psycopg
c = psycopg.connect('')
c.execute('DROP TABLE posts')  # raises if not permitted
c.rollback()                   # never keep the change, even if it was allowed
" >/dev/null 2>&1; then
  red "  FAIL  analysis role could DROP a table"; fail=$((fail + 1))
else
  green "  PASS  analysis role cannot change the schema (permission denied)"; pass=$((pass + 1))
fi
if kubectl -n $NS_A get secret feeddb-app >/dev/null 2>&1 || kubectl -n $NS_I get secret feeddb-app >/dev/null 2>&1; then
  red "  FAIL  the schema owner's credentials exist outside $NS_D"; fail=$((fail + 1))
else
  green "  PASS  the schema owner's credentials exist only in $NS_D"; pass=$((pass + 1))
fi

echo "== Monitoring: Prometheus reads metrics, and nothing else"
# The database pods' metrics port has no Service, so test against the primary's pod IP.
PG_IP=$(kubectl -n $NS_D get pods -l cnpg.io/cluster=feeddb,cnpg.io/instanceRole=primary -o jsonpath='{.items[0].status.podIP}')
expect allowed "prometheus -> postgres metrics ($PG_IP:9187)" $NS_M prometheus "$PG_IP" 9187
expect blocked "prometheus -> postgres SQL ($PG_IP:5432)" $NS_M prometheus "$PG_IP" 5432
expect blocked "prometheus -> internet (1.1.1.1:443)" $NS_M prometheus 1.1.1.1 443
expect blocked "api        -> postgres metrics (only Prometheus may read them)" $NS_A api "$PG_IP" 9187
expect blocked "api        -> prometheus (prometheus.$NS_M:9090)" $NS_A api "prometheus.$NS_M.svc.cluster.local" 9090
pg_pods=$(kubectl -n $NS_D get pods -l cnpg.io/cluster=feeddb,cnpg.io/podRole=instance -o name | wc -l)
ingress_pods=$(kubectl -n kube-system get pods -l app.kubernetes.io/name=traefik -o name | wc -l)
scraped=$(kubectl -n $NS_M exec deploy/prometheus -- wget -qO- 'http://localhost:9090/api/v1/query?query=sum(up)' 2>/dev/null |
  sed -n 's/.*"value":\[[^,]*,"\([0-9]*\)"\].*/\1/p')
if [[ ${scraped:-0} -eq $((pg_pods + ingress_pods)) ]]; then
  green "  PASS  Prometheus scrapes all $pg_pods database instances and $ingress_pods ingress controllers"; pass=$((pass + 1))
else
  red "  FAIL  Prometheus scrapes ${scraped:-0} targets, expected $((pg_pods + ingress_pods))"; fail=$((fail + 1))
fi

echo "== High availability"
api_nodes=$(kubectl -n $NS_A get pods -l app.kubernetes.io/name=api -o jsonpath='{range .items[*]}{.spec.nodeName}{"\n"}{end}' | sort -u | wc -l)
api_pods=$(kubectl -n $NS_A get pods -l app.kubernetes.io/name=api --field-selector=status.phase=Running -o name | wc -l)
pg_nodes=$(kubectl -n $NS_D get pods -l cnpg.io/cluster=feeddb,cnpg.io/podRole=instance -o jsonpath='{range .items[*]}{.spec.nodeName}{"\n"}{end}' | sort -u | wc -l)
if (( api_pods >= 2 && api_nodes >= 2 )); then
  green "  PASS  $api_pods api replicas on $api_nodes different nodes"; pass=$((pass + 1))
else
  red "  FAIL  api: $api_pods replicas on $api_nodes nodes"; fail=$((fail + 1))
fi
if (( pg_nodes >= 2 )); then
  green "  PASS  PostgreSQL instances on $pg_nodes different nodes"; pass=$((pass + 1))
else
  red "  FAIL  PostgreSQL instances on $pg_nodes node(s)"; fail=$((fail + 1))
fi

echo
echo "$pass passed, $fail failed"
(( fail == 0 ))
