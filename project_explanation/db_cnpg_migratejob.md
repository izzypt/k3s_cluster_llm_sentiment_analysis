# The database: CloudNativePG and the migrate Job

Back to: [1 Overview](01-overview.md) · [4 Platform](04-platform.md) · [5 Delivery & operations](05-delivery-and-operations.md)

CloudNativePG (CNPG) and the migrate Job split the database work between them:

- **CNPG runs the PostgreSQL server.** It creates the database and the users, keeps Postgres running and handles failover.
- **The migrate Job sets up what's inside the database:** the tables, and what each user is allowed to do with them.

## CloudNativePG: the database server

CNPG is a Kubernetes **operator**: a controller that runs in the cluster (namespace `cnpg-system`, installed by `make operator`). It watches for a custom object of kind `Cluster`. You describe the database you want in about 30 lines ([`skypulse/k8s/base/data/postgres.yaml`](../skypulse/k8s/base/data/postgres.yaml)), and CNPG creates and runs it:

| You write | CNPG creates and runs |
|---|---|
| `instances: 2` | 2 Postgres Pods (1 primary + 1 replica) on different nodes, one volume (PVC) each |
| *(automatic)* | Services: **`feeddb-rw`** (always points at the current primary), `feeddb-ro` (replicas), `feeddb-r` (any instance) |
| `bootstrap.initdb: owner: skypulse` | The `skypulse` database, its owner user, and a Secret **`feeddb-app`** holding the owner's credentials |
| `managed.roles: ingestor, analysis` | Two login users, using the passwords that `make secrets` creates. **They have no permissions yet.** |
| *(automatic)* | Failover: if the primary dies, the replica is promoted and `feeddb-rw` follows it |
| `monitoring:` | A metrics exporter on port 9187 that Prometheus scrapes |

What CNPG doesn't know about is your application: it has no idea there's a `posts` table or what the ingestor is allowed to do.

## The migrate Job: tables and permissions

The Job ([`skypulse/k8s/base/data/migrate.yaml`](../skypulse/k8s/base/data/migrate.yaml)) runs the shared image with `args: ["migrate"]`, which calls `migrate()` in [`skypulse/src/skypulse/db.py`](../skypulse/src/skypulse/db.py). It:

1. **Waits for the database** (`wait_for_db()`, retrying for up to 5 minutes), because right after a deploy Postgres may still be starting.
2. **Takes an advisory lock**, so two migrations can never run at the same time.
3. **Applies pending migrations.** It keeps a `schema_migrations` table recording which versions have run, and creates `subscriptions`, `posts` and `summaries` (migration 1) only if they don't exist yet. Running it again changes nothing (it's idempotent).
4. **Grants each user exactly the permissions it needs:**
   - `ingestor` can read targets, update poll status and insert posts. Nothing else, because it's the component that faces the internet.
   - `analysis` can manage subscriptions, write sentiment results and summaries. It can't change the schema.
   - `pg_monitor` (used by the metrics exporter) can read only timestamps and counters, never post texts.

## How they connect

```
            ┌──────── CNPG operator creates ────────┐
            │                                        │
   users "ingestor", "analysis"            Secret feeddb-app (owner credentials,
   (can log in, no permissions)            uri → feeddb-rw = current primary)
            │                                        │
            │                                        ▼
            │                          migrate Job (namespace skypulse-data)
            │                          DATABASE_URL = feeddb-app.uri
            │                                        │
            └──────── GRANTs ◀───── creates tables + grants permissions
                         │
                         ▼
   ingestor / api / analyzer log in with their own user → can now do their job
```

1. **CNPG has to run first.** The migrate Job needs the database to exist, the `feeddb-app` Secret to read, and the users to exist before it can grant them anything.
2. **The Job relies on three things CNPG made:** it connects with CNPG's owner credentials, through CNPG's `feeddb-rw` Service, and grants permissions to the users CNPG created.
3. **That's why the Job runs in `skypulse-data` and not in an app namespace.** The owner credentials can change the schema, so they never leave the database's namespace. The app Pods only ever get their own limited users.
4. **Ordering, locally and in production:**
   - Locally, `make deploy` deletes the previous Job, applies everything, waits for `cluster/feeddb` to be `Ready`, then waits for `job/migrate` to finish. The API's readiness probe also waits until the schema exists.
   - In production, the Job is an Argo CD **Sync hook**, so it runs on every sync. `backoffLimit: 10` covers a database that is still starting.

A simple analogy: CNPG builds and runs the building and hands out ID badges (the users). The migrate Job sets up the rooms (the tables) and decides which badge opens which door (the grants).
