# The problem: on-premises feed analysis

This is the brief that SkyPulse solves. The [design document](skypulse/DESIGN.md) maps every requirement below to the decisions that meet it, and [`final_summary.md`](final_summary.md) walks through the solution.

## Who it's for

Analysts who follow a curated set of public social media sources and want a quick read on the mood around each one.

## Functional requirements

Analysts must be able to:

| # | Requirement |
|---|---|
| F1 | Subscribe to and unsubscribe from **Bluesky handles and hashtags** |
| F2 | See a **summary of the recent sentiment** for each subscription |
| F3 | See **how many items** the summary covers |
| F4 | See **when the summary was last updated** |
| F5 | Sentiment comes from a **small, local LLM** (something in the class of Gemma 4 A2B), not a hosted API |

## Non-functional requirements

### Security

| # | Requirement |
|---|---|
| S1 | Feed ingestion **may** connect to the internet, since it has to read the feed |
| S2 | The analysis application may **only** reach the analysts' local network |

This boundary has to be **enforced by the infrastructure**, not just respected by the code.

### Deployment

The system must be deployable **on-premises**, with particular attention to application packaging, deployment and network setup. It must be:

| # | Requirement |
|---|---|
| D1 | **Highly available** to analysts |
| D2 | Able to receive **continuous software updates** |

## Technical constraints

| # | Constraint |
|---|---|
| T1 | Kubernetes for the platform; Python 3.12+ managed with **uv** for the application |
| T2 | A `Makefile` where `make build` installs dependencies and builds, and `make start` starts the whole system |
| T3 | A `README.md` with instructions to build and run it |
| T4 | A design document explaining the key decisions for the stack and the software, with any open items recorded |
