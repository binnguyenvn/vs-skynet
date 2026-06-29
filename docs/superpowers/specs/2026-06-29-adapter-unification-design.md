# Adapter Unification — Normalized `WorkerEvent` + shared error classification — Design

**Date:** 2026-06-29
**Epic:** Adapters (subsystem 1) · **Features/US:** Normalized `WorkerEvent` stream (`adapters--events`) + Error classification (`adapters--errors`)
**Parent:** [`2026-06-29-skynet-vision-design.md`](2026-06-29-skynet-vision-design.md)
**Builds on:** [`2026-06-29-codex-adapter-design.md`](2026-06-29-codex-adapter-design.md), [`2026-06-29-claude-adapter-design.md`](2026-06-29-claude-adapter-design.md), [`2026-06-29-antigravity-adapter-design.md`](2026-06-29-antigravity-adapter-design.md)

## Goal

The three adapters (codex, claude, agy) were each built concrete-first and are now
structurally identical: a `runX()` returning an `AsyncIterable<XEvent>` plus
`cancel()` and `result: Promise<XResult>`, a per-CLI `events.ts`, and a
`classify.ts` that is a **byte-for-byte copy** across all three. The adapter specs
deliberately deferred the shared types; the ponytail comments in the code name the
extraction trigger explicitly ("THREE consumers — extract a shared classifier").

This is that extraction. Pull all three adapters behind **one `AgentAdapter`
interface** emitting **one normalized `WorkerEvent` stream**, and collapse the
three identical classifiers into **one** `classifyError`. This is the end state the
vision spec's Phase-1 row already describes ("codex + claude + agy CLI bridges
behind one `AgentAdapter` interface; normalized `WorkerEvent` stream; error
classification").

**Still in scope of Decision A:** adapters stay dumb bridges. No fallback/retry,
no step-function panel, no orchestrator. This is a pure refactor — same spawn,
JSONL, and cancel mechanics; only the *emitted shape* is normalized and the
classifier is deduped.

## Current state (what exists today)

```
src/adapters/
  codex/  { events.ts (CodexEvent/CodexUsage/CodexResult), classify.ts, codex-adapter.ts, webview-bridge.ts }
  claude/ { events.ts (ClaudeEvent/ClaudeUsage/ClaudeResult), classify.ts, claude-adapter.ts, webview-bridge.ts }
  agy/    { events.ts (AgyEvent/AgyUsage/AgyResult), classify.ts, agy-adapter.ts, webview-bridge.ts }
```

- The three `classify.ts` are identical (`LIMIT`/`TRANSPORT` regex → `ErrorClass`).
- `ErrorClass = "limit" | "transport" | "terminal"` is declared three times.
- `XResult` is identical across all three (`status`/`reason`/`errorClass`/`usage`/`lastMessage`).
- Event unions overlap but diverge in field names; usage shapes differ per provider.
- Each `<cli>/webview-bridge.ts` is a near-identical `streamXTestToWebview` + `formatEvent`,
  differing only by log channel (`codexLog`/`claudeLog`/`agyLog`) and per-CLI event fields.
- `panel.ts` imports all three `streamXTestToWebview`; `protocol.ts` has the three `*Log` message types and `testCodex`/`testAgy`/`testClaude` requests.

## The normalized contract — `src/adapters/types.ts`

