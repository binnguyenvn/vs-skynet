# Skynet — Product Vision (redesign)

**Date:** 2026-06-29
**Status:** North-star umbrella — supersedes `.temp/2026-06-26-product-vision-design.md`

> This is the single source of truth for the whole extension. It defines the
> end-state product, the subsystems, the build order, and the two principles that
> drive every layer. It is intentionally broad — each subsystem gets its own
> child spec (`docs/superpowers/specs/`) when we reach it. The first child spec is
> **Adapters**.

---

## 1. North star

A developer opens VSCode, hands Skynet an **idea**, and Skynet runs a disciplined
software-delivery workflow as an orchestrated AI team — pausing only for the few
decisions a human must make — and returns a **real, tested, reviewed product**,
not a pile of tech-debt.

`Worker = Agent + Harness + Soul` remains the executor model. The redesign keeps
that core; it changes the **build order**, makes **provable operation** a
first-class requirement of every layer, and promotes **Tools/Plugins** to its own
subsystem.

## 2. Why this redesign (the driver)

The previous plan built **Codex-only, deep first**. Two failures surfaced:

1. **Single-provider block.** When the one Codex agent hit a rate limit, the whole
   dev/test loop stalled with nothing to fall back to.
2. **No visible proof.** The harness test couldn't show whether the implementation
   actually worked — it just silently stopped.

The redesign answers both with two cross-cutting principles, and re-sequences the
work so nothing is blocked behind a single provider and every layer demonstrates
itself before the next is built.

## 3. Cross-cutting principles

These apply to **every** subsystem, not just one.

### P1 — Never blocked by one provider
Multiple CLI adapters (codex, claude, agy) are built **first** so no single
provider's limit can block downstream work. In Phase 1 the user/task selects the
adapter and switches **manually** on a limit; **automated** fallback is a later
(Orchestrator) concern — see Decision A (§7).

### P2 — Every layer proves itself
Each pre-MVP layer is accepted **only** by a real end-to-end run, against real
CLIs, rendered live as a **step-function state machine**: each step shows
Success / Failed / Cancelled / In-Progress. A hung or rate-limited step renders
In-Progress → Failed — never a silent stall. This panel is a **permanent product
feature**; it doubles as each layer's acceptance proof. (Model: AWS Step Functions
console — see `.temp/step-function-*.png`.)

## 4. System map — six subsystems

```
┌────────────────────────────────────────────────────────────────────┐
│ Skynet (VSCode extension)                                           │
│                                                                     │
│  ① Adapters ──▶ ② Harness ──▶ ③ Soul ──▶ ④ Tools/Plugins           │
│   codex          control       roles       catalog + install        │
│   claude         + step-fn      identity    + per-task gating        │
│   agy            panel (P2)                                          │
│        └──────────────┴───────────┴────────────┘                    │
│                          │ all wrapped by                           │
│                          ▼                                          │
│                  ⑤ Orchestrator  ── the biggest harness = MVP        │
│                          │                                          │
│                  ⑥ Management (post-MVP): CRUD agents/tools/         │
│                     plugins/identities, persistence, multi-account  │
└────────────────────────────────────────────────────────────────────┘
```

## 5. Build order

**Terminology (matches the roadmap):** the build splits into two **Phases** —
*Phase 1 — MVP* and *Phase 2 — Post-MVP*. In Phase 1 each **subsystem = one
Epic** (Adapters, Harness, Soul, Tools/Plugins, Orchestrator). Phase 2's
"Management" is not one Epic — it **decomposes into several small Epics** (Agent
Management, Tool Management, Plugin Management, Identity Management, Multi-Account,
AgentPool & Fallback, Persistence). Each Epic's capabilities are its **Features**.

Each subsystem ships something real **and** passes its step-function proof (§6)
before the next begins.

