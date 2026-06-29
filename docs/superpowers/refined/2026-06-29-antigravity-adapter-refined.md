# Antigravity (agy) Adapter — Refined User Stories

**Plan:** [`../plans/2026-06-29-antigravity-adapter.md`](../plans/2026-06-29-antigravity-adapter.md)
**Spec:** [`../specs/2026-06-29-antigravity-adapter-design.md`](../specs/2026-06-29-antigravity-adapter-design.md)

Two User Stories, each a complete vertical slice. No slicing violations found —
mirrors the codex adapter split (adapter core + smoke-UI).

---

## US-1: Antigravity adapter — run a task through `agy` and get a typed result

**What it does:** Lets the rest of the extension run a prompt through the
antigravity CLI and receive a live stream of typed events plus a single clear
outcome (succeeded / failed / cancelled), instead of raw terminal text.

**Scope:**
- In: the `src/adapters/agy/` module — event types + stdout parser
  (`events.ts`), error classifier (`classify.ts`, copied from codex), and the
  `runAgy()` adapter (`agy-adapter.ts`) that spawns `agy --print`, streams
  events, and resolves a terminal result. Fast fake-CLI tests + a real-CLI
  proof gated behind `AGY_E2E`.
- Out: any UI; token usage / thread id / tool-step events (typed and
  parser-mapped as forward-compat stubs, but never emitted by `--print`); the
  Python-SDK sidecar that would fill those stubs; shared adapter types.

**Acceptance:**
- `runAgy({prompt, cwd})` over a fake `agy` that prints text and exits 0 →
  `status: 'success'`, a `message` event streamed, `lastMessage` contains the
  text, `usage` undefined.
- A fake `agy` that writes `429` to stderr and exits 1 → `status: 'failed'`,
  `errorClass: 'limit'`.
- `mapAgyLine` maps a plain line → `message`, a blank line → null, and the
  stub JSON lines → `started`/`tool_call`/`thought`/`usage`/`unknown`.
- `AGY_E2E=1 npm test` → real `agy` reply-pong run succeeds and a cancelled
  run resolves `status: 'cancelled'`.

**Tasks:** Task 1 (event types + parser), Task 2 (classifier), Task 3 (`runAgy`
+ fake-CLI and real-CLI proof).

---

## US-2: Test Agy webview smoke UI — prove the adapter from the panel

**What it does:** Adds a **Test Agy** button and an **Agy log** panel to the
existing Skynet webview so a developer can click once and watch a real agy run
stream its output and final status inside the extension.

**Scope:**
- In: the `testAgy`/`agyLog` postMessage protocol entries, the
  `streamAgyTestToWebview` host bridge that formats each event as a log line,
  the extension-host handler wiring, and the React button + log panel. A fast
  bridge unit test (fake run) + a manual click-through.
- Out: any production worker/observability panel (this is a developer smoke
  test only); changes to the codex button.

**Acceptance:**
- The bridge unit test: a fake `AgyRun` yielding `started`/`message`/
  `tool_call` then a success result posts exactly
  `Starting Antigravity test...`, `started thread …`, the message text,
  `tool …`, `done success`.
- Manual: clicking **Test Agy** streams lines into the Agy log panel ending in
  `done success`; the button disables while running and re-enables on done/error.
- `npm test` stays green (pretest compiles + lints the wiring).

**Tasks:** Task 4 (protocol + bridge), Task 5 (host + React view wiring).
