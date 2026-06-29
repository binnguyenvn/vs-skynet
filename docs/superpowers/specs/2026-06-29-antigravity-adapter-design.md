# Antigravity (`agy`) Adapter — Design

**Date:** 2026-06-29
**Epic:** Adapters (subsystem 1) · **Feature/US:** Antigravity (agy) adapter
**Parent:** [`2026-06-29-skynet-vision-design.md`](2026-06-29-skynet-vision-design.md)
**Sibling:** [`2026-06-29-codex-adapter-design.md`](2026-06-29-codex-adapter-design.md) (the template this mirrors)

## Goal

A standalone, concrete bridge that runs a task through the **antigravity CLI
(`agy`)** and turns its output into a typed, observable stream with a clear
terminal status. Second adapter after codex, built and proven on its own.

**Bottom-up by decision:** still no shared `AgentAdapter` interface or normalized
`WorkerEvent` type. The adapter stays concrete and agy-specific. The genuine
commonality (now visible across codex + agy — notably `classifyError`) is noted as
an extraction trigger, but the extraction itself is a later US.

Scope is **agy only**, via its non-interactive `--print` mode. No fallback/retry
(Decision A), no step-function panel (subsystem 2), no shared types. A small
webview smoke UI mirrors the codex one to manually prove the stream.

## Verified ground truth (real CLI)

`agy 1.0.13`. The adapter drives the non-interactive path:

```
agy --print --dangerously-skip-permissions --sandbox [--model <m>] --add-dir <cwd> "<prompt>"
```

`--print` (alias `-p`) runs a single prompt non-interactively and prints the
agent's **final response as plain markdown text** to stdout, then exits 0. A real
`"reply pong"`-style run produced multi-paragraph markdown on stdout and exit
code 0; stderr carried only an informational `Shell cwd was reset to <dir>` line.

**Key divergence from codex:** there is **no `--json` / `--output-format`**. agy
emits *plain text only* — no JSONL, no per-event stream, no token usage, no thread
id. The rich codex event model (`thread.started` / `item.completed` /
`turn.completed`) has no equivalent on this surface.

**Flags (verified via `agy --help`):**
- No `-C`/cwd flag → the adapter sets the child's working directory via the spawn
  `cwd` option and passes `--add-dir <cwd>` so the workspace root is explicit.
- `--dangerously-skip-permissions` — auto-approves tool requests. **Mandatory
  headless**, or the agent blocks waiting for interactive approval.