```ts
export type ErrorClass = "limit" | "transport" | "terminal";

export type WorkerEvent =
  | { kind: "started"; sessionId: string; model?: string }  // codex/agy threadId → sessionId; model optional (claude only)
  | { kind: "message"; text: string }
  | { kind: "thinking"; text: string }                      // agy "thought" folds in here
  | { kind: "tool_call"; name: string; input: unknown }     // agy "args" → input
  | ({ kind: "usage" } & WorkerUsage)
  | { kind: "unknown"; raw: unknown };

export interface WorkerUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;  // codex cached_input_tokens + claude cache_read_input_tokens (both are cache reads)
  cacheWriteTokens?: number;   // claude cache_creation_input_tokens
  reasoningTokens?: number;    // codex reasoning_output_tokens
  costUsd?: number;            // claude only
}

export interface WorkerResult {
  status: "success" | "failed" | "cancelled";
  reason?: string;
  errorClass?: ErrorClass;
  usage?: WorkerUsage;
  lastMessage?: string;
}

export interface RunOpts {     // the COMMON contract; adapters widen it
  prompt: string;
  cwd: string;
  model?: string;
  configDir?: string;          // CODEX_HOME / CLAUDE_CONFIG_DIR / HOME
  oauthToken?: string;         // claude-only; other adapters ignore it
}
// Advanced per-adapter knobs stay out of the shared type (the smoke UI's
// TestFields never sets them, and `sandbox` is a string union in codex but a
// boolean in agy — they can't share one field). Each adapter declares:
//   interface CodexRunOpts  extends RunOpts { sandbox?: "read-only" | "workspace-write" | "danger-full-access" }
//   interface ClaudeRunOpts extends RunOpts { permissionMode?: ...; allowedTools?: string[] }
//   interface AgyRunOpts    extends RunOpts { sandbox?: boolean; skipPermissions?: boolean }
// runX(opts: <Cli>RunOpts); the AgentAdapter wrapper takes the shared RunOpts.

export interface WorkerRun extends AsyncIterable<WorkerEvent> {
  cancel(): void;
  result: Promise<WorkerResult>;
}

export interface AgentAdapter {
  readonly id: "codex" | "claude" | "agy";
  run(opts: RunOpts): WorkerRun;
}
```

### Field mapping per provider

| Provider | started | thinking | tool_call | usage |
|---|---|---|---|---|
| codex | `thread_id` → `sessionId` (no model) | — | — | `input`/`output` + `cached_input`→`cachedInputTokens`, `reasoning_output`→`reasoningTokens` |
| claude | `session_id` → `sessionId`, `model` | `thinking` block | `tool_use` (`name`,`input`) | `input`/`output` + `cache_read`→`cachedInputTokens`, `cache_creation`→`cacheWriteTokens`, `total_cost_usd`→`costUsd` |
| agy | `thread_id` → `sessionId` (no model) | `thought` → `thinking` | `tool_call` (`name`,`args`→`input`) | `input`/`output` only |

`unknown` is preserved verbatim (`raw`) by every adapter, exactly as today.

## Shared classifier — `src/adapters/classify.ts`

The single copy of the existing function (unchanged behavior):

```ts
import type { ErrorClass } from "./types";

const LIMIT = /rate.?limit|429|quota|too many requests/i;
const TRANSPORT = /network|econn|etimedout|timeout|socket|dns|enotfound/i;

// ponytail: heuristic patterns inherited from the adapters, unverified against
// real limit/transport output. Refine the regexes on first real capture.
export function classifyError(text: string): ErrorClass {
  if (LIMIT.test(text)) { return "limit"; }
  if (TRANSPORT.test(text)) { return "transport"; }
  return "terminal";
}
```

Call sites are unchanged: codex/agy classify `stderr` on non-zero exit; claude
classifies the `result` text (so a `429` in the result still → `limit`). Only the
function is shared now.

## Adapter changes

Each `<cli>/events.ts`:
- `mapCodexLine`/`mapClaudeLine`/`mapAgyLine` now return normalized `WorkerEvent`(s)
  (codex/agy: `WorkerEvent | null`; claude: `WorkerEvent[]`).
- The per-CLI `XEvent`/`XUsage`/`XResult`/`ErrorClass` types are **deleted**; they
  import from `../types`.

Each `<cli>/<cli>-adapter.ts`:
- imports `classifyError` from `../classify` and the types from `../types`.
- `runX()` internals (spawn args, readline queue, settle logic, cancel) are
  unchanged; only the types they reference change.
- exports an `AgentAdapter` value: `export const codexAdapter: AgentAdapter = { id: "codex", run: runCodex }` (and claude/agy). `runX` stays exported for direct callers/tests.

## Generic webview bridge — `src/adapters/webview-bridge.ts`

The three `<cli>/webview-bridge.ts` files are **deleted** and replaced by one:

```ts
export async function streamAdapterTestToWebview(
  adapter: AgentAdapter,
  webview: LogWebview,
  cwd: string,
  overrides: Partial<RunOpts> = {},
): Promise<void>
```

