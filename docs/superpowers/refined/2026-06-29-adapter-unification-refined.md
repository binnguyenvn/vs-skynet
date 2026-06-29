# Adapter Unification — Refined User Stories

**Plan:** [`../plans/2026-06-29-adapter-unification.md`](../plans/2026-06-29-adapter-unification.md)
**Spec:** [`../specs/2026-06-29-adapter-unification-design.md`](../specs/2026-06-29-adapter-unification-design.md)

Two User Stories, each a complete vertical slice. Audit found no slicing
violations: US-1 folds the shared types into the same feature that consumes them
(not a standalone "types" layer), and US-2 is the downstream consumer collapse.
The two roadmap slugs `adapters--events` + `adapters--errors` live in US-1 together
because they are the *same* refactor — you can't dedupe the classifier without
editing the same adapter files that switch to the normalized event stream.

---

## US-1: Normalized adapter core — all three CLIs speak one event language

**What it does:** Today codex, claude, and agy each emit their own slightly
different event objects and each ship an identical copy of the same error
classifier. This makes them all emit **one** shared event shape (`WorkerEvent`)
and a shared result, expose a common `AgentAdapter` handle, and call **one**
shared classifier — so the rest of the app (and the future orchestrator) can drive
any CLI without knowing which one it is.

**Scope:**
- In: a shared `src/adapters/types.ts` (`WorkerEvent`, `WorkerUsage`,
  `WorkerResult`, `RunOpts`, `WorkerRun`, `AgentAdapter`, `ErrorClass`) and a
  shared `src/adapters/classify.ts`; converting all three `events.ts` mappers to
  return `WorkerEvent`(s); converting all three adapters to the shared types and
  exporting a `codexAdapter`/`claudeAdapter`/`agyAdapter: AgentAdapter`; deleting
  the three per-CLI event/usage/result types and the three identical
  `classify.ts` copies. Tests rewritten to the normalized shapes (incl. the gated
  `CODEX_E2E`/`CLAUDE_E2E` real-CLI proofs).
- Out: the webview bridge collapse (US-2); any new event fields (`tool_result`,
  timestamps, partial text); any fallback/retry logic (Decision A); refining the
  classifier regexes against real limit/transport output.

**Acceptance:**
- `mapCodexLine`/`mapClaudeLine`/`mapAgyLine` return normalized `WorkerEvent`s:
  `started` carries `sessionId` (and `model` only for claude); agy `thought` →
  `kind:"thinking"`; agy `tool_call` → `input`; usage carries `cachedInputTokens`
  (codex `cached_input` + claude `cache_read`), `cacheWriteTokens` (claude
  `cache_creation`), `reasoningTokens` (codex), `costUsd` (claude).
- Each adapter exports an `AgentAdapter` whose `run(opts)` returns a `WorkerRun`
  (`AsyncIterable<WorkerEvent>` + `cancel()` + `result: Promise<WorkerResult>`).
- One shared `classifyError` remains; `git grep "/classify\"" src` and
  `git grep "CodexEvent\|ClaudeEvent\|AgyEvent"` return nothing.
- `npm test` is green, including the gated real-CLI runs.

**Tasks:** Task 1 (shared types + classifier), Task 2 (codex), Task 3 (claude),
Task 4 (agy).

---

## US-2: Generic webview bridge — one smoke-test path for every adapter

**What it does:** The three near-identical "Test X" bridges that stream a CLI run
into the webview log panel become **one** generic bridge that takes any
`AgentAdapter`. A developer still clicks **Test Codex / Test Claude / Test Agy**
and watches the run stream, but there's now one code path instead of three.

**Scope:**
- In: a new `src/adapters/webview-bridge.ts` (`streamAdapterTestToWebview` + one
  unified `formatEvent` over `WorkerEvent`); deleting the three
  `<cli>/webview-bridge.ts` and their three tests; one new generic bridge test;
  rewiring `panel.ts` to pick the adapter per `testCodex`/`testAgy`/`testClaude`.
- Out: the `protocol.ts` message types and the React UI (unchanged — the three
  buttons/log panels stay); any production observability panel (subsystem 2).

**Acceptance:**
- `streamAdapterTestToWebview(adapter, …)` posts `Starting <Id> test...`, one log
  line per event via the unified `formatEvent`, then `done success` / `done
  <status>: <reason>`, all on the `${adapter.id}Log` channel.
- A `started` without `model` omits the parenthetical; usage line shows only the
  fields present.
- The three old bridges/tests are gone; `git grep "webview-bridge" src` shows only
  the new bridge, its test, and `panel.ts`.
- `npm test` green; manual: each button streams to its panel ending in
  `done success`.

**Tasks:** Task 5 (generic bridge + panel rewire).
