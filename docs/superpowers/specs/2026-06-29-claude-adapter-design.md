# Claude Code (`claude`) Adapter — Design

**Date:** 2026-06-29
**Epic:** Adapters (subsystem 1) · **Feature/US:** Claude Code adapter
**Parent:** [`2026-06-29-skynet-vision-design.md`](2026-06-29-skynet-vision-design.md)
**Sibling:** [`2026-06-29-codex-adapter-design.md`](2026-06-29-codex-adapter-design.md) (the template this mirrors)

## Goal

A standalone, concrete bridge that runs a task through the **Claude Code CLI
(`claude`)** and turns its output into a typed, observable stream with a clear
terminal status. Third adapter (after codex, agy), built and proven on its own.

**Bottom-up by decision:** still no shared `AgentAdapter` interface or normalized
`WorkerEvent` type. The adapter stays concrete and claude-specific. The genuine
commonality across codex + agy + claude (notably `classifyError`, now with a
**third** consumer) is a strong extraction trigger, but the extraction itself is
a later US.

Scope is **claude only**, via its non-interactive `--print` (`-p`) mode with
`--output-format stream-json`. No fallback/retry (Decision A), no step-function
panel (subsystem 2), no shared types. A small webview smoke UI mirrors the
codex/agy ones to manually prove the stream.

## Verified ground truth (real CLI)

`claude 2.1.195`. The adapter drives the non-interactive path:

```
claude -p "<prompt>" --output-format stream-json --verbose --model <model> --add-dir <cwd>
```

`--output-format stream-json` prints events to stdout as JSONL. `--verbose` is
**required** to get the full event stream under `-p` (without it the stream is
truncated). The child's `cwd` is set via the spawn option; `--add-dir <cwd>`
makes the workspace root explicit. A real `"reply pong"`-style run emitted these
event `type`s (one JSON object per line):

```jsonl
{"type":"system","subtype":"init","session_id":"...","model":"...","tools":[...],"permissionMode":"default"}
{"type":"assistant","message":{"content":[{"type":"text","text":"pong"}],"usage":{"input_tokens":...,"output_tokens":...,"cache_creation_input_tokens":...,"cache_read_input_tokens":...}}}
{"type":"result","subtype":"success","is_error":false,"result":"pong","total_cost_usd":0.01,"usage":{...}}
```

**Closest to codex** (rich JSONL with usage + tool calls), unlike agy's
plain-text `--print`. In fact the **richest of the three**: `assistant` content
blocks carry real `text`, `thinking`, and `tool_use` blocks; usage carries
cache-creation / cache-read tokens; `result` carries `total_cost_usd`.

**Gotcha 1 — `result.subtype:"success"` lies.** An observed run returned
`subtype:"success"` **with** `is_error:true` and `result:"Not logged in · Please
run /login"`. Terminal success MUST be gated on `is_error === false`, **not** on
`subtype`. (Codex keyed success off `turn.completed`; agy off clean exit; claude
off `is_error`.)

**Gotcha 2 — hooks pollute the stream.** `SessionStart` hooks (and any other
configured hooks) interleave `system` events with `subtype:"hook_started"` /
`"hook_response"` alongside the real ones. The parser folds every unmodeled
`system` subtype into `unknown{raw}` so hook noise never crashes it.

**Run strategy chosen:** spawn `claude -p --output-format stream-json` and parse
JSONL. Rejected — interactive mode (needs a TTY), `--output-format text` (loses
events/usage/tool calls), and the Agent SDK (heavier, not needed for Phase 1).

## Public shape (concrete, claude-specific)

Core adapter code lives in `src/adapters/claude/`, mirroring `src/adapters/codex/`
and `src/adapters/agy/`. Per the approved scope, the event type models the **full
rich set** — `thinking` and `tool_call` are **REAL** here (claude actually emits
them), not stubs like agy's.

