# Worker — Design

**Date:** 2026-06-26
**Status:** Draft — full vision spec (implementation sliced into User Stories)

> Big-picture spec for the **Worker** — Skynet's core unit and the single
> strongest capability of this extension. It describes the whole system, not just
> the first slice. Work is sliced into **User Stories (US)** at the end; **every US
> ships something REAL** (a usable Worker capability). Types/utils/adapters are the
> supporting cast that comes along with the REAL thing — never a US on their own.
> Scope is intentionally *not* trimmed; the MVP is just US-1.

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
│   └── Model                     the LLM the agent runs
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

export interface SubProtocol {
  authMethod: AuthMethod;
  endpointUrl?: string;          // http only; cli resolves its own endpoint
}

export interface Agent {
  company: Company;
  protocol: Protocol;
  subProtocol: SubProtocol;
  model?: string;                // omit → CLI/API uses its configured default
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
}

export interface Worker {
  id: string;
  agent: Agent;
  harness: Harness;
  soul: Soul;
}
```

Later-phase sub-types (`ToolSpec`, `ObservabilitySpec`, `VerificationSpec`) are
declared now, fleshed out in their US, so `Harness` stays stable.

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

**US-1 configures** Guardrails (sandbox) + Repo (workingDir) on the CLI protocol,
riding the CLI's built-in loop/tools/memory. Observability and Verification light
up in later US.

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
reviewer, qa, etc. added in US-2). New role = new soul file.

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
  | { type: "done"; lastMessage?: string }
  | { type: "error"; message: string };
```

**Credential store** — resolves a `credentialRef` into live `Credentials`. US-1:
"use the CLI's existing login" (Codex `~/.codex/auth.json`) — a passthrough. Later:
per-account dirs (`CODEX_HOME` / `CLAUDE_CONFIG_DIR`) and OAuth/PKCE/device flows.

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
                                          child_process.spawn (CLI)   ← US-1
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
  mechanism (`-c` instructions vs temp `AGENTS.md`) confirmed in US-1
- Multi-account via `CODEX_HOME`; auth reuses existing `codex login` for US-1 ✅

US-1 invocation shape:
```
codex exec --json -s <sandbox> -C <workingDir> [-m <model>] <soul-injection> "<task>"
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

`src/webview/views/worker.tsx` — reuses existing shadcn primitives.

- **Soul picker:** role `<Select>` (developer first). Shows the role's
  responsibilities/methodology.
- **Agent picker:** Company `<Select>` → Protocol toggle (Cloud/Local) → (later:
  sub-protocol + auth + credentials). US-1: openai/cli, auth = "existing login."
- **Model:** free-text/list; empty = default (no `-m`).
- **Harness config:** sandbox `<Select>`; workingDir input. (More facets per US.)
- **Task:** `<Textarea>` + **Run** / **Cancel**.
- **Output pane:** appends streamed `WorkerEvent`s.

The `.temp/worker.png` provider sidebar (already prototyped as the Tree component)
becomes the agent picker's home in a later US.

---

## 11. Verification discipline (non-negotiable)

The research notes (`docs/research/how-to-use-agent.md`) are a **starting point,
not truth** — already proven wrong on `--stream`. For every adapter, before its US:

1. Confirm the CLI exists and its flags via `--help` (or the API shape via a real
   call); capture verified facts in that US's plan.
2. Confirm allowed AuthMethods and the actual env vars / endpoint URLs.
3. Confirm the soul-injection channel (instruction file vs system prompt vs config).
4. Never hardcode model ids without confirming they exist.

US-1's Codex facts are already verified (§8).

---

## 12. Implementation as User Stories (each ships something REAL)

Sliced by user-visible value, ordered by dependency. **No US exists just to create
types/utils** — those ride along inside the REAL slice. Each US becomes its own
implementation plan (chunked further at plan time).

**US-1 — MVP: "Run a developer Worker on a task via Codex."**
*Real deliverable:* a working **developer Worker**. Operator picks the developer
soul + Codex agent + sandbox/dir, types a task, hits Run, watches real streamed
output. Rides along: `types.ts`, the `AgentAdapter` interface + Codex adapter,
`WorkerEvent`, the runner, protocol messages, the credential passthrough, and the
`worker.tsx` UI — all in service of this one REAL worker.

**US-2 — "Choose what kind of worker (soul library)."**
*Real deliverable:* selectable roles (reviewer, qa, …) that visibly change how the
Worker behaves. Adds the `souls/` library + picker; reuses US-1's pipeline.

**US-3 — "Run the same Worker via Claude Code (second provider)."**
*Real deliverable:* the operator can swap the brain to `anthropic × cli` and run
the same soul/harness. Proves the adapter abstraction for real; adds OAuth-token
auth + per-account config dir.

**US-4 — "See what the Worker is doing, and trust it's done."**
*Real deliverable:* live progress (parse the full event stream → observability) and
a verification gate (lint/test must pass before the Worker reports "done"). The
"better harness" value made visible.

**US-5 — "Run a Cloud Worker (no CLI installed)."**
*Real deliverable:* a Worker over an HTTP agent (`anthropic × http` or
`openrouter × http`) — we build the agent loop, tool dispatch, and system-prompt
soul injection. Unlocks the Cloud protocol.

**US-6 — "Use any provider / account."**
*Real deliverable:* remaining companies/sub-protocols (`google`, `nvidia`, OpenAI
HTTP oauth proxy), multi-account credential management, OAuth/PKCE/device flows.

(Routing — task → best Worker — is a **separate** capability beyond this spec; it
consumes Workers produced here.)

---

## 13. Out of scope (this spec)

- Routing / auto-selecting a Worker for a task.
- Persisting worker configs across sessions (US-1 is in-memory; persistence can
  arrive with multi-account work).
- The Scrum-team orchestration layer (multiple Workers collaborating) — built on
  top of Workers later.
