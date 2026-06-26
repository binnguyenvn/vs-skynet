# Worker — Design

**Date:** 2026-06-26
**Status:** Draft — full vision spec (implementation phased separately)

> This is the **big-picture** spec for the `Worker` — Skynet's core unit and the
> single strongest capability of this extension. It describes the whole system,
> not just the first slice. Implementation is ordered by dependency at the end;
> each phase becomes its own implementation plan. Scope is intentionally *not*
> trimmed here — the MVP is just Phase 1.

---

## 1. Goal & value proposition

A **Worker** is a complete, ready-to-run AI unit produced by attaching a
**harness** to an **agent**. The extension's strongest value is: take a task,
pick the right agent, wrap it in the right harness, and hand back a Worker that
is the best possible executor for that task.

> Formula: **Agent = LLM model + Harness** (harness engineering); a Worker is the
> instantiated, runnable form of that pairing. Same model + better harness →
> measurably better results (the wrapper matters more than the model).

This spec covers **how a Worker is modeled, assembled, and executed**. It does
**not** cover routing (which agent to pick for which task) — that is a later,
separate capability that consumes Workers. Here, the operator picks the agent;
the system builds and runs the Worker.

---

## 2. Core concepts & terminology

- **Company** (AI Provider) — `openai | anthropic | google | openrouter | nvidia`.
- **Protocol** — how we talk to the company:
  - `cli` (UI label **Local**) — the company's official command-line agent.
    "Local" means the official CLI, **not** a local model server.
  - `http` (UI label **Cloud**) — the company's HTTP API.
- **Sub-protocol** — same Company + same Protocol, but a different
  (AuthMethod → endpoint URL) pairing. E.g. one OpenAI HTTP sub-protocol uses an
  **API key** against `api.openai.com`; another uses an **access token** against
  a different backend URL.
- **AuthMethod** — `apiKey | oauth2Pkce | oauth2 | deviceCode`. Which methods are
  allowed is constrained by the (Company × Protocol) pair (and pins the
  sub-protocol).
- **Credentials** — the concrete secret (key / token) satisfying an AuthMethod.
- **Model** — the specific LLM the agent runs (e.g. a Codex model id).
- **Agent** — an LLM **Model** provided by a **Company**, reachable over a
  **Protocol** (+ sub-protocol), authenticated by an **AuthMethod** with
  **Credentials**.
- **Harness** — everything wrapped around the agent to make it effective and
  safe: tools, guardrails, feedback loops, observability, hooks, linters,
  quality gates, repo management.
- **Worker** — **Agent + Harness**. The deliverable.

### The tree

```
Worker
├── Agent                         (who we call + how we connect)
│   ├── Company                   openai | anthropic | google | openrouter | nvidia
│   ├── Protocol                  cli (Local) | http (Cloud)
│   │   └── sub_protocol          (AuthMethod + endpoint URL)
│   │       ├── AuthMethod        apiKey | oauth2Pkce | oauth2 | deviceCode
│   │       ├── Endpoint URL
│   │       └── Credentials       key / token satisfying AuthMethod
│   └── Model                     the LLM the agent runs
└── Harness                       (shapes execution env; makes the agent good)
    ├── Tools
    ├── Guardrails
    ├── Feedback loops
    ├── Observability
    ├── Hooks
    ├── Linters
    ├── Quality gates
    └── Repo management
```

---

## 3. Key architectural insight: who owns the harness

The two protocols realize the harness very differently. This drives the whole
dependency order.

- **CLI agents already *are* a harness.** `codex`, `claude`, etc. ship with
  tools, sandboxing, repo access, hooks, and an agent loop built in. Our harness
  for a CLI agent is **a thin mapping of our `Harness` fields onto the CLI's
  flags/config**. Cheap. Reuse over rebuild.
- **HTTP agents are a bare model.** The API returns tokens; *we* must supply the
  loop, the tools, file access, guardrails, observability — i.e. we **build the
  harness ourselves**. Expensive.

→ **CLI protocol first** (lean, leverages existing CLIs), **HTTP protocol later**
(requires us to build an agent loop). The domain model is shared; the *adapter*
behind it differs in weight.

---

## 4. Domain model

Lives in the **extension host** (Node) under `src/worker/`. The webview never
spawns processes or holds credentials.

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
  model?: string;                // omit → let the CLI/API use its configured default
  // Credentials are NOT stored on the Agent — resolved at run time from a
  // CredentialSource (see §6) so secrets never sit in serialized config.
  credentialRef?: string;        // opaque handle into the credential store
}

export interface Harness {
  // Phase 1 fills only sandbox + workingDir; the rest are declared so the
  // shape is stable as later phases light them up.
  sandbox: SandboxMode;          // guardrails
  workingDir: string;            // repo management
  tools?: ToolSpec[];            // §5
  guardrails?: GuardrailSpec;
  feedbackLoops?: FeedbackSpec;
  observability?: ObservabilitySpec;
  hooks?: HookSpec[];
  linters?: LinterSpec[];
  qualityGates?: QualityGateSpec[];
}

