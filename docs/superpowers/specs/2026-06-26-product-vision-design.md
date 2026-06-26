# Skynet — Product Vision

**Date:** 2026-06-26
**Status:** Draft — north-star vision (umbrella over per-subsystem specs)

> This is the **north-star** for the whole extension. It defines the end-state
> product and how its subsystems fit together. It is the umbrella; each subsystem
> has (or will have) its own spec — the **[Worker](2026-06-26-worker-design.md)**
> spec is the first child. This document is intentionally broad; detail lives in
> child specs. Build order is an epic list at the end.

---

## 1. North star — the end-state experience

A developer opens VSCode and, once onboarded, hands Skynet an **idea**. Skynet
runs a full software-delivery workflow as an orchestrated AI **Scrum team**,
pausing only to ask the few **decisions that genuinely need a human**. The output
is a **real, shippable product** — built with discipline, tested, reviewed — **not
a pile of slop carrying a ton of tech-debt**.

The golden path:

```
Onboard once ─▶ Add every agent you own ─▶ Give an idea
        ─▶ Answer the decisive questions (only those)
        ─▶ Watch the Scrum team execute (live state machine)
        ─▶ Receive a real product (spec'd, built, tested, reviewed)
```

Two promises define success:

1. **Effortless after onboarding** — the human supplies *intent and decisions*, not
   labor. Everything mechanical is the team's job.
2. **Quality is structural, not optional** — the workflow *cannot* reach "shipped"
   without passing review and verification. Anti-tech-debt is built into the
   machine, not left to discipline.

---

## 2. Product principles

- **Human supplies intent; the team supplies labor.** Pause only for decisions a
  machine shouldn't make (scope, trade-offs, product calls).
- **No slop, by construction.** Review + verification are mandatory gates on the
  path to ship. A run can't skip them. (Mirrors superpowers' own
  brainstorm→spec→plan→TDD→review discipline, plus ponytail minimalism: smallest
  correct change, YAGNI, no unrequested abstractions.)
- **Every run is durable.** A run survives VSCode restarts; a pause can wait hours
  or days and resume exactly where it stopped.
- **The work is observable.** The user always sees which node is active, what each
  Worker is doing, and what's blocking.
- **Reuse over rebuild.** Orchestrator phases delegate to existing superpowers
  skills where they exist; Skynet only builds what's missing (e.g. SHIP).
- **Secrets stay safe.** Credentials live in VSCode SecretStorage; CLI logins are
  referenced, never copied.

---

## 3. System map

Five subsystems. The **Worker** is the executor unit (own spec); the other four
make it a product.

```
┌──────────────────────────────────────────────────────────────────┐
│ Skynet (VSCode extension)                                          │
│                                                                    │
│  ① Agent Management        ② Worker            ③ Orchestrator      │
│  CRUD + auth flow          Agent+Harness+Soul  hybrid state machine│
│  SecretStorage             (the executor)      multi-worker team   │
│        │                        ▲                    │             │
│        │ provides agents        │ assembles &        │ drives      │
│        ▼                        │ runs Workers        ▼            │
│  credential store ──────────────┘            ④ Run State Machine   │
│                                               + Panel (live nodes) │
│                                                      │             │
│                                               ⑤ pause_to_ask ↔     │
│                                                  resume (durable)  │
└──────────────────────────────────────────────────────────────────┘
```

- **① Agent Management** — onboard and CRUD the agents the user owns; handle each
  AuthMethod's flow; store secrets safely.
- **② Worker** — `Agent + Harness + Soul`; the thing that actually does a unit of
  work. See the [Worker spec](2026-06-26-worker-design.md).
- **③ Orchestrator** — the "big workflow like superpowers"; a hybrid state machine
  that assigns phases to a multi-worker Scrum team.
- **④ Run State Machine + Panel** — the durable run, visualized live (active node).
- **⑤ pause_to_ask ↔ resume** — human-in-the-loop decision gates, durable.

---

## 4. ① Agent Management (CRUD + authentication)

The onboarding surface: the user adds **every agent they own** once, then forgets
about it.

### CRUD
- **Create** — pick Company → Protocol (Cloud/Local) → sub-protocol/AuthMethod →
  run the auth flow → name it → saved.
- **Read/List** — the provider sidebar (`.temp/worker.png`, already prototyped as
  the **Tree** component): CLOUD/LOCAL groups, provider rows, live status dots.
