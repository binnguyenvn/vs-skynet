# Worker — Design

**Date:** 2026-06-26
**Status:** Draft — full vision spec (implementation sliced into Epics)

> Big-picture spec for the **Worker** — Skynet's core unit and the single
> strongest capability of this extension. It describes the whole system, not just
> the first slice. Work is sliced into **Epics** at the end; **every epic ships
> something REAL** (a usable Worker capability). Types/utils/adapters are the
> supporting cast that comes along with the REAL thing — never an epic on their own.
> Scope is intentionally *not* trimmed; the MVP is just Epic 1.

---

## 1. Goal & value proposition

A **Worker** is a complete, ready-to-work AI unit: an **agent** given a **harness**
and a **soul**. The extension's strongest capability is turning a raw model into a
dependable *công nhân* — one that knows its job, runs reliably, and produces real
output.

> Harness engineering: **a decent model with a great harness beats a great model
> with a bad one** — swapping only the harness moved a coding agent from rank #30
> to #5 on a public benchmark. The wrapper matters more than the model.

This spec covers **how a Worker is modeled, assembled, and run**. It does **not**
cover routing (which Worker for which task) — a later capability that *consumes*
Workers. Here the operator assembles and runs the Worker.

---

## 2. Core concepts & terminology

A Worker has **three** parts — the brain, the body, and the identity:

- **Agent** *(the brain + how to reach it)* — an LLM **Model** from a **Company**,
  reachable over a **Protocol** (+ sub-protocol), via an **AuthMethod** with
  **Credentials**.
- **Harness** *(the body — runtime control system)* — everything-but-the-model that
  makes it run **reliably**: the agent loop (call model → dispatch tools → feed
  results back → terminate), tool dispatch, guardrails, observability,
  memory/context management, verification, and sandbox/repo mechanics.
- **Soul** *(the identity — who it is)* — the role, responsibilities, and working
  method that make it a real worker: "You are a **developer**; a developer must
  ⟨investigate → plan → implement → verify⟩." Industry calls this layer the
  *scaffold* / system-prompt layer; we call it the Soul because it's what turns a
  configured API call into a *worker*.

> **Worker = Agent + Harness + Soul.**

### Sub-terminology

