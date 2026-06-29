# Codex Adapter — Design

**Date:** 2026-06-29
**Epic:** Adapters (subsystem 1) · **Feature/US:** Codex adapter
**Parent:** [`2026-06-29-skynet-vision-design.md`](2026-06-29-skynet-vision-design.md)

## Goal

A standalone, concrete bridge that runs a task through the **codex CLI** and turns
its output into a typed, observable stream with a clear terminal status. This is
the *first* adapter, built and proven on its own.

**Bottom-up by decision:** we build each CLI adapter concrete and working first
(codex, then claude, then agy). We do **not** invent a shared `AgentAdapter`
interface or normalized `WorkerEvent` type yet — that abstraction is extracted in
a later US once ≥2 real adapters exist and the genuine commonality is visible.
Premature abstraction from one example is the thing we're avoiding.

Scope is **codex only**. No fallback/retry (Decision A in the vision), no
step-function panel (subsystem 2), no shared types.

## Verified ground truth (real CLI)

`codex-cli 0.142.3`. The adapter drives the non-interactive path:

```
codex exec --json --skip-git-repo-check -s read-only -C <cwd> [-m <model>] "<prompt>"
```

`--json` prints events to stdout as JSONL. A real `"reply pong"` run emitted:

```jsonl
{"type":"thread.started","thread_id":"019f...","...":""}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"pong"}}
{"type":"turn.completed","usage":{"input_tokens":12406,"cached_input_tokens":9088,"output_tokens":5,"reasoning_output_tokens":0}}
```

**Gotcha (observed):** when stdin is an open/empty pipe, codex prints
`"Reading additional input from stdin..."` and blocks. The adapter MUST pass the
prompt as an argv argument and set the child's `stdin` to `'ignore'`.

**Run strategy chosen:** spawn `codex exec --json` and parse JSONL.
Rejected — `app-server`/`mcp-server` (experimental, heavier protocol) and
plain-text stdout scraping (fragile).

## Public shape (concrete, codex-specific)

New directory `src/adapters/codex/`, isolated from the webview.

```ts
// events.ts — normalized from codex JSONL, codex-specific (not shared)
type CodexEvent =
  | { kind: 'started'; threadId: string }
  | { kind: 'message'; text: string }
  | { kind: 'usage'; inputTokens: number; cachedInputTokens: number;
      outputTokens: number; reasoningOutputTokens: number }
  | { kind: 'unknown'; raw: unknown };   // forward-compat for new codex events

type CodexResult = {
  status: 'success' | 'failed' | 'cancelled';
  reason?: string;            // human-readable on failed/cancelled
  errorClass?: 'limit' | 'transport' | 'terminal';   // set when status==='failed'
  usage?: CodexUsage;
  lastMessage?: string;       // last agent_message text
};

// codex-adapter.ts
interface RunOpts {
  prompt: string;
  cwd: string;
  model?: string;
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access'; // default 'read-only'
}

interface CodexRun extends AsyncIterable<CodexEvent> {
  cancel(): void;             // kills the child; result resolves status:'cancelled'
  result: Promise<CodexResult>;
}

function runCodex(opts: RunOpts): CodexRun;
```

`unknown{raw}` keeps the adapter forward-compatible: a codex event type we don't
model yet surfaces as `unknown` instead of crashing the parser.

## Data flow

1. `runCodex` spawns the child with argv above, `stdin:'ignore'`, pipes stdout/stderr.
2. stdout is split on newlines; each non-empty line is `JSON.parse`d and mapped:
   `thread.started`→`started`, `item.completed`(agent_message)→`message`,
   `turn.completed`→`usage`, anything else→`unknown{raw}`. Mapped events are
   yielded from the async iterator as they arrive.
3. stderr is buffered (used only for error classification).
4. On child `exit`/`error` the `result` promise resolves (see status rules).

## Error classification (heuristic — Phase-1 requirement)

The vision requires adapters to classify failures so a future fallback layer has
signal. The adapter itself does **no** retry.

| Condition | status | errorClass |
|---|---|---|
| exit 0 **and** saw `turn.completed` | `success` | — |
| `.cancel()` was called | `cancelled` | — |
| exit ≠ 0 (or exit 0 without `turn.completed`) | `failed` | classify ↓ |

`classifyError(exitCode, stderr) -> 'limit' | 'transport' | 'terminal'` is a pure
function matching stderr text:
- `/rate.?limit|429|quota|too many requests/i` → `limit`
- `/network|econn|etimedout|timeout|socket|dns|enotfound/i` → `transport`
- otherwise → `terminal`

```ts
// ponytail: heuristic stderr patterns from docs/reason, not from observed
// limit/transport output (a real 429 can't be induced on demand). Refine the
// regexes the first time we capture real limit/transport stderr.
```

## Proof of function (acceptance gate)

No step-function panel yet, so proof is a **real integration test** (the existing
`vscode-test`/mocha harness) plus a fast unit test for the pure classifier.

- **happy** *(real codex, slow/uses quota)*: `runCodex({prompt:"reply pong", ...})`
  → events include a `message` with `pong`, `result.status==='success'`,
  `result.usage` present.
- **cancel** *(real codex, slow)*: start a longer task, call `.cancel()` mid-run
  → `result.status==='cancelled'`.
- **classify** *(pure, fast)*: `classifyError` returns `limit`/`transport`/
  `terminal` for representative stderr strings.

Real-CLI tests are marked slow and may consume codex quota.

## Out of scope

- Shared `AgentAdapter` interface / normalized `WorkerEvent` (later US, after ≥2 adapters).
- Fallback/retry/AgentPool (Decision A — Orchestrator/Phase 2).
- Step-function panel and observability (subsystem 2).
- Soul injection, multi-turn/resume, images, output-schema (later USs).
