# Worker Epic 2 Harness Core Review

Range: `b4c328f..d9808ca`

Plan: `docs/superpowers/plans/2026-06-26-worker-epic2-harness-core.md`

## Problems

### Important: Webview treats non-terminal stream errors as terminal

- File: `src/webview/views/worker.tsx:39`
- Problem: the webview sets `running` to `false` for every `error` event.
- Why it matters: Codex can emit bare, non-terminal errors such as reconnect diagnostics while the runner keeps consuming the stream. The UI can become idle while the worker is still active, which enables a second run and makes cancel state inaccurate.
- Fix: distinguish terminal failures from stream diagnostics. Minimal option: add `terminal?: boolean` to runner-generated fatal `error` events and only clear `running` on `done` or terminal errors.

### Important: `maxSteps: 0` is treated as unlimited

- File: `src/worker/runner.ts:104`
- Problem: the guard uses a truthy check, so `0` disables the step cap instead of allowing zero tool calls.
- Why it matters: `0` is a valid guardrail meaning "no tool calls", and the webview can send it from `src/webview/views/worker.tsx:61`.
- Fix: use an explicit undefined check, e.g. `harness.maxSteps !== undefined && toolCalls > harness.maxSteps`, and add one test for `maxSteps: 0`.

### Minor: Runner emits Codex-specific exit text

- File: `src/worker/runner.ts:128`
- Problem: the CLI-agnostic runner emits `codex exited with code ...`.
- Why it matters: the Epic 2 plan says Codex-specific behavior belongs in `codex.ts`; this message will be wrong for future adapters.
- Fix: emit `process exited with code ${exit.code}` or `${invocation.command} exited with code ${exit.code}`.

## Assessment

Ready to merge: with fixes.

Core Epic 2 behavior is implemented, but the first two issues should be fixed before merging because they affect real run state and guardrail enforcement.