- One `formatEvent(ev: WorkerEvent): string | null` over the normalized union.
  Unified `usage` line shows only present fields, e.g.
  `usage in=… out=… cachedR=… cacheW=… reasoning=… cost=$…`.
- Posts `{ type: \`${adapter.id}Log\`, level, text }` — `adapter.id` narrows to the
  protocol's existing `"codexLog" | "claudeLog" | "agyLog"` union, so `protocol.ts`
  is unchanged.
- The first log line and prompt stay per-call (`"Starting <Id> test..."`, the
  reply-pong prompt) — derived from `adapter.id`.

`panel.ts`: `testCodex`/`testAgy`/`testClaude` each select the matching adapter
(`codexAdapter`/`agyAdapter`/`claudeAdapter`) and call the one bridge. The three
buttons and log panels in the React UI stay — this is still developer smoke UI.

## Data flow

```
panel → streamAdapterTestToWebview(adapter) → adapter.run(opts): WorkerRun
      → yields WorkerEvent → formatEvent → { type: `${id}Log` } postMessage
      → run.result: WorkerResult → "done success" / "done <status>: <reason>"
```

Unchanged from today except the emitted event/result shape is normalized and the
bridge is one function instead of three.

## Error handling

No behavior change. `errorClass` stays optional, set only on `status:"failed"`.
The "incomplete success" branches (codex exit 0 without `turn.completed`; claude
`is_error:true` with `subtype:"success"`) are preserved per-adapter — the shared
`classifyError` is just the regex function they all call.

## Testing

- `*-events.test.ts` rewritten to assert normalized `WorkerEvent`/`WorkerUsage`:
  - claude usage asserts `cachedInputTokens` (from `cache_read`) + `cacheWriteTokens`
    (from `cache_creation`) + `costUsd`.
  - codex usage asserts `cachedInputTokens` + `reasoningTokens`.
  - agy `thought` line asserts `kind:"thinking"`; agy `tool_call` asserts `input`.
  - `started` asserts `sessionId` for all three, `model` present only for claude.
- One `classify.test.ts` (shared) replaces the three `*-classify.test.ts` (identical
  cases collapse).
- `*-adapter.integration.test.ts` updated to the shared `WorkerResult`/`WorkerRun`
  types; `CODEX_E2E` / `CLAUDE_E2E` real-CLI proofs stay green (real reply-pong run
  succeeds with usage; cancelled run resolves `status:"cancelled"`).
- The three `*-webview-bridge.test.ts` become one `webview-bridge.test.ts` (or are
  updated in place) asserting the generic bridge: a fake `AgentAdapter` yielding
  `started`/`thinking`/`tool_call`/`message`/`usage` then a success result posts
  `Starting <Id> test...`, the unified lines, and `done success`; the posted
  `type` matches `adapter.id`.
- `npm test` (pretest compiles + lints the wiring) stays green.

## User Stories

### US-1 — Normalized adapter core (`adapters--events` + `adapters--errors`)
Shared `src/adapters/types.ts` + `src/adapters/classify.ts`; all three adapters
emit `WorkerEvent`, expose an `AgentAdapter`, and call the shared classifier.
Per-CLI event/usage/result types and the three `classify.ts` copies are deleted.
Proven by the rewritten `*-events`/`classify`/`*-integration` tests (incl. the
gated real-CLI proofs).

### US-2 — Generic webview bridge
One `src/adapters/webview-bridge.ts` (`streamAdapterTestToWebview` + `formatEvent`)
over `WorkerEvent`; the three `<cli>/webview-bridge.ts` deleted; `panel.ts`
rewired to select the adapter; the bridge tests collapsed/updated to the unified
log format. `protocol.ts` and the React UI unchanged.

## Out of scope (YAGNI)

- New event fields (`meta`, timestamps, sequence numbers), a `tool_result` kind,
  or streaming partial text — no current CLI feeds them. Add when a consumer needs them.
- Backfilling `started.model` for codex/agy (they don't report it; stays optional).
- Any fallback/retry/AgentPool logic (Decision A — later Orchestrator concern).
- Replacing the smoke UI with a real observability panel (subsystem 2).
- Refining the classifier regexes against real limit/transport output (separate,
  data-driven follow-up; the ponytail comment carries the trigger).
