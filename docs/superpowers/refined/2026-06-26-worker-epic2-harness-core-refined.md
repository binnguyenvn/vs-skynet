# Worker — Epic 2: Harness Core — Refined User Stories

> Plain-language view of the [Epic 2 plan](../plans/2026-06-26-worker-epic2-harness-core.md). Each User Story is one complete vertical slice — a feature that works end-to-end (data + logic + UI), not a technical layer. Audited: no layer-splits, no feature-mixes.

**The epic in one line:** turn Epic 1's raw Codex bridge into a *reliable* Worker — one that shows what it's doing, refuses to claim "done" without proof, and can be capped in what it spends and touches.

---

## US-1: Observability — the timeline shows the real run

**What it does:** When you run a task, the Worker shows you *everything* Codex actually did — its reasoning, each command with its exit code and output, every file it changed, how many tokens it used, and any errors it printed — instead of Epic 1's bland one-line log. It's rendered as a readable, typed timeline in the panel.

**Scope:**
- In: new event types (`reasoning`, `tool-result`, `file-change`, `usage`) on the CLI-agnostic `WorkerEvent` contract; richer Codex `parseEvents` mapping (pairing each command with its result by id); a real captured Codex fixture as ground truth; capturing the child process's stderr; a per-event timestamp; the event-typed webview timeline.
- Out: `mcp_tool_call` / `web_search` rich shapes (stay a generic log until a fixture proves them — Epic 4 touches MCP); any acting on what's observed.

**Acceptance:** Run a task that reasons, runs a command, and edits a file → the timeline shows started → reasoning (muted) → `▶ shell: <cmd>` → `✓/✗ exit N` (+output) → `✎ <kind> <path>` → token footer → done. stderr diagnostics appear as red error lines (the benign stdin notice is filtered).

**Tasks:**
- Task 1 — Capture richer Codex ground-truth fixture
- Task 2 — Expand `WorkerEvent` + Codex `parseEvents` (reasoning, tool-result, file-change, usage)
- Task 3 — Runner: stamp `ts`, capture child stderr → log events
- Task 4 — Webview: event-typed timeline

---

## US-2: Verification gate — no "done" without proof

**What it does:** You give the Worker a list of shell checks (e.g. `npm test`, `npm run lint`). After the agent says it's finished, the runner runs each check *itself* in the working directory and marks the run **verified** only if every check passes. The agent's own claim of "done" is never trusted — the research says agents are wrong about being done ~40% of the time.

**Scope:**
- In: an optional `verification` list on the harness; the runner running those checks after the agent's `done` (via an injectable command runner); a `verification` event per check (pass/fail + output); a `verified` flag on the final `done`; webview inputs to add/remove checks and badges showing each result + the verdict.
- Out: **auto-repair / re-prompting** on a failed check (that's the Orchestrator's loop, Epic 3+); the agent authoring its own assertions (checks are independent, held-out).

**Acceptance:** Add two checks, one passing and one failing → the timeline shows `✓ verify: <pass>`, `✗ verify: <fail>`, and `● done — NOT verified ✗`. With no checks configured, `done` looks exactly as in Epic 1 (no `verified` shown).

**Tasks:**
- Task 5 — `Harness.verification` + runner post-`done` verification gate
- Task 6 — Webview: verification command inputs + badges

---

## US-3: Guardrails — cap what it can spend and touch

**What it does:** You can cap how many tool calls a run may make and how long it may run; when a cap is breached the runner kills the process and tells you *why*. You also control the sandbox mode and any extra directories the agent is allowed to write to.

**Scope:**
- In: `maxSteps` and `timeoutMs` caps on the harness; the runner as a circuit breaker (count tool-calls / wall-clock → `kill()` + an `error` naming the cap); `writableRoots` mapped to Codex `--add-dir`; webview inputs for steps/timeout/writable-dirs (sandbox picker already exists from Epic 1).
- Out: a **mid-run token budget** — Codex only reports usage at the very end, so a token cap isn't enforceable from the stream; deferred to Epic 5's HTTP loop. Approval-as-code stays Codex execpolicy config, not runtime code.

**Acceptance:** Set Max steps = 1 and run a two-command task → it's killed with `error: step cap (1) exceeded` and no `done`. Set Timeout = 3 on a long task → `error: timeout (3000ms) exceeded`. A writable root passed in appears as `--add-dir <root>` in the Codex argv.

**Tasks:**
- Task 7 — `Harness.maxSteps`/`timeoutMs` + runner circuit breaker
- Task 8 — Webview + adapter: writable-roots (`--add-dir`) and cap controls

---

## Why these three and not more/fewer

The three User Stories map exactly onto the three harness facets the spec (§5) and the research call out — **Observability, Verification, Guardrails** — and onto Epic 2's stated deliverable (§12): "shows what it's doing + refuses to claim done without passing checks." Each ships standalone, end-to-end, behind the same CLI-agnostic contract that Epic 4's other CLIs and Epic 5's HTTP loop reuse unchanged. They're ordered by dependency: Observability grows the event vocabulary the other two emit into; Verification and Guardrails are independent of each other and could ship in either order.