- **Update** — rotate credentials, rename, change default model.
- **Delete** — remove agent + purge its secret.

### Authentication flows (per AuthMethod)
- **apiKey** — paste key → validate with a cheap probe call → store in
  SecretStorage.
- **oauth2Pkce** — browser PKCE flow → capture token → store.
- **oauth2** — token paste or browser flow (e.g. `CLAUDE_CODE_OAUTH_TOKEN`).
- **deviceCode** — show code, poll until authorized.
- **CLI logins** — for Local agents already logged in (`codex login`,
  `claude`), **reference** the existing login (`CODEX_HOME` /
  `CLAUDE_CONFIG_DIR`); do not copy the secret out.

Allowed methods per (Company × Protocol) come from the matrix in the
[Worker spec §9](2026-06-26-worker-design.md). **Verify each flow against the real
tool before building it** (the research notes are hypotheses — already wrong once).

### Storage
- HTTP keys/tokens → `context.secrets` (VSCode SecretStorage, encrypted).
- CLI agents → a reference to the login dir, resolved at run time by the Worker's
  credential store. Worker config stores only a `credentialRef`, never a secret.

---

## 5. ② Worker (link)

The executor. Fully specified in **[2026-06-26-worker-design.md](2026-06-26-worker-design.md)**:
`Worker = Agent + Harness + Soul`. The Orchestrator assembles Workers (picking the
agent + soul per phase) and runs them via the same `runWorker` runner + normalized
`WorkerEvent` stream defined there. No duplication here.

---

## 6. ③ Orchestrator — the big workflow (hybrid state machine)

A **native state machine** whose phases **delegate to superpowers skills** where
they exist, and run **Skynet-native handlers** where they don't (e.g. SHIP). Phases
are assigned to a **multi-worker Scrum team** — each phase runs on a Worker wearing
the right **soul**.

### Macro states (the delivery workflow)

| State | Worker / soul | Handler | Emits decisions? |
|---|---|---|---|
| **IDEATE** | (human) | capture the idea | — |
| **GROOM** | PM | delegate `superpowers:brainstorming` | **yes** (scope/req) |
| **SPEC** | Architect | brainstorming → design doc | **yes** (approach) |
| **PLAN** | Architect/Lead | delegate `superpowers:writing-plans` | sometimes |
| **BUILD** | Developer(s) | delegate `superpowers:test-driven-development` / `executing-plans`; **fan out per US** | rarely |
| **REVIEW** | Reviewer | delegate `superpowers:requesting-code-review` | rarely |
| **VERIFY** | QA | delegate `superpowers:verification-before-completion` | rarely |
| **SHIP** | Lead | **Skynet-native** (branch/PR/merge; partial `superpowers:finishing-a-development-branch`) | yes (merge/PR) |

### Quality gates (the anti-tech-debt machine)

- **REVIEW** and **VERIFY** are **mandatory** — there is no edge from BUILD to SHIP
  that bypasses them. Failures loop back to BUILD with the findings.
- BUILD uses **TDD** (tests first) and **ponytail** minimalism (smallest correct
  change, YAGNI). The structure makes "a ton of tech-debt" hard to produce, not
  merely discouraged.
- A run reaches **SHIP only when** the plan is complete, tests pass, and review is
  clean — enforced by the state machine, not by hope.

### Multi-worker Scrum team

- The Orchestrator owns a **team**: a Worker per role (PM, Architect, Developer,
  Reviewer, QA), each a soul over a chosen agent.
- **Parallelism:** independent User Stories in BUILD fan out to multiple Developer
  Workers (mirrors `superpowers:dispatching-parallel-agents`), then converge at
  REVIEW.
### Agent assignment — by tier, not by hand-picking one agent

The user does **not** wire each role to one fixed agent. Instead (per the
[Worker spec §7.1](2026-06-26-worker-design.md) tier model, borrowed from LiteLLM
`order` routing + OpenRouter failover):

- **task_type → tier.** Each phase/soul declares a `requiredTier` (`fast |
  balanced | deep`). E.g. SPEC/REVIEW → `deep`; mechanical BUILD edits → `fast`.
- **Round-robin among peers.** The `AgentPool` returns same-tier agents in
  round-robin order — spreads load and rate limits across the user's equivalent
  agents (e.g. two `deep` agents alternate).
