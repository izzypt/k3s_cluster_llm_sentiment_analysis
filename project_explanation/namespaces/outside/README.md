# Outside the cluster: analysts and operators

Zones: [index](../README.md) · **outside** · [your machine](../your-machine/README.md) · [ingestion](../ingestion/README.md) · [data](../data/README.md) · [analysis](../analysis/README.md) · [monitoring](../monitoring/README.md) · [system](../system/README.md)

> **Not a namespace.** This zone is the people who use SkyPulse, each with a browser. They're outside the cluster and never touch it directly.

## What this zone is

Two kinds of users, and **one door for both**: `localhost:8090`. k3d forwards it to the Traefik ingress controller, which tells the two apart by **hostname**.

```
Analyst   http://localhost:8090            ─┐
                                            ├─▶ k3d load balancer :8090 ─▶ Traefik :80
Operator  http://grafana.localhost:8090   ─┘        (same port; Traefik routes on the Host header)
                │                                         │
                │                         any other host  ├─▶ api       (skypulse-analysis)
                └─────────────────────────────────────────┴─▶ Grafana   (skypulse-monitoring)
```

| User | Opens | Reaches | Code |
|---|---|---|---|
| **Analyst** | `http://localhost:8090` | the api: the web page + JSON API | [`static/index.html`](../../../skypulse/src/skypulse/static/index.html) · [`api.py`](../../../skypulse/src/skypulse/api.py) · [`ingress.yaml`](../../../skypulse/k8s/base/analysis/ingress.yaml) |
| **Operator** | `http://grafana.localhost:8090` | Grafana: the dashboards | [`grafana.yaml`](../../../skypulse/k8s/base/monitoring/grafana.yaml) · [`skypulse-dashboard.json`](../../../skypulse/k8s/base/monitoring/config/skypulse-dashboard.json) |

## The rules it follows

1. **One entry point.** Everything comes in through Traefik. The ingestion and data zones, and the LLM, have no Ingress, so no user can reach them.
2. **Users only reach two Services.** The api accepts traffic only from Traefik ([`analysis/networkpolicies.yaml`](../../../skypulse/k8s/base/analysis/networkpolicies.yaml)), and so does Grafana ([`monitoring/networkpolicies.yaml` L47-L56](../../../skypulse/k8s/base/monitoring/networkpolicies.yaml#L47-L56)).
3. **The analysts' network only.** In production, Traefik's address is a MetalLB IP on the analysts' VLAN, with a real hostname and TLS (`skypulse.analysts.internal`, `grafana.analysts.internal`; [production overlay](../../../skypulse/k8s/overlays/production/kustomization.yaml#L42-L58)).
4. **No login yet.** Analysts aren't authenticated (DESIGN.md §5 #1: add OIDC via oauth2-proxy). Grafana is anonymous and read-only (§5 #8: SSO in production).

## The users

### Analyst

Opens **http://localhost:8090** and gets a single-page app: plain HTML and JavaScript, served by the api ([`api.py` L117-L119](../../../skypulse/src/skypulse/api.py#L117-L119)).

What the page does ([`index.html`](../../../skypulse/src/skypulse/static/index.html)):

| Action | In the browser | On the server |
|---|---|---|
| **See subscriptions** | `refresh()` calls `GET /api/subscriptions` on load and **every 10 s** ([L91-L100](../../../skypulse/src/skypulse/static/index.html#L91-L100), [L125-L126](../../../skypulse/src/skypulse/static/index.html#L125-L126)) | One query joining subscriptions, summaries and pending counts ([`api.py` L50-L68](../../../skypulse/src/skypulse/api.py#L50-L68)) |
| **Subscribe** to `@handle` or `#hashtag` | The form posts the raw text ([L102-L116](../../../skypulse/src/skypulse/static/index.html#L102-L116)); errors (invalid shape, duplicate) are shown under the form | Shape check + `INSERT … ON CONFLICT DO NOTHING`; 422 if invalid, 409 if duplicate ([`api.py` L71-L86](../../../skypulse/src/skypulse/api.py#L71-L86)) |
| **Unsubscribe** | Button → `DELETE /api/subscriptions/{id}` ([L118-L123](../../../skypulse/src/skypulse/static/index.html#L118-L123)) | Row deleted; its posts and summary cascade ([`api.py` L89-L96](../../../skypulse/src/skypulse/api.py#L89-L96)) |

**What each card shows** (`card()`, [L65-L89](../../../skypulse/src/skypulse/static/index.html#L65-L89)):

- the LLM **summary** (or "Waiting for the first analysis…"), with the overall label as a badge (positive / neutral / negative / mixed);
- a positive / neutral / negative **bar**;
- **how many posts it covers** and **when it was last updated**, which the brief asks for;
- the number of posts awaiting analysis, and when Bluesky was last fetched;
- `last_error` from the ingestor as a warning, e.g. "Not found on Bluesky: …" for an unknown handle;
- all text is escaped (`esc()`) before it's inserted, so post content can't inject HTML.

**Why it's always fast:** the page never waits for the LLM or Bluesky. A new subscription is stored in milliseconds; its first summary appears on a later refresh, once the ingestor has fetched posts and the analyzer has classified and summarised them. See the [analysis README](../analysis/README.md).

### Operator

Opens **http://grafana.localhost:8090**. Browsers resolve `*.localhost` to the local machine, so no `/etc/hosts` edit is needed. It's the same port as the analysts; Traefik routes on the hostname ([`grafana.yaml` L119-L137](../../../skypulse/k8s/base/monitoring/grafana.yaml#L119-L137)).

They land straight on the **SkyPulse dashboard** (set as the home dashboard, [`grafana.yaml` L48-L50](../../../skypulse/k8s/base/monitoring/grafana.yaml#L48-L50)). It answers:

- **Are analysts being served?** Request rate, 5xx ratio and p95 latency, measured at Traefik.
- **Is the pipeline moving?** Posts ingested and analysed per 5 minutes, the LLM backlog, and the age of the oldest pending post.
- **Is each subscription fresh?** Summary age, time since the last poll, and failing subscriptions.
- **Is the database healthy?** Instances up, replication lag, connections.

Access is **read-only and anonymous** (Viewer role, no login form). The dashboard comes from a file in Git, so nobody can change it from the UI, and a restart brings back exactly the same view. See the [monitoring README](../monitoring/README.md).

Operators also use the command line on [your machine](../your-machine/README.md): `make status`, `make logs`, `make verify`.

## A request's full path

```
browser ─▶ localhost:8090 ─▶ k3d load balancer ─▶ ServiceLB ─▶ Traefik Pod (kube-system)
        ─▶ Ingress rule by Host ─▶ api Pod :8000 / Grafana Pod :3000
```

The [system README](../system/README.md) explains each hop.

## Design decisions behind it

[`skypulse/DESIGN.md`](../../../skypulse/DESIGN.md): D-1 (precomputed summaries keep the page fast), D-7 (HA on the analysts' path), D-11 (what the dashboard measures). Open items: authentication (§5 #1), Grafana SSO (§5 #8).