```ts
// events.ts — claude-specific (not shared)
interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  costUsd?: number;            // from result.total_cost_usd (only on the result event)
}

type ClaudeEvent =
  | { kind: 'started'; sessionId: string; model: string }   // system/init
  | { kind: 'message'; text: string }                        // assistant text block
  | { kind: 'thinking'; text: string }                       // assistant thinking block (REAL)
  | { kind: 'tool_call'; name: string; input: unknown }      // assistant tool_use block (REAL)
  | ({ kind: 'usage' } & ClaudeUsage)                        // assistant/result usage
  | { kind: 'unknown'; raw: unknown };                       // system/hook_*, future events

interface ClaudeResult {
  status: 'success' | 'failed' | 'cancelled';
  reason?: string;            // human-readable on failed/cancelled (e.g. result.result text)
  errorClass?: 'limit' | 'transport' | 'terminal';   // set when status==='failed'
  usage?: ClaudeUsage;        // last/aggregate usage incl. cost
  lastMessage?: string;       // last assistant text (or result.result)
}

// claude-adapter.ts
interface RunOpts {
  prompt: string;
  cwd: string;
  model?: string;
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions'; // default 'default'
  allowedTools?: string[];    // optional → passes --allowedTools
}

interface ClaudeRun extends AsyncIterable<ClaudeEvent> {
  cancel(): void;             // kills the child; result resolves status:'cancelled'
  result: Promise<ClaudeResult>;
}

function runClaude(opts: RunOpts): ClaudeRun;
```

`unknown{raw}` keeps the adapter forward-compatible (hook events, new event
types). The async-iterator plumbing (queue + `resolveNext` + `finishIter`) is
copied from `codex-adapter.ts` / `agy-adapter.ts` verbatim — single-consumer,
one `for await` per run.

**Permission default — chosen, not asked.** `permissionMode` defaults to
`'default'`. Under `-p` (non-interactive) there is no one to approve tool prompts,
so tool requests are denied and the agent continues — the safe read-only-equivalent
that mirrors codex's `read-only` sandbox default. Callers that need real tool work
pass `'acceptEdits'`/`'bypassPermissions'` (and optionally `allowedTools`). The
adapter does not pass `--dangerously-skip-permissions` by default.

## Webview smoke UI

The existing `hello` webview gains a manual **Test Claude** button and a small
`Claude log` panel, alongside (not replacing) the codex and agy ones.
Developer-facing smoke test, not a production worker panel.

Message flow (mirrors codex/agy):

1. Webview sends `{ type: "testClaude" }`.
2. Extension host handles it in `openWebview`, runs `streamClaudeTestToWebview(webview, cwd)`.
3. The bridge calls `runClaude({ prompt: "Reply with exactly the word: pong", cwd })`.
4. Each `ClaudeEvent` is formatted to `{ type: "claudeLog", level, text }` and posted back.
5. `HelloView` appends each line to the `Claude log` panel and disables the
   button while the run is active.

The bridge is tiny and tested with a fake `ClaudeRun`, so `npm test` never
invokes the real CLI or consumes quota.

## Data flow

1. `runClaude` spawns the child with the argv above, `{ cwd: opts.cwd,
   stdio: ['ignore','pipe','pipe'] }`. stdin `'ignore'` mirrors the codex/agy
   anti-block discipline.
2. stdout is split on newlines via `readline`; each non-empty line is
   `JSON.parse`d and mapped by `mapClaudeLine`; yielded events flow from the
   async iterator as they arrive.
3. stderr is buffered (used only for error classification).
4. On child `exit`/`error` the `result` promise resolves (see status rules). The
   `result` event captured during the stream supplies `is_error`, `lastMessage`,
   final `usage`, and `costUsd`.

### `mapClaudeLine` — codex-shaped