- **Fallback down a tier.** On a transport failure (429/auth/connection), the pool
  advances to remaining peers, then the next-lower tier, each with its own retries.

During onboarding the user just **tags each agent with a tier** (or accepts a
sensible default per model); the Orchestrator resolves the concrete agent per task.
*Semantic* auto-routing (understanding a task to pick the single best agent) stays
**out of scope** (§12).

---

## 7. ④ Run State Machine + Panel

### Run state (durable)
A run is a persisted object — survives VSCode restart:

```ts
interface Run {
  id: string;
  idea: string;
  currentNode: StateId;             // active macro state
  status: "running" | "paused" | "done" | "failed";
  pendingQuestion?: PendingAsk[];   // a phase's whole batch, asked together (§8)
  history: StateTransition[];       // node, worker, started/ended, outcome
  artifacts: {                      // links to produced work
    specPath?: string; planPath?: string; branch?: string; prUrl?: string;
  };
  team: Record<Role, { agentRef: string; soul: string }>;
}
```
Persisted to disk (workspace storage). On reload, the panel rehydrates and, if
`status === "paused"`, re-surfaces `pendingQuestion`.

### Panel (live visualization)
A webview rendering the state machine as a graph/flow:
- Nodes = macro states; **active node highlighted**, done nodes checked, failed
  nodes flagged.
- Each active node shows its Worker (role + agent) and streamed `WorkerEvent`s
  (the same event stream the Worker spec defines).
- Parallel BUILD shows sub-lanes (one per Developer Worker / US).
- A paused node shows the pending question inline with a **Resume** affordance.

Built from existing shadcn primitives + the Tree component; the run graph may use a
simple flow layout (nodes + edges) — exact rendering decided in the panel's child
spec.

---

## 8. ⑤ pause_to_ask ↔ resume (durable human-in-the-loop)

The mechanism that lets the system run autonomously yet defer the *decisive*
questions to the human — **asked in batches, not as a chatty drip.**

### Batching principle (researched: Kiro, GitHub Spec Kit `/clarify`)

The worst failure mode is ask-run-ask-run — interrupting the human repeatedly.
Similar spec-driven tools avoid it the same way, and so do we:

1. **Scan context first.** A phase reads the workspace/spec before asking, so
   questions are specific (stack, existing patterns), not generic.
2. **Enumerate the decision space, then ask once.** A phase gathers *all* decisions
   it needs and surfaces them as **one batched gate**, covering four dimensions:
   **scope/constraints**, **ambiguity**, **implementation forks**, **directional
   calls**. (This is the Worker `decision-request` event,
   [Worker spec §7.2](2026-06-26-worker-design.md).)
3. **Proceed in one pass.** Answers are recorded; the phase re-runs with them
   injected and continues without further interruption — re-invoked, not paused
   mid-process (keeps CLI adapters simple).
4. **Only human-owned decisions.** Mechanical ambiguity is resolved by the Worker
   itself (ponytail defaults), never escalated.

### Flow
```
Phase scans context → enumerates ALL its decisions
   └─▶ emits one batched ask: PendingAsk[] (each: question, options?, context)
        └─▶ Orchestrator: run.status = "paused", persist pendingQuestions
             └─▶ Panel surfaces the batch as a decision form (and notifies)
                  └─▶ (may wait hours/days; survives restart)
                       └─▶ User answers all at once
                            └─▶ Orchestrator injects answers, re-runs the phase
                                with them and continues in one pass
```

### Properties
- **Batched** — questions come as a set per phase, not one at a time.
- **Durable** — the pending batch is part of persisted `Run`; closing VSCode and
  reopening re-surfaces it.
- **Typed** — each `PendingAsk` carries a question, optional multiple-choice
  options, and context, so the panel renders a real decision form (not free chat).
- **Scoped to decisions** — only human-owned calls (scope, trade-offs, approach,
  merge). Mechanical ambiguity → resolved by the Worker (ponytail defaults).
- **Auditable** — every ask + answer recorded in `history`.

```ts
interface PendingAsk {                                 // one decision in a batch
  fromNode: StateId;
  question: string;
  options?: { label: string; detail?: string }[];      // multiple-choice when applicable
  context?: string;
}
// run.pendingQuestion holds PendingAsk[] — a whole phase's batch, asked together.
```