| # | Subsystem | What it is | Proof-of-function scenario |
|---|-----------|-----------|----------------------------|
| 1 | **Adapters** | codex + claude + agy CLI bridges behind one `AgentAdapter` interface; normalized `WorkerEvent` stream; **error classification** (limit/transport vs terminal). Pure bridges — no resilience logic (Decision A). | Run one task through *each* CLI; kill one mid-run / hit a limit → the step shows Failed with a clear reason, not a stall. |
| 2 | **Harness** | the control layer (observability, verification gate, guardrails, step/token caps) **plus the step-function panel itself**. | A task runs; the panel renders every step to green; the verification gate correctly turns a *fake* "done" red. |
| 3 | **Soul** | role + methodology library (developer, reviewer, qa…), rendered into the agent's instruction channel. | Same task, two souls → visibly different step sequences; both green. |
| 4 | **Tools / Plugins** | a catalog of third-party packs (e.g. `extensions-factory/superpowers`); end-user **Install** runs them into the CLIs; the **harness gates usage per task** (installed ≠ always on — least privilege). | Install superpowers; task A (no tools) is **denied** it, task B (needs it) **uses** it — both visible in the panel. |
| 5 | **Orchestrator** | the biggest harness; wraps 1–4 into one complete extension. An idea → a multi-step delivery run through the panel. | An idea runs end-to-end through the panel = **MVP**. |
| 6+ | **Management** (Phase 2, several Epics) | Agent / Tool / Plugin / Identity Management (CRUD); Multi-Account; AgentPool & Fallback (the automated form of P1, deferred here by Decision A); Persistence (durable runs across restarts). | — |

## 6. The proof model (acceptance gate)

Every pre-MVP subsystem defines one small **fixed scenario** expressed as a
step-function. "Done" means: the scenario runs against **real CLIs** and every
step reaches a terminal state matching expectation — green for success, or a
*deliberately* red step where the design calls for it (e.g. the verification gate
rejecting a fake "done"). Because each step has explicit Success/Failed/
Cancelled/In-Progress status, a hung or rate-limited run is **visibly** Failed, so
"it silently stopped, did it even work?" can no longer happen. The same panel that
proves the layer is the panel that ships.

## 7. Key decisions

### Decision A — adapters are dumb bridges; resilience is deferred
Adapters (subsystem 1) carry **no** fallback/retry logic. In Phase 1 a provider
limit is worked around **manually** (rerun on another adapter). Automated fallback
(retry-next-adapter, and later tier/round-robin AgentPool) lands with the
Orchestrator / Management.
- **Bought:** clean single-responsibility adapters; resilience lives in one place.
- **Cost (on record):** the limit-block pain is only *manually* mitigated until
  the Orchestrator. Accepted.
- Adapters must still **classify** errors (limit/transport vs terminal) so the
  later fallback layer has the signal it needs — this is a Phase-1 requirement.
- `// ponytail: static configured adapter list in P1; CRUD of that list is subsystem 6.`

## 8. What this supersedes / relationship to prior docs

- **Supersedes** `.temp/2026-06-26-product-vision-design.md` (old 5-subsystem map,
  Codex-only-first order) and the `.temp/2026-06-26-worker-intro.html` roadmap
  (Codex-only Epics 1–6).
- **Reframes** `.temp/agent-harness-common-functions.md`: its "Epic 2 shipped"
  baseline was aspirational (the repo has no worker code yet). Its capability
  taxonomy stays a useful backlog map for subsystems 2 and 5–6.
- **Keeps** the existing webview skeleton + Tree primitives as the UI foundation
  (the Tree is the future provider sidebar for subsystem 6).

## 9. Out of scope (this vision)

- **Semantic auto-routing** (understanding a task to pick the single best agent).
- **Cloud/remote execution** — everything runs on the user's machine via their CLIs.
- **HTTP/cloud agents** — CLI adapters only until after MVP (subsystem 6+ breadth).
- **Cross-user team collaboration**; **billing/cost optimization** across providers.

## 10. Open questions

- **Adapter set for Phase 1** — codex is verified (`codex 0.142.2`); claude and agy
  flags/auth/event-shapes are unverified. Each adapter's spec must start with a
  real `--help`/run check before its plan (verification discipline).
- **Step-function granularity** — what counts as one "step" (a tool call? a harness
  phase?). Settled in the Harness child spec.
- **Plugin install mechanics** — how a pack like superpowers is installed into each
  CLI differs per CLI; settled in the Tools/Plugins child spec.

---

*Detailed designs live in per-subsystem child specs. Next: the **Adapters** spec.*