```ts
// Map one claude stream-json line to zero-or-more ClaudeEvents.
// An `assistant` line fans out: one event per content block + a usage event.
function mapClaudeLine(obj: any): ClaudeEvent[] {
  switch (obj?.type) {
    case 'system':
      if (obj.subtype === 'init')
        return [{ kind: 'started', sessionId: String(obj.session_id ?? ''), model: String(obj.model ?? '') }];
      return [{ kind: 'unknown', raw: obj }];   // hook_started / hook_response / future subtypes
    case 'assistant': {
      const out: ClaudeEvent[] = [];
      for (const b of obj.message?.content ?? []) {
        if (b.type === 'text')     out.push({ kind: 'message', text: String(b.text ?? '') });
        else if (b.type === 'thinking') out.push({ kind: 'thinking', text: String(b.thinking ?? b.text ?? '') });
        else if (b.type === 'tool_use') out.push({ kind: 'tool_call', name: String(b.name ?? ''), input: b.input });
        else out.push({ kind: 'unknown', raw: b });
      }
      const u = obj.message?.usage;
      if (u) out.push({ kind: 'usage', ...toUsage(u) });
      return out;
    }
    case 'result':
      // status is decided from the captured result obj (is_error); emit final usage/cost here.
      return obj.usage ? [{ kind: 'usage', ...toUsage(obj.usage), costUsd: obj.total_cost_usd }] : [];
    default:
      return [{ kind: 'unknown', raw: obj }];
  }
}
```

## Status rules

| Condition | status | errorClass |
|---|---|---|
| `.cancel()` was called | `cancelled` | — |
| exit 0 **and** a `result` event with `is_error === false` | `success` | — |
| exit ≠ 0, **or** `result.is_error === true`, **or** no `result` event | `failed` | classify ↓ |

```ts
// ponytail: success requires is_error===false, NOT result.subtype==='success'.
// A real run returned subtype:'success' with is_error:true ("Not logged in").
// subtype is unreliable; is_error is the truth.
```

## Error classification (heuristic — Phase-1 requirement)

`classifyError(input) -> 'limit' | 'transport' | 'terminal'` reuses the codex
regexes (rate-limit/429 → `limit`; network/timeout/dns → `transport`; else
`terminal`). Unlike codex/agy it classifies against **both** `result.result`
text **and** stderr, because claude reports failures in the structured
`result.result` field (e.g. `"Not logged in"` → `terminal`), not only on stderr.
The adapter does **no** retry.

```ts
// ponytail: classify.ts is now duplicated across codex + agy + claude. THREE
// consumers — the strongest trigger yet to extract a shared classifier in the
// "Error classification" US. Not extracted here to keep this adapter standalone.
```

```ts
// ponytail: heuristic stderr/result patterns inherited from codex remain
// unverified against real claude limit/transport output (a real 429 can't be
// induced on demand). Refine the first time real claude failure output is captured.
```

## Proof of function (acceptance gate)

No step-function panel yet, so proof mirrors codex/agy: a real integration test
plus fast pure-unit tests.

- **happy** *(real claude, slow/uses quota)*: `runClaude({prompt:"reply pong", ...})`
  → events include a `message` whose text contains `pong`,
  `result.status==='success'`, `result.usage` present.
- **cancel** *(real claude, slow)*: start a longer task, call `.cancel()` mid-run
  → `result.status==='cancelled'`.
- **classify** *(pure, fast)*: `classifyError` returns `limit`/`transport`/
  `terminal` for representative stderr/result strings.
- **mapClaudeLine** *(pure, fast)*: `system/init`→`started`; an `assistant` line
  with text+thinking+tool_use blocks → the matching `message`/`thinking`/
  `tool_call` events + a `usage` event; `system/hook_*`→`unknown`; a `result`
  with `is_error:true`→ drives a `failed` status.
- **webview smoke bridge** *(pure/fake, fast)*: `streamClaudeTestToWebview` posts
  a `Starting Claude test...` line, formatted event lines, and a final
  `done success`/error line to the webview protocol.

Real-CLI tests are marked slow and may consume claude quota.

## Out of scope

- Shared `AgentAdapter` interface / normalized `WorkerEvent` (later US).
- Shared `classifyError` extraction (its own US; this adapter is the strongest trigger).
- Fallback/retry/AgentPool (Decision A — Orchestrator/Phase 2).
- Full step-function panel and observability (subsystem 2). The Test Claude
  button is only a smoke UI for this adapter.
- Multi-turn/resume (`--resume`/`--continue`), `--json-schema` structured output,
  `--input-format stream-json`, images, soul injection (later USs).