---

## 9. End-to-end golden path (worked example)

```
1. ONBOARD  user adds: Codex (openai/cli), Claude Code (anthropic/cli),
            an OpenRouter key. Maps roles → agents.
2. IDEATE   "Build a CLI that converts CSV to a SQLite DB."
3. GROOM    PM-worker runs brainstorming → pause_to_ask:
              "Overwrite existing tables or append?" → user: "append"
4. SPEC     Architect-worker writes the design doc → pause_to_ask:
              "Streaming parse (big files) or load-all (simpler)?" → "streaming"
5. PLAN     Architect-worker writes the implementation plan (US-sliced)
6. BUILD    2 Developer-workers fan out across independent US (TDD)
7. REVIEW   Reviewer-worker runs code review → finds 1 issue → loops to BUILD
            → fixed → review clean
8. VERIFY   QA-worker runs the build + tests → all green
9. SHIP     Lead-worker opens a PR (Skynet-native) → pause_to_ask:
              "Merge to main or leave PR for you?" → user decides
→ Output: a real, tested CLI tool on a clean branch. No tech-debt pile.
```

---

## 10. Persistence & data model (summary)

- **Agents** — config (company/protocol/auth/model/credentialRef) in extension
  storage; secrets in SecretStorage.
- **Runs** — durable `Run` objects in workspace storage (per project).
- **Artifacts** — specs/plans live in the repo (`docs/superpowers/...`); branches/PRs
  in git; the `Run` holds links.
- **Souls** — the role library (`src/worker/souls/`), shipped with the extension.

---

## 11. Epic decomposition & build order

The vision decomposes into epics; each gets its own spec → plan → implementation.
Ordered by dependency. **Every epic ships something REAL** (per the Worker spec's
US discipline — no types-only epics).

| Epic | Real deliverable | Depends on |
|---|---|---|
| **E1 — Worker** | a single runnable Worker (developer soul, Codex) executes a task end-to-end | — (in progress; own spec) |
| **E2 — Agent Management** | onboard/add/list agents with real auth flows + SecretStorage; the provider sidebar | E1 (Worker consumes agents) |
| **E3 — Soul library & roles** | pick PM/Architect/Developer/Reviewer/QA souls | E1 |
| **E4 — Orchestrator (linear)** | idea → a single-path run GROOM→…→SHIP on one Developer Worker (no fan-out yet), with mandatory REVIEW/VERIFY gates | E1–E3 |
| **E5 — Run State Machine + Panel** | live node visualization of a run; durable run-state across restart | E4 |
| **E6 — pause_to_ask ↔ resume** | durable decision gates; user answers, run resumes | E4–E5 |
| **E7 — Multi-worker Scrum team** | tier-tagged agents + `AgentPool` (round-robin/fallback) + parallel BUILD fan-out/converge | E3–E6 |
| **E8 — Breadth** | HTTP agents, more companies, multi-account, richer harness (observability/verification depth) | E1–E7 |

(E1's internal US slicing is in the Worker spec. E4–E7 are where this vision's
unique value — the autonomous, observable, durable Scrum team — comes online.)

---

## 12. Out of scope (this vision)

- **Semantic auto-routing** (understanding a task to pick the single best
  agent/Worker). Agents are chosen by **tier** with round-robin + fallback (§6,
  Worker §7.1), not by semantic task understanding — that stays a separate future
  capability that *consumes* this system.
- **Cloud/remote execution** of the team (everything runs on the user's machine via
  their agents).
- **Team collaboration across users** (single-developer experience first).
- **Billing/cost optimization** across providers.

---

## 13. Risks & open questions

- **Autonomy vs. trust** — how much the team does before pausing. Mitigation:
  conservative `pause_to_ask` defaults early; loosen as trust builds.
- **Superpowers coupling** — delegating to superpowers skills ties us to their
  interface. Mitigation: the hybrid design isolates delegation behind phase
  handlers, so a skill can be swapped for a native handler.
- **Long-running durability** — resuming a half-done BUILD correctly after restart
  is the hardest part; E5/E6 must treat resume as a first-class case, not a bolt-on.
- **Verification discipline** — the whole value rests on REVIEW/VERIFY being real
  gates. They must run actual tests/reviews with evidence, never rubber-stamp.
