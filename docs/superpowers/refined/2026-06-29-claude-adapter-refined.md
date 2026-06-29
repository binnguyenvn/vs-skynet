# Claude Code (claude) Adapter — Refined User Stories

**Plan:** [`../plans/2026-06-29-claude-adapter.md`](../plans/2026-06-29-claude-adapter.md)
**Spec:** [`../specs/2026-06-29-claude-adapter-design.md`](../specs/2026-06-29-claude-adapter-design.md)

Two User Stories, each a complete vertical slice. No slicing violations found —
mirrors the codex/agy adapter split (adapter core + smoke-UI).

---

## US-1: Claude Code adapter — run a task through `claude` and get a typed result

**What it does:** Lets the rest of the extension run a prompt through the Claude
Code CLI and receive a live stream of typed events (start, assistant text,
thinking, tool calls, token/cost usage) plus a single clear outcome (succeeded /
failed / cancelled), instead of raw terminal JSONL.

**Scope:**
- In: the `src/adapters/claude/` module — event types + JSONL line mapper
  (`events.ts`), error classifier (`classify.ts`, copied from codex), and the
  `runClaude()` adapter (`claude-adapter.ts`) that spawns
  `claude -p --output-format stream-json --verbose`, streams events, and resolves
  a terminal result. Fast fake-CLI tests + a real-CLI proof gated behind
  `CLAUDE_E2E`.
- Out: any UI; multi-turn/resume, `--json-schema` structured output,
  `--input-format stream-json`, images; the shared `AgentAdapter`/`WorkerEvent`
  type and the shared-classifier extraction (later USs).

**Acceptance:**
- `runClaude({prompt, cwd})` over a fake `claude` that emits `system/init` +
  an `assistant` text block + a `result` with `is_error:false`, exit 0 →
  `status: 'success'`, `started` + `message` events streamed, hook-noise lines
  surface as `unknown`, `lastMessage` is the text, `usage` carries `costUsd`.
- **Gotcha proven:** a fake `claude` that emits `subtype:"success"` with
  `is_error:true` ("Not logged in") and exits 0 → `status: 'failed'`,
  `errorClass: 'terminal'`, `reason` carries the result text.
- A fake `claude` whose `result` text contains `429` → `status: 'failed'`,
  `errorClass: 'limit'`.
- `mapClaudeLine` fans an `assistant` line out to
  `message`/`thinking`/`tool_call`/`usage`, maps `system/init` → `started`,
  hook subtypes → `unknown`, and `result` → `usage` (with cost).
- `CLAUDE_E2E=1 npm test` → real `claude` reply-pong run succeeds (usage
  present) and a cancelled run resolves `status: 'cancelled'`.

**Tasks:** Task 1 (event types + JSONL mapper), Task 2 (classifier), Task 3
(`runClaude` + fake-CLI and real-CLI proof).

---

## US-2: Test Claude webview smoke UI — prove the adapter from the panel

**What it does:** Adds a **Test Claude** button and a **Claude log** panel to the
existing Skynet webview so a developer can click once and watch a real claude run
stream its output, tool calls, usage, and final status inside the extension.

**Scope:**
- In: the `testClaude`/`claudeLog` postMessage protocol entries, the
  `streamClaudeTestToWebview` host bridge that formats each event as a log line,
  the extension-host handler wiring, and the React button + log panel. A fast
  bridge unit test (fake run) + a manual click-through.
- Out: any production worker/observability panel (this is a developer smoke test
  only); changes to the codex/agy buttons.

**Acceptance:**
- The bridge unit test: a fake `ClaudeRun` yielding
  `started`/`thinking`/`tool_call`/`message`/`usage` then a success result posts
  exactly `Starting Claude test...`, `started session … (model)`,
  `thinking: …`, `tool …`, the message text, `usage in=… out=… cacheW=… cacheR=…
  cost=$…`, `done success`.
- Manual: clicking **Test Claude** streams lines into the Claude log panel ending
  in `done success`; the button disables while running and re-enables on
  done/error.
- `npm test` stays green (pretest compiles + lints the wiring).

**Tasks:** Task 4 (protocol + bridge), Task 5 (host + React view wiring).