- **Company** — `openai | anthropic | google | openrouter | nvidia`.
- **Protocol** — `cli` (label **Local**, the company's official CLI — *not* a local
  model server) | `http` (label **Cloud**, the company's HTTP API).
- **Sub-protocol** — same Company + Protocol, different (AuthMethod → endpoint URL)
  pairing (e.g. OpenAI HTTP via API key on `api.openai.com` vs access token on a
  different backend).
- **AuthMethod** — `apiKey | oauth2Pkce | oauth2 | deviceCode`. Allowed set is
  constrained by the (Company × Protocol) pair.
- **Credentials** — the concrete secret satisfying an AuthMethod (never serialized
  into Worker config; resolved at run time — see §6).
- **Model** — the specific LLM the agent runs.

### The tree

```
Worker
├── Agent                         the brain + how we reach it
│   ├── Company                   openai | anthropic | google | openrouter | nvidia
│   ├── Protocol                  cli (Local) | http (Cloud)
│   │   └── sub_protocol          (AuthMethod + endpoint URL)
│   │       ├── AuthMethod        apiKey | oauth2Pkce | oauth2 | deviceCode
│   │       ├── Endpoint URL
│   │       └── Credentials       resolved at runtime, never stored
│   ├── Model                     the LLM the agent runs
│   └── Tier                      capability class: fast | balanced | deep (§7.1)
│
├── Harness                       the body — runtime control system
│   ├── Agent loop                call model → dispatch tools → feed back → stop
│   ├── Tool dispatch             tools / MCP servers, validate + execute
│   ├── Guardrails                sandbox, approval, token/step caps
│   ├── Observability             event stream, logging
│   ├── Memory / context mgmt     history, compaction, injection
│   ├── Verification              self-check, quality gates (lint/test before "done")
│   └── Repo / sandbox mechanics  working dir, writable dirs, git
│
└── Soul                          the identity — who it is
    ├── Role                      developer | reviewer | qa | ...
    ├── Responsibilities          what a worker of this role must do
    └── Methodology               how a pro in this role works (process)
```

---

## 3. Key architectural insight: who supplies harness & soul

The two protocols differ in how much we build. This drives the slice order.

- **CLI agents ship the harness built-in.** `codex`, `claude`, etc. already have
  the agent loop, tool dispatch, sandbox, and repo access. For a CLI Worker we
  **configure** the harness (sandbox, MCP tools, hooks) and **inject** the Soul via
  the CLI's instruction channel (Codex reads `AGENTS.md`; Claude reads `CLAUDE.md`)
  — we do **not** build the loop. Cheap; reuse over rebuild.
- **HTTP agents are a bare model.** The API returns tokens; *we* build the harness
  (the loop, tool dispatch, memory, verification) **and** inject the Soul via the
  system prompt. Expensive.

→ **CLI protocol first** (configure + inject), **HTTP protocol later** (build the
loop). Same domain model; the *adapter* behind it differs in weight.

---

## 4. Domain model

Extension host (Node), under `src/worker/`. The webview never spawns processes or
holds credentials.

```ts
// src/worker/types.ts
export type Company  = "openai" | "anthropic" | "google" | "openrouter" | "nvidia";
export type Protocol = "cli" | "http";
export type AuthMethod = "apiKey" | "oauth2Pkce" | "oauth2" | "deviceCode";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type ModelTier = "fast" | "balanced" | "deep";   // capability class (§7.1)

export interface SubProtocol {
  authMethod: AuthMethod;
  endpointUrl?: string;          // http only; cli resolves its own endpoint
}

export interface Agent {
  company: Company;
  protocol: Protocol;
  subProtocol: SubProtocol;
  model?: string;                // omit → CLI/API uses its configured default
  tier?: ModelTier;              // groups peer agents for round-robin/fallback (§7.1)
  credentialRef?: string;        // opaque handle into the credential store (§6)
}

export interface Harness {       // runtime control config; CLI = knobs, HTTP = built
  sandbox: SandboxMode;          // guardrails        → realized per adapter
  workingDir: string;            // repo mechanics
  tools?: ToolSpec[];            // tool dispatch / MCP
  observability?: ObservabilitySpec;
  verification?: VerificationSpec; // quality gates: lint/test before "done"
  // memory/context + loop are adapter-internal for CLI; explicit for HTTP later
}

export interface Soul {
  role: string;                  // "developer" | "reviewer" | "qa"
  identity: string;              // one-line persona
  responsibilities: string[];    // what this role must do
  methodology?: string;          // how a pro in this role works
  requiredTier?: ModelTier;      // role/task_type implies a minimum capability tier (§7.1)
}

export interface Worker {
  id: string;
  agent: Agent;
  harness: Harness;
  soul: Soul;
}
```

Later-phase sub-types (`ToolSpec`, `ObservabilitySpec`, `VerificationSpec`) are
declared now, fleshed out in their epic, so `Harness` stays stable.

---

## 5. Harness — the runtime control system

Harness is **not** a bag of CLI flags — it's the control system that makes the
agent reliable. Each facet, and how each protocol realizes it:

| Facet | CLI realization (configure) | HTTP realization (build) |
|---|---|---|
| **Agent loop** | the CLI's built-in loop | our run→observe→re-prompt loop |
| **Tool dispatch** | MCP servers (`codex mcp`), built-ins | tool/function defs + our dispatcher |
| **Guardrails** | `-s/--sandbox`, `--add-dir`, approval mode | our pre/post validation per tool call |
| **Observability** | `--json` JSONL event stream | we log every request/response/tool call |
| **Memory / context** | the CLI manages it | we store history + compact to fit window |
| **Verification** | project rules / execpolicy + our gate | we gate "done" on lint/test passing |
| **Repo / sandbox** | `-C/--cd`, `--add-dir`, `--skip-git-repo-check` | we stage files, apply diffs, manage git |

**Epic 1 configures** Guardrails (sandbox) + Repo (workingDir) on the CLI protocol,
riding the CLI's built-in loop/tools/memory. Observability and Verification light
up in Epic 2.

---

## 6. Soul — the identity layer

The Soul is what makes a Worker a *worker*. It is a **role definition** the system
ships as a small library and injects into the agent.

```ts
// Example soul (developer)
{
  role: "developer",
  identity: "A senior software developer who ships working, verified code.",
  responsibilities: [
    "Understand the task and the code it touches before editing.",
    "Make the smallest correct change.",
    "Verify: run build/tests; never claim done without evidence.",
  ],
  methodology: "investigate → plan → implement → verify → report",
}
```

**Realization per protocol:**
- **CLI** — rendered to the CLI's instruction file and fed at run time: Codex reads
  `AGENTS.md`, Claude reads `CLAUDE.md`. To avoid clobbering the user's real repo
  files, inject via an **ephemeral / config-scoped** instruction channel (e.g.
  Codex `-c` instruction override or a temp instructions file), not by overwriting
  the project's committed `AGENTS.md`. Exact mechanism verified per adapter at
  implementation.
- **HTTP** — rendered into the **system prompt** of every request.

Souls are **data**, not code — a `src/worker/souls/` library (developer first;
reviewer, qa, etc. added across Epic 3). New role = new soul file.

---

## 7. The Agent adapter abstraction

Each (Company × Protocol) is a pluggable **adapter** behind one interface; the
runner is adapter-agnostic. The adapter is also what knows how to *configure the
harness* and *inject the soul* for its agent.

```ts
// src/worker/adapters/types.ts
export interface AgentAdapter {
  readonly company: Company;
  readonly protocol: Protocol;

  allowedAuthMethods(): AuthMethod[];      // constrains UI + validation

  // Translate a full Worker (agent + harness + soul) into a runnable invocation.
  //  - CLI: argv + env (+ stdin + rendered instruction file) for child_process
  //  - HTTP: the request plan (system prompt from soul, tools from harness) for the loop
  buildInvocation(worker: Worker, task: string, creds: Credentials): Invocation;

  parseEvents(raw: AsyncIterable<Buffer>): AsyncIterable<WorkerEvent>; // normalize
}
```

```ts
export type WorkerEvent =
  | { type: "started" }
  | { type: "agent-message"; text: string }
  | { type: "tool-call"; name: string; detail?: string }
  | { type: "log"; level: "info" | "warn" | "error"; text: string }
  // worker needs human decisions — enumerated up front and surfaced as ONE batch
  // (the Orchestrator gates on it, asks, and re-runs with answers — §7.2)
  | { type: "decision-request"; questions: DecisionAsk[] }
  | { type: "done"; lastMessage?: string }
  | { type: "error"; message: string; transport?: boolean }; // transport=true → fallback-eligible (§7.1)

export interface DecisionAsk {
  question: string;
  options?: { label: string; detail?: string }[];   // multiple-choice when applicable
  context?: string;
}
```

**Credential store** — resolves a `credentialRef` into live `Credentials`. Epic 1:
"use the CLI's existing login" (Codex `~/.codex/auth.json`) — a passthrough. Later
(Epic 6): per-account dirs (`CODEX_HOME` / `CLAUDE_CONFIG_DIR`) and OAuth/PKCE/device flows.

### 7.1 Agent tiers, round-robin & fallback

A task does not pick a *specific* agent — it picks a **tier** (capability class),
and the system load-balances and fails over within/below it. (Pattern borrowed
from LiteLLM `order`-based routing + OpenRouter failover.)

- **task_type → tier.** A phase/soul declares a `requiredTier` (`fast | balanced |
  deep`). E.g. REVIEW/SPEC → `deep`; mechanical edits → `fast`.
- **Round-robin among peers.** Agents are tagged with a `tier`. At run time an
  **`AgentPool`** returns the same-tier agents in round-robin order — spreads load
  / rate limits across the user's equivalent agents.
- **Fallback down a tier.** On a **transport** failure (`error.transport === true`
  — 429, auth, connection, unavailable), the pool advances to the next candidate:
  remaining same-tier peers first, then the next-lower tier. Each candidate gets
  its own retries before escalating. A *task* failure (bad output) does **not**
  fall back — it loops in the orchestrator, not the pool.

```ts
// resolved by the AgentPool (lives with Agent Management / Orchestrator)
export interface AgentSelection {
  tier: ModelTier;
  policy: "round-robin" | "weighted";
  fallbackChain: Agent[];   // ordered candidates: same-tier peers, then lower tiers
}
```

The runner takes the first candidate as `worker.agent` and the rest as a fallback
chain; on a transport error it emits a `log`, advances, and only surfaces `error`
when the chain is exhausted. (Tier tagging + the pool land in a later epic — §12;
Epic 1 runs a single explicitly-chosen agent with an empty chain.)

> **Not** the same as *semantic* routing (understanding a task to pick the single
> best agent) — that stays out of scope (§13 / vision). This is mechanical
> tier-based load-balancing + failover.

### 7.2 Decision requests (batched, not chatty)

Workers surface human decisions as **one batch up front**, never as a drip of
mid-run questions (researched from Kiro / GitHub Spec Kit `/clarify`: scan context
→ enumerate the decision space → ask once → proceed in one pass). Mechanics:

- The soul instructs the agent to **enumerate every decision it needs** before
  doing the work, covering scope/constraints, ambiguity, implementation forks, and
  directional calls — then emit a single `decision-request`.
- The Orchestrator gates on it, asks the user (multiple-choice where possible),
  and **re-runs the phase with the answers injected**. No mid-process suspend (keeps
  CLI adapters simple; the worker is re-invoked, not paused in place).
- Mechanical ambiguity the worker can resolve itself (ponytail defaults) is **not**
  escalated — only genuine human-owned decisions.

---

## 8. Execution architecture

```
Webview (React, sandboxed)                Extension host (Node)
─────────────────────────                 ──────────────────────────────
Soul picker (role)                        panel.ts handler
Agent picker (company/protocol/model)        │
Harness config (sandbox, dir)                ▼
task input  ──runTask──────────────────▶  runWorker(worker, task, onEvent)
Run / Cancel                                 │  select AgentAdapter
                                             │  buildInvocation()  (renders soul,
                                             │                       configures harness)
                                             ▼
                                          child_process.spawn (CLI)   ← Epic 1
                                             │  stdout/stderr
                                             ▼
                                          adapter.parseEvents() → WorkerEvent
output pane  ◀──taskEvent (per event)──────┘
```

- **Runner** (`src/worker/runner.ts`): `runWorker(worker, task, onEvent)` picks the
  adapter, builds the invocation, spawns/streams, emits normalized `WorkerEvent`s,
  returns a cancel handle.
- **Protocol** (`src/webview/protocol.ts`) gains:
  ```ts
  WebviewToExtension += { type: "runTask"; worker: Worker; task: string }
                      | { type: "cancelTask"; workerId: string }
  ExtensionToWebview += { type: "taskEvent"; workerId: string; event: WorkerEvent }
  ```
- **panel.ts** routes `runTask` → `runWorker` → forwards each event; `cancelTask` →
  cancel handle.

### Ground-truth: Codex CLI (verified, v0.142.2)

First adapter targets `openai × cli`. Verified against the installed binary (the
research doc had errors — do not trust it):

- `codex exec [--json] -s <mode> -C <dir> [-m <model>] "<task>"` ✅
- `--json` streams events as JSONL ✅ (there is **no** `--stream` flag — doc wrong)
- `-o/--output-last-message <FILE>` writes the final message cleanly ✅
- `-s/--sandbox` ∈ `{read-only, workspace-write, danger-full-access}` ✅
- `-C/--cd <DIR>`, `--add-dir`, `--skip-git-repo-check`, `--ephemeral` ✅
- `-c key=value` config override (candidate soul-injection channel) ✅ — exact soul
  mechanism (`-c` instructions vs temp `AGENTS.md`) confirmed in Epic 3
- Multi-account via `CODEX_HOME`; auth reuses existing `codex login` for Epic 1 ✅

Epic 1 invocation shape (no soul injection — that arrives in Epic 3):
```
codex exec --json -s <sandbox> -C <workingDir> [-m <model>] "<task>"
```

---

## 9. Company × Protocol × AuthMethod matrix

The constraint table validation + UI build from. **Status** flags verification —
anything not `verified` MUST be confirmed against the real tool/API before its US
(see §11).

| Company | Protocol | Allowed AuthMethods | Sub-protocols | Status |
|---|---|---|---|---|
| openai | cli | `oauth2Pkce` (ChatGPT login), `apiKey` | login vs API key | **verified** (codex 0.142.2) |
| openai | http | `apiKey` → `api.openai.com`; `oauth2` → ChatGPT backend (proxy) | key vs token+proxy | research-only |
| anthropic | cli | `oauth2` (`CLAUDE_CODE_OAUTH_TOKEN`) | — | research-only |
| anthropic | http | `apiKey` (`ANTHROPIC_API_KEY`) → `api.anthropic.com` | — | research-only |
| google | cli | `oauth2` (browser), `apiKey` | — | research-only |
| google | http | `apiKey`; `oauth2` (gcloud ADC) | AI Studio vs Vertex | research-only |
| openrouter | http | `apiKey` (`OPENROUTER_API_KEY`) | — | research-only |
| nvidia | http | `apiKey` (`NVIDIA_API_KEY`); self-hosted endpoint | cloud vs self-host | research-only |

Hypotheses to verify: model ids (`gpt-5.x`, `gemini-3.5-flash`…) are **unverified** —
never hardcode; default to "omit model." OpenAI HTTP `oauth2` needs a proxy to an
undocumented backend — fragile, lowest priority. Antigravity (`agy`) replacing
Gemini CLI is unconfirmed — verify before building `google × cli`.

---

## 10. UI (webview)

`src/webview/integration-test/worker.tsx` — reuses existing shadcn primitives.

- **Soul picker:** role `<Select>` (developer first). Shows the role's
  responsibilities/methodology.
- **Agent picker:** Company `<Select>` → Protocol toggle (Cloud/Local) → (later:
  sub-protocol + auth + credentials). Epic 1: openai/cli, auth = "existing login."
- **Model:** free-text/list; empty = default (no `-m`).
- **Harness config:** sandbox `<Select>`; workingDir input. (More facets per US.)
- **Task:** `<Textarea>` + **Run** / **Cancel**.
- **Output pane:** appends streamed `WorkerEvent`s.

The `.temp/worker.png` provider sidebar (already prototyped as the Tree component)
becomes the agent picker's home in a later epic.

---

## 11. Verification discipline (non-negotiable)

The research notes (`docs/research/how-to-use-agent.md`) are a **starting point,
not truth** — already proven wrong on `--stream`. For every adapter, before its US:

1. Confirm the CLI exists and its flags via `--help` (or the API shape via a real
   call); capture verified facts in that US's plan.
2. Confirm allowed AuthMethods and the actual env vars / endpoint URLs.
3. Confirm the soul-injection channel (instruction file vs system prompt vs config).
4. Never hardcode model ids without confirming they exist.

Epic 1's Codex facts are already verified (§8).

---

## 12. Implementation as Epics (each ships something REAL)

Sliced by user-visible value, ordered by dependency. **No epic exists just to create
types/utils** — those ride along inside the REAL slice. The first three epics each
**prove one part** of `Worker = Agent + Harness + Soul` on a single CLI (Codex);
only then do we expand. Each epic becomes its own implementation plan (chunked into
TDD tasks at plan time).

### Prove it — three small epics, Codex only

**Epic 1 — Codex Adapter (proves the Agent).**
*Real deliverable:* run any task through Codex and watch clean, normalized streamed
output — and cancel it. The raw agent bridge, rock-solid. Spawn `codex exec --json`,
parse JSONL → normalized `WorkerEvent`s, stream, cancel, transport-error handling.
Task passed through as the prompt — **no soul system**, minimal harness (sandbox +
workingDir only). Rides along: `types.ts`, the `AgentAdapter` interface + Codex
adapter, `WorkerEvent`, the runner, protocol messages, the credential passthrough,
and a minimal `worker.tsx`. The layer everything else stands on.

**Epic 2 — Harness Core (proves the Harness).**
*Real deliverable:* the Worker shows exactly what it's doing and refuses to claim
"done" without passing checks — the "better harness" value made visible. Builds the
control-system facets on Epic 1's bridge: Observability (full event stream), a
Verification gate (lint/test before "done"), and Guardrails (sandbox modes,
step/token caps, approval). Designed against Codex's real event shapes behind a
CLI-agnostic contract.

**Epic 3 — Soul Core (proves the Soul).**
*Real deliverable:* pick a role and the Worker visibly behaves like it — a developer
plans-then-verifies, a reviewer critiques. The identity layer: the `souls/` library
as data (developer, reviewer, qa), render-to-instruction, the **verified
soul-injection channel** (`-c` override vs temp `AGENTS.md`), the role picker, and
batched decision-requests (§7.2).

> After Epics 1–3, Worker is proven: one CLI, but a complete, reliable, role-driven
> worker, demoable end to end. That's the bar before any breadth.

### Then — expand

**Epic 4 — More CLIs (Claude Code, then Antigravity).**
*Real deliverable:* swap the brain to `anthropic × cli` (then `antigravity`) and run
the same soul + harness — proves the adapter abstraction for real. Two more adapters
behind the same interface; core unchanged. Adds OAuth-token auth + per-account config
dir. Verify each CLI's flags/auth/soul-channel before its plan (§11); Antigravity
(`agy`) is §9-unconfirmed but installed on the dev machine.

**Epic 5 — HTTP protocol (build the loop).**
*Real deliverable:* a Cloud Worker with no CLI installed (`anthropic × http` or
`openrouter × http`). Here *we* own the runtime — agent loop, tool dispatch,
memory/context, system-prompt soul injection — reusing the verification gate +
normalized events from Epics 2–3. Unlocks the Cloud protocol.

### Then — other things

**Epic 6 — Worker Management.**
*Real deliverable:* create/edit/save/delete workers (cli + http) across sessions;
run multiple agents within the same Company; load-balance across them. Worker CRUD +
persistence, then multi-account (per-account config dirs, OAuth/PKCE/device flows),
then the `AgentPool` (§7.1) — tag agents with a tier, pick a task's tier, round-robin
across same-tier peers, fall back down a tier on transport failure. The user
assembles a Worker by *tier*, not a single fixed agent.

(*Semantic* routing — understanding a task to pick the single best Worker — is a
**separate** capability beyond this spec. The tier-based round-robin/fallback in
Epic 6 is mechanical, not semantic.)

---

## 13. Out of scope (this spec)

- **Semantic** routing — understanding a task to auto-select the single best
  Worker. (Tier-based round-robin/fallback *is* in scope — Epic 6, §7.1.)
- Persistence is *deferred, not cut*: Epics 1–5 keep workers in-memory; CRUD +
  cross-session persistence land in Epic 6.
- The Scrum-team orchestration layer (multiple Workers collaborating) — built on
  top of Workers later (vision E4–E7).