export interface Worker {
  id: string;
  agent: Agent;
  harness: Harness;
}
```

Later-phase sub-types (`ToolSpec`, `GuardrailSpec`, …) are stubbed now and
fleshed out in their phase. Declaring them keeps `Harness` stable.

---

## 5. Harness facets — full vision

Each facet, and how each protocol realizes it. CLI column = "map to an existing
flag/config"; HTTP column = "we build it".

| Facet | CLI realization (e.g. Codex) | HTTP realization (we build) |
|---|---|---|
| **Tools** | MCP servers (`codex mcp`), built-in tools | Tool/function defs in the request; we dispatch + loop |
| **Guardrails** | `-s/--sandbox`, `--add-dir`, approval mode | Our pre/post validation around each tool call |
| **Feedback loops** | CLI's own agent loop | Our loop: run → observe → re-prompt |
| **Observability** | `--json` JSONL event stream | We log every request/response/tool call |
| **Hooks** | CLI hook files + trust flags | Our before/after callbacks in the loop |
| **Linters** | Run inside the agent's sandbox | We invoke linters between turns, feed results back |
| **Quality gates** | Project rules / execpolicy | We gate completion on tests/lint passing |
| **Repo management** | `-C/--cd`, `--skip-git-repo-check`, `--add-dir` | We stage files, apply diffs, manage git ourselves |

**Phase 1 implements only Guardrails (sandbox) + Repo management (workingDir)**
for the CLI protocol. Everything else is declared and deferred.

---

## 6. The Agent adapter abstraction

To support five companies × two protocols without branching everywhere, each
(Company × Protocol) is a pluggable **adapter** behind one interface. The runner
is adapter-agnostic.

```ts
// src/worker/adapters/types.ts
export interface AgentAdapter {
  readonly company: Company;
  readonly protocol: Protocol;

  // Which auth methods this (company × protocol) allows → constrains UI + validation.
  allowedAuthMethods(): AuthMethod[];

  // Translate a Worker into a concrete, runnable invocation.
  //  - CLI adapters: returns argv + env (+ stdin) for child_process.spawn
  //  - HTTP adapters: returns the request plan for the agent loop
  buildInvocation(worker: Worker, task: string, creds: Credentials): Invocation;

  // Normalize raw agent output into typed WorkerEvents the UI understands.
  parseEvents(raw: AsyncIterable<Buffer>): AsyncIterable<WorkerEvent>;
}
```

```ts
// Normalized event stream — same shape regardless of company/protocol.
export type WorkerEvent =
  | { type: "started" }
  | { type: "agent-message"; text: string }
  | { type: "tool-call"; name: string; detail?: string }
  | { type: "log"; level: "info" | "warn" | "error"; text: string }
  | { type: "done"; lastMessage?: string }
  | { type: "error"; message: string };
```

**Credential store** — a small extension-host module that resolves a
`credentialRef` into live `Credentials`. Phase 1: "use the CLI's existing login"
(e.g. Codex's `~/.codex/auth.json`), so the store is a passthrough. Later:
per-account dirs (`CODEX_HOME` / `CLAUDE_CONFIG_DIR`) and OAuth/PKCE flows.

---

## 7. Execution architecture

```
Webview (React, sandboxed)                Extension host (Node)
─────────────────────────                 ──────────────────────────────
Worker config form  ──runTask──────────▶  panel.ts handler
task input                                   │
Run / Cancel                                 ▼
                                          runWorker(worker, task, onEvent)
                                             │  selects AgentAdapter
                                             │  buildInvocation()
                                             ▼
                                          child_process.spawn (CLI)   ← Phase 1
                                             │  stdout/stderr
                                             ▼
                                          adapter.parseEvents() → WorkerEvent