- `--sandbox` — restricts terminal/FS access. Default on (safe-by-default, the
  agy analog of codex's `read-only`).
- `--model` — selects the model. `--print-timeout` defaults to 5m.

**Run strategy chosen:** spawn `agy --print` and read plain-text stdout.
Rejected — scraping the glog CLI debug log (`~/.gemini/antigravity-cli/log/*.log`,
fragile internal Go gRPC server logs) and the on-disk `brain/<uuid>/` conversation
store (undocumented internal state).

## Capability gap and the chosen path

The codex template is "spawn child → parse JSONL → typed events incl. usage." agy's
`--print` cannot produce that. Research surfaced one path that *can* — the official
**Python SDK `google-antigravity`** (`pip install google-antigravity`), which
streams response tokens, `response.thoughts` (reasoning deltas), and
strongly-typed `response.tool_calls`.

**Decision: ship the `--print` pure-TS adapter now; do not pull in Python yet.**
YAGNI — Phase-1 acceptance and the smoke UI only need "run a task, get text,
classify failure." Adding a Python runtime dependency to a TypeScript VSCode
extension to populate observability that doesn't exist yet is the premature
build the vision warns against. The SDK is recorded below as the documented
upgrade path, and the event types are shaped now so that swap is a backend change,
not a redesign.

## Public shape (concrete, agy-specific)

Core adapter code lives in `src/adapters/agy/`, mirroring `src/adapters/codex/`.
The event type carries the **full target shape now** — including `thought` and
`tool_call` kinds the SDK path will populate — even though `--print` only ever
emits `message`. This matches codex's forward-compatible `unknown` philosophy:
model the events ahead of the backend that fills them.

```ts
// events.ts — agy-specific (not shared)
interface AgyUsage {        // STUB shape; never populated by --print today.
  inputTokens: number;
  outputTokens: number;
}

type AgyEvent =
  | { kind: 'started'; threadId: string }               // STUB: --print emits no thread id. TODO (SDK)
  | { kind: 'message'; text: string }                    // REAL: a line of stdout
  | { kind: 'thought'; text: string }                    // STUB: SDK response.thoughts. TODO
  | { kind: 'tool_call'; name: string; args: unknown }   // STUB: SDK response.tool_calls. TODO
  | ({ kind: 'usage' } & AgyUsage)                       // STUB: SDK / `/usage`. TODO
  | { kind: 'unknown'; raw: unknown };                   // forward-compat for future agy output

interface AgyResult {
  status: 'success' | 'failed' | 'cancelled';
  reason?: string;            // human-readable on failed/cancelled
  errorClass?: 'limit' | 'transport' | 'terminal';   // set when status==='failed'
  usage?: AgyUsage;           // always undefined today (stub)
  lastMessage?: string;       // accumulated stdout text
}

// agy-adapter.ts
interface RunOpts {
  prompt: string;
  cwd: string;
  model?: string;
  sandbox?: boolean;          // default true  → passes --sandbox
  skipPermissions?: boolean;  // default true  → passes --dangerously-skip-permissions
}

interface AgyRun extends AsyncIterable<AgyEvent> {
  cancel(): void;             // kills the child; result resolves status:'cancelled'
  result: Promise<AgyResult>;
}

function runAgy(opts: RunOpts): AgyRun;
```

The async-iterator plumbing (queue + `resolveNext` + `finishIter`) is copied from
`codex-adapter.ts` verbatim — single-consumer, one `for await` per run.

## Webview smoke UI

The existing `hello` webview gains a manual **Test Agy** button and a small
`Agy log` panel, alongside (not replacing) the codex ones. Developer-facing smoke
test, not a production worker panel.

Message flow (mirrors codex):

1. Webview sends `{ type: "testAgy" }`.
2. Extension host handles it in `openWebview`, runs `streamAgyTestToWebview(webview, cwd)`.
3. The bridge calls `runAgy({ prompt: "Reply with exactly the word: pong", cwd })`.
4. Each `AgyEvent` is formatted to `{ type: "agyLog", level, text }` and posted back.
5. `HelloView` appends each line to the `Agy log` panel and disables the button
   while the run is active.

The bridge is tiny and tested with a fake `AgyRun`, so `npm test` never invokes
the real CLI or consumes quota.

## Data flow

1. `runAgy` spawns the child with the argv above, `{ cwd: opts.cwd,
   stdio: ['ignore','pipe','pipe'] }`. stdin `'ignore'` mirrors codex's
   anti-block discipline (and is correct for headless agy regardless).
2. stdout is split on newlines via `readline`; each non-empty line goes to
   `mapAgyLine` and yielded events flow from the async iterator as they arrive.
3. stderr is buffered (used only for error classification).
4. On child `exit`/`error` the `result` promise resolves (see status rules).

### `mapAgyLine` — codex-shaped, stubbed

```ts
// Map one agy stdout line to an AgyEvent.
// Today agy prints plain markdown → every non-blank line becomes a `message`.
// The JSON branch is a forward-compat STUB: if a future agy (or the SDK sidecar)
// emits structured JSONL, these branches light up without a parser rewrite.
function mapAgyLine(line: string): AgyEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let obj: any;
  try { obj = JSON.parse(trimmed); }
  catch { return { kind: 'message', text: trimmed }; }   // ← the only path hit today
  // ponytail: structured branches below are dormant until the SDK upgrade path
  // lands; they exist so that swap is a backend change, not a parser rewrite.
  switch (obj?.type) {
    case 'thread.started': return { kind: 'started', threadId: String(obj.thread_id ?? '') };
    case 'tool_call':      return { kind: 'tool_call', name: String(obj.name ?? ''), args: obj.args };
    case 'thought':        return { kind: 'thought', text: String(obj.text ?? '') };
    case 'usage':          return { kind: 'usage', inputTokens: obj.input_tokens ?? 0, outputTokens: obj.output_tokens ?? 0 };
    default:               return { kind: 'unknown', raw: obj };
  }
}
```

## Status rules

| Condition | status | errorClass |
|---|---|---|
| `.cancel()` was called | `cancelled` | — |
| exit 0 | `success` | — |
| exit ≠ 0 | `failed` | classify ↓ |

```ts
// ponytail: agy has no `turn.completed` equivalent, so success = clean exit (0).
// Codex requires both exit 0 AND a turn marker; agy can't give the marker today.
// TODO: when the SDK path lands, require a real completion signal before success.
```

## Error classification (heuristic — Phase-1 requirement)

`classifyError(stderr) -> 'limit' | 'transport' | 'terminal'` is **copied
verbatim from `src/adapters/codex/classify.ts`** (same regexes: rate-limit/429 →
`limit`; network/timeout/dns → `transport`; else `terminal`). The adapter does
**no** retry.

```ts
// ponytail: classify.ts is now duplicated across codex + agy. This is the second
// consumer — the explicit trigger to extract a shared classifier in the
// "Error classification" US. Not extracted here to keep this adapter standalone.
```

```ts
// ponytail: heuristic stderr patterns are inherited from codex and remain
// unverified against real agy limit/transport output (a real 429 can't be
// induced on demand). Refine the first time real agy failure stderr is captured.
```

## Documented upgrade path (SDK sidecar)

When subsystem 2 (step-function panel / observability) actually needs tool steps,
thoughts, or token usage from agy:

- Replace the spawned child `agy --print …` with a small Python helper using
  `google-antigravity` that emits **JSONL** (`thread.started`, `tool_call`,
  `thought`, `usage`, final `message`) to stdout.
- `mapAgyLine`'s dormant JSON branches above already map that JSONL.
- `AgyEvent` already carries `started` / `thought` / `tool_call` / `usage`.

So the change is: swap the spawn target + ship the Python script. The adapter's
public shape (`AgyEvent` / `AgyResult` / `AgyRun`) and all consumers stay put.
This sidecar is **out of scope for this US**.

## Proof of function (acceptance gate)

No step-function panel yet, so proof mirrors codex: a real integration test plus
fast pure-unit tests.

- **happy** *(real agy, slow/uses quota)*: `runAgy({prompt:"reply pong", ...})` →
  events include a `message` whose text contains `pong`, `result.status==='success'`.
- **cancel** *(real agy, slow)*: start a longer task, call `.cancel()` mid-run →
  `result.status==='cancelled'`.
- **classify** *(pure, fast)*: `classifyError` returns `limit`/`transport`/
  `terminal` for representative stderr strings.
- **mapAgyLine** *(pure, fast)*: a plain text line → `message`; a (stub) JSONL
  `tool_call`/`thread.started` line → the matching structured kind — locks the
  forward-compat path so the SDK swap is verified before it ships.
- **webview smoke bridge** *(pure/fake, fast)*: `streamAgyTestToWebview` posts a
  `Starting Antigravity test...` line, formatted event lines, and a final
  `done success`/error line to the webview protocol.

Real-CLI tests are marked slow and may consume agy quota.

## Out of scope

- Shared `AgentAdapter` interface / normalized `WorkerEvent` (later US).
- Shared `classifyError` extraction (its own US; this adapter is the trigger).
- The Python `google-antigravity` SDK sidecar (the documented upgrade path above).
- Fallback/retry/AgentPool (Decision A — Orchestrator/Phase 2).
- Full step-function panel and observability (subsystem 2). The Test Agy button
  is only a smoke UI for this adapter.
- Soul injection, multi-turn/resume (`--continue`/`--conversation`), images.
