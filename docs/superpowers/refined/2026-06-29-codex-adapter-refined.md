# Codex Adapter — Refined User Stories

**Date:** 2026-06-29 · **Plan:** [`../plans/2026-06-29-codex-adapter.md`](../plans/2026-06-29-codex-adapter.md)

One US — a complete vertical slice. The three tasks are TDD steps within it, not separate stories.

## US-1: Run a task through codex and observe it

**What it does:** A developer hands the adapter a prompt and a folder; it runs the codex CLI on that task, streams back what codex is doing as typed events, and ends with a clear verdict — succeeded, failed (with a reason and a failure category), or cancelled.

**Scope:**
- In: spawning `codex exec --json`; parsing its JSONL into a codex-specific event stream (`started`/`message`/`usage`/`unknown`); cancellation; a terminal `CodexResult`; heuristic error classification (limit/transport/terminal); deterministic parser + classifier unit tests; an opt-in real-CLI integration test (happy + cancel).
- Out: shared `AgentAdapter`/`WorkerEvent` type (later US, after ≥2 adapters); fallback/retry; the step-function panel; soul injection; multi-turn/resume; images; output-schema.

**Acceptance:**
- `runCodex({prompt:"reply pong", cwd})` streams a `message` event, and `result` resolves `status:'success'` with `usage` and `lastMessage` containing "pong" (real-CLI test, `CODEX_E2E=1`).
- Cancelling after the `started` event resolves `status:'cancelled'`.
- `mapCodexLine` maps each real captured JSONL shape correctly and returns `null` for blank / non-JSON lines (incl. the stdin notice) — deterministic, no quota.
- `classifyError` buckets representative stderr into limit/transport/terminal — deterministic.
- `npm test` stays green and quota-free by default (integration suite skipped unless `CODEX_E2E`).

**Tasks:** Task 1 (event types + JSONL parser), Task 2 (error classifier), Task 3 (`runCodex` adapter + real-CLI proof).