output pane  ◀──taskEvent (per event)──────┘
```

- **Runner** (`src/worker/runner.ts`): `runWorker(worker, task, onEvent)` picks
  the adapter, builds the invocation, spawns/streams, emits normalized
  `WorkerEvent`s, returns a cancel handle (kills the process / aborts the loop).
- **Protocol** (`src/webview/protocol.ts`) gains:
  ```ts
  WebviewToExtension += { type: "runTask"; worker: Worker; task: string }
                      | { type: "cancelTask"; workerId: string }
  ExtensionToWebview += { type: "taskEvent"; workerId: string; event: WorkerEvent }
  ```
- **panel.ts** routes `runTask` → `runWorker` → forwards each event as
  `taskEvent`; `cancelTask` → cancel handle.

### Ground-truth: Codex CLI (verified, v0.142.2)

The first adapter targets `openai × cli`. Verified against the installed binary
(do **not** trust the research doc — it had errors):

- `codex exec [--json] -s <mode> -C <dir> [-m <model>] "<task>"` ✅
- `--json` prints events as JSONL ✅ (there is **no** `--stream` flag — the doc
  was wrong; `--json` already streams)
- `-o/--output-last-message <FILE>` writes the final message cleanly ✅
- `-s/--sandbox` ∈ `{read-only, workspace-write, danger-full-access}` ✅
- `-C/--cd <DIR>`, `--add-dir`, `--skip-git-repo-check`, `--ephemeral` ✅
- `--ignore-user-config`, `--ignore-rules` ✅
- Multi-account via `CODEX_HOME` (auth uses `CODEX_HOME/auth.json`) ✅
- Auth: reuse existing `codex login` for Phase 1 (an `auth.json` is already
  present on this machine).

Phase 1 invocation:
```
codex exec --json -s <sandbox> -C <workingDir> [-m <model>] "<task>"
```

---

## 8. Company × Protocol × AuthMethod matrix

The constraint table the validation + UI are built from. **Status** flags how
much is verified — anything not `verified` MUST be confirmed against the real
tool/API before its phase is implemented (see §10).

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

Notes carried from research (treat as hypotheses to verify):
- Model ids (`gpt-5.x`, `gemini-3.5-flash`, etc.) are **unverified** — never
  hardcode; default to "omit model → let the agent use its configured default,"
  and offer a free-text/model-list field.
- OpenAI HTTP `oauth2` sub-protocol needs a local proxy and hits an undocumented
  backend — fragile; lowest priority.
- Antigravity (`agy`) replacing Gemini CLI is unconfirmed; verify the actual CLI
  before building the `google × cli` adapter.

---

## 9. UI (webview)

`src/webview/views/worker.tsx` — one view, reusing existing shadcn primitives.

- **Agent picker:** Company `<Select>` → Protocol toggle (Cloud/Local) →
  (later: sub-protocol + auth + credentials). Phase 1: openai/cli only, auth =
  "existing login".
- **Model:** free-text / list input; empty = default (no `-m`).
- **Harness:** sandbox `<Select>`; workingDir input. (Later phases add the other
  facets progressively.)
- **Task:** `<Textarea>` + **Run** / **Cancel**.
- **Output pane:** appends streamed `WorkerEvent`s (messages, tool calls, final).

The `.temp/worker.png` provider sidebar (already prototyped as the Tree
component) becomes the agent picker's home in a later phase.

---

## 10. Verification discipline (non-negotiable)

The research notes (`docs/research/how-to-use-agent.md`) are a **starting point,
not truth** — already proven wrong on `--stream`. For every adapter, before
implementing its phase:

1. Confirm the CLI exists and its flags via `--help` (or the API shape via a
   real call) — capture verified facts in that phase's plan.
2. Confirm allowed AuthMethods and the actual env vars / endpoint URLs.
3. Never hardcode model ids without confirming they exist.

Phase 1's Codex facts are already verified (§7).

---

## 11. Implementation order (by dependency)

Each phase = its own implementation plan. Earlier phases unblock later ones.

**Phase 0 — Foundations (shared, no agent yet)**
`src/worker/types.ts` (full shape), `AgentAdapter` interface, `WorkerEvent`,
runner skeleton + protocol messages, credential-store passthrough.
*Unblocks everything.*

**Phase 1 — First Worker: `openai × cli` (the MVP)**
Codex adapter (`buildInvocation` + `parseEvents` for `--json`), minimal harness
(sandbox + workingDir), runner spawns Codex, `worker.tsx` UI, end-to-end run +
cancel + streamed output. *Proves the whole pipeline with verified facts.*

**Phase 2 — Second CLI agent: `anthropic × cli`**
Validates the adapter abstraction across two CLIs; adds OAuth-token auth +
per-account config dir. *Forces the abstraction to be real, not Codex-shaped.*

**Phase 3 — Harness depth (CLI)**
Light up more facets on the CLI protocol: observability (parse full event
stream), hooks, tools/MCP, quality gates. *Where the "better harness" value
compounds.*

**Phase 4 — First HTTP agent + the agent loop**
`anthropic × http` or `openrouter × http`: build the agent loop, tool dispatch,
file access, observability — the harness we own. *Unlocks the Cloud protocol.*

**Phase 5 — Breadth**
Remaining companies/sub-protocols (`google`, `nvidia`, OpenAI HTTP oauth proxy),
multi-account credential management, OAuth/PKCE/device-code flows.

(Routing — task → best agent — is a **separate** capability beyond this spec; it
consumes Workers produced here.)

---

## 12. Out of scope (this spec)

- Routing / auto-selecting an agent for a task.
- Persisting worker configs across sessions (Phase 1 is in-memory; persistence
  can come with multi-account work).
- The Scrum-team orchestration layer (multiple Workers collaborating) — built on
  top of Workers later.
