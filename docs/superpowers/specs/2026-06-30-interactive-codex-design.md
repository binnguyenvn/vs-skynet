# Interactive Codex Adapter — Design (canonical frame)

**Date:** 2026-06-30
**Epic:** Adapters · **Feature/US:** Interactive (terminal) mode — Codex
**Parent:** [`2026-06-29-skynet-vision-design.md`](2026-06-29-skynet-vision-design.md)
**Frame for:** [`2026-06-30-interactive-claude-design.md`](2026-06-30-interactive-claude-design.md), [`2026-06-30-interactive-agy-design.md`](2026-06-30-interactive-agy-design.md)

## Goal

A **second run mode** for the codex adapter that drives `codex` as a **live
interactive TUI session inside a VSCode terminal**, instead of the one-shot
`codex exec --json` path. The orchestrator pastes prompts *into* the terminal and
reads results *out* of files the agent writes. This buys **multi-turn steering
(paused/resumed turns toward one task completion) + pause/resume in one
session** and a human-like execution surface, while keeping parsing robust.

This document is the **canonical frame**. The claude and agy interactive specs
are skeletons that only restate their CLI-specific deltas against this one.

**Add alongside, do not replace.** The existing `runCodex` (`codex exec --json`,
`src/adapters/codex/`) stays for fast one-shot tasks. Interactive mode is a new
sibling, not a rewrite.

## Why this shape (recorded decisions)

- **Ban risk is precautionary only** (no observed bans). So we build **no
  anti-ban machinery**; the human-like surface is a cheap by-product of running
  interactively in a real terminal, not a goal we pay complexity for.
- **Control is the real win:** multi-turn, pause/resume, live human takeover.
- **Public VSCode API cannot read a full-screen TUI's output.** Shell Integration
  only segments normal command/output pairs; a TUI is one endless execution.
  `onDidWriteTerminalData` is permanently proposed (needs `--enable-proposed-api`,
  unusable on Marketplace); there is no screen-buffer API. → **Output flows
  through files, never screen scraping.** VSCode's terminal `selectAll` +
  `copySelection` can dump the visible terminal into the clipboard for a manual
  diagnostic probe, but the result is noisy, mutable screen text, not a production
  data source.
- **No `node-pty`.** Native ABI must match VSCode's Electron, officially
  unsupported, breaks on VSCode updates. → Use VSCode's own `createTerminal`.
- **Session metadata is read from the CLI's own rollout file, not the screen** —
  accurate usage/session-id without trusting agent self-report.

## Verified ground truth (real CLI)

`codex` (Rust/ratatui TUI). Sources: developers.openai.com/codex, github.com/openai/codex,
and `src/test/terminal-probe.test.ts` (`TERMINAL_PROBE=1`, run 2026-07-01 against
a real `codex` install — mailbox pause/resume/done cycle, submit key, and
`/status` all passed).

- **Launch interactive:** `codex -C <cwd> -m <model> -s workspace-write -a never`
  (or `--dangerously-bypass-approvals-and-sandbox` / `--yolo` to never block on
  approvals). `codex exec` is the non-interactive path we already use. Flags are
  global (shared by `codex`, `exec`, `resume`).
  > [!NOTE]
  > **VERIFIED** — `src/test/terminal-probe.test.ts` (`TERMINAL_PROBE=1`, run
  > 2026-07-01) launches with this exact `-a never` argv and completes a
  > two-turn pause/resume/done cycle with no stuck approval prompt. `-a never`
  > is confirmed *auto-approve within sandbox*, not *deny everything*; the
  > `--yolo` fallback is not needed.
- **Session rollout file:** `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`
  (default `~/.codex`). JSONL of `RolloutLine` envelopes `{ "type", "payload" }`,
  **written incrementally** during the session. Relevant lines:
  - `session_meta` → conversation/session **id**, cwd, cli version, git info.
  - `event_msg` with `payload.type === "token_count"` → **cumulative** usage:
    `payload.info.total_token_usage.{input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens,total_tokens}`;
    `payload.info.last_token_usage` for the last turn; `payload.info.model_context_window`;
    and `payload.rate_limits` with 5h/weekly usage. Per-turn = current cumulative − previous cumulative
    unless `last_token_usage` is sufficient for the caller.
- **`/status` slash command:** verified in a real VSCode terminal. It prints the
  session id, model, cwd, permissions, AGENTS.md path, account, collaboration
  mode, context-window usage, and 5h/weekly limit status. The `Session:` value
  matches both `session_meta.id` and the rollout filename UUID. Treat this as a
  diagnostic/human-visible check only; production harvest still reads rollout
  JSONL.
- **Resume:** `codex resume <id>` / `codex resume --last` / `/resume` in-TUI. The
  id is the rollout UUID. Native resume is our **crash-recovery fallback**.
- **`CODEX_HOME`** relocates the whole home (config + `sessions/`), so per-account
  isolation (already wired via `opts.configDir`) moves the rollout files too.
- **Submit key:** VSCode terminal injection is paste-like to Codex. Plain Enter
  (`\r`) and kitty Enter (`\u001b[13u`) both land as newlines in the composer.
  The verified automation path is to launch Codex with process-local config
  overrides: `-c disable_paste_burst=true`,
  `-c 'tui.keymap.composer.submit="tab"'`, and
  `-c 'tui.keymap.composer.queue="ctrl-q"'`, then submit with
  `sendSequence("\t")`.

## Architecture (canonical — shared by all three CLIs)

CLI-agnostic core in `src/adapters/interactive/`; each CLI supplies a **profile**.

```
ORCHESTRATOR (extension host)              TERMINAL (codex TUI — human-visible)
─────────────────────────────             ─────────────────────────────────────
1. write inbox/turn-N.md  ───────┐
2. sendText("Read inbox/turn-N.md└──────►  agent at prompt receives the ping
   and follow it", false)              agent reads inbox file (its own tools)
   + sendSequence(submitSequence)      agent works…  ◄── user may watch / take over
3. FileSystemWatcher waits  ◄──────────── agent writes outbox/turn-N.json on stop
4. read+parse outbox → TurnResult
5. SessionHarvester reads newest    ◄──── codex appends rollout-*.jsonl itself
   rollout-*.jsonl → sessionId+usage
   (CLI fallback: ask agent to write session-info.json)
6. decide next turn:
   · pause  = withhold next ping
   · resume = write inbox/turn-(N+1) + ping
──────────────────────── SAD PATH ────────────────────────
· timeout: no outbox within T  → status 'timeout'
· poll process group / recursive descendants: no codex → status 'crashed'
· onDidCloseTerminal / exitStatus → terminal died
```

### Components

1. **`TerminalSession`** — wraps `vscode.window.createTerminal({ name, cwd, env })`
   running the interactive launch argv. Captures shell PID via `terminal.processId`.
   Owns disposal + `onDidCloseTerminal`.
2. **`Mailbox`** — per-run dir `<cwd>/.skynet/<workerId>/{inbox,outbox}/`. Writes
   `inbox/turn-N.md`; resolves the turn by **polling** `outbox/turn-N.json` (no
   `vscode.FileSystemWatcher`). (`workerId` in the path is the only multi-worker
   affordance in v1.) On first run, ensure `.skynet/` is in the repo `.gitignore`
   (append if absent) so the mailbox never shows in `git status`. `dispose()`
   removes the `<workerId>` dir. The protocol teaches tmp+rename; the read is a
   **poll loop (every ~500ms) with the same timeout as the turn** — it is the
   only detection mechanism, and it doubles as the parse-error retry when the
   agent writes directly or the poll sees a file mid-write: on `ENOENT` or a
   JSON parse error it keeps polling until the file is valid or the turn times
   out. *(ponytail: `terminal-probe.test.ts` proved a plain poll loop end-to-end
   for both codex and agy-ultra; a `FileSystemWatcher` would still need this same
   poll as its parse-retry fallback, so it buys nothing — one mechanism, not two.
   Poll interval is a tuning knob, not load-bearing.)*
3. **`Doorbell`** — `terminal.show(false)` → `sendText(pingLine, false)` →
   `commands.executeCommand("workbench.action.terminal.sendSequence", { text: profile.submitSequence })`.
   The ping is tiny (`Read .skynet/<id>/inbox/turn-N.md and follow it.`) so it
   dodges large-paste corruption.
4. **Protocol bootstrap** — the target `cwd` is often a real project that
   already has its own `profile.instructionFile` (e.g. a real `AGENTS.md` with
   project-specific instructions the CLI reads on every launch, ours or not).
   **Never overwrite it.** Read the existing content (empty string if the file
   doesn't exist), and if it does not already contain the
   `<!-- skynet-interactive:BEGIN -->` marker, **append** the mailbox protocol
   (below) wrapped in `<!-- skynet-interactive:BEGIN -->` / `<!-- skynet-interactive:END -->`
   markers before launch. `dispose()` strips that marker block back out,
   restoring the file to its pre-session content. This is idempotent: a
   leftover marker block from a crashed prior session is replaced, not
   duplicated.
5. **`SessionHarvester`** — locates the newest `rollout-*.jsonl` under
   `profile.sessionDir(configDir)`, parses `session_meta` + latest `token_count`
   into `{ sessionId, usage, rateLimits? }`. Read on each turn and at dispose.
6. **Optional `SessionInfoProbe`** — for CLIs without a useful transcript, sends a
   tiny prompt asking the agent to write `outbox/session-info.json` with stable
   fields such as `conversationId`, `model`, `workspace`, and `artifactDirectory`.
   Codex does not need this for production because rollout JSONL is authoritative.
7. **`InteractiveSession`** (orchestrator) — the state machine driving turns.

### Per-CLI profile (the seam the skeletons fill)

```ts
interface InteractiveCliProfile {
  id: "codex" | "claude" | "agy";
  launchArgv(opts: InteractiveOpts): string[];        // interactive TUI launch
  configEnv(configDir?: string): Record<string, string>; // CODEX_HOME / CLAUDE_CONFIG_DIR / HOME
  instructionFile: string;                             // "AGENTS.md" | "CLAUDE.md" | ?
  submitSequence: string;                              // Codex uses "\t" with submit bound to Tab
  sessionDir(configDir?: string): string;              // absolute path; no "~" shorthand
  harvest(sessionFileText: string): { sessionId?: string; usage?: WorkerUsage; rateLimits?: unknown };
  sessionInfoPrompt?(outboxPath: string): string;       // fallback when harvest() cannot provide session id
}
```

**Codex profile (fully specified):**

```ts
const codexInteractive: InteractiveCliProfile = {
  id: "codex",
  launchArgv: (o) => ["-C", o.cwd, ...(o.model ? ["-m", o.model] : []),
                      "-s", o.sandbox ?? "workspace-write", "-a", "never",
                      "-c", "disable_paste_burst=true",
                      "-c", 'tui.keymap.composer.submit="tab"',
                      "-c", 'tui.keymap.composer.queue="ctrl-q"'],
  configEnv: (dir) => dir ? { CODEX_HOME: dir } : {},
  instructionFile: "AGENTS.md",
  submitSequence: "\t",                                // probe-verified VSCode submit path
  sessionDir: (dir) => dir ? path.join(dir, "sessions")
                           : path.join(os.homedir(), ".codex", "sessions"),
                           // recurse YYYY/MM/DD, newest rollout-*.jsonl
  harvest: (text) => parseCodexRollout(text),          // session_meta.id + token_count.info
};
```

## Public shape

```ts
// src/adapters/interactive/types.ts
interface InteractiveOpts {
  cwd: string;
  workerId: string;
  model?: string;
  configDir?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  turnTimeoutMs?: number;   // default 300_000
  readyTimeoutMs?: number;  // default 30_000 (turn-1 readiness probe)
}

// TurnResult is an interactive-private per-turn state. WorkerUsage/ErrorClass are shared.
type TurnResult =
  | { status: "paused";  summary: string }                                  // simple JSON
  | { status: "done";    summary: string; usage?: WorkerUsage; filesTouched?: string[] } // rich
  | { status: "error";   reason: string; errorClass?: ErrorClass }
  | { status: "timeout" }
  | { status: "crashed" };

interface InteractiveSession extends AsyncIterable<WorkerEvent> {
  send(prompt: string): Promise<TurnResult>;   // write inbox + doorbell; resolve on outbox / timeout / crash
  readonly sessionId: Promise<string | undefined>;  // from rollout harvest or CLI fallback
  dispose(): Promise<void>;                     // strip instruction-file marker block,
                                                 // remove mailbox dir, kill terminal (async cleanup)
}
```

**Integration seam.** Interactive mode is a *second run mode on the existing
adapter*, not a parallel API. `AgentAdapter` gains an optional method; the
standalone `startInteractive(profile, opts)` is the shared core the codex adapter
delegates to.

```ts
interface AgentAdapter {
  readonly id: "codex" | "claude" | "agy";
  run(opts: RunOpts): WorkerRun;                                  // existing one-shot exec
  runInteractive?(opts: InteractiveOpts): Promise<InteractiveSession>; // new; delegates to startInteractive(codexInteractive, opts)
}
```

After a turn resolves `done`, the session is complete: further `send()` calls
**reject** (`session already completed`) and `dispose()` is the only valid next
call. The terminal stays open for inspection / human takeover until `dispose()`;
interactive mode does not auto-kill it on `done`.

`TurnResult` maps back to the existing `WorkerResult` only at the final adapter
boundary: `done → success`, `error → failed`, `timeout → failed` with
`errorClass:"transport"`, `crashed → failed` with `errorClass:"terminal"`.
`paused` is not a `WorkerResult`; it keeps the same `InteractiveSession` open.
Mode selection is orchestrator/UI policy and out of scope for this US; the
adapter supports one-shot `run()` and interactive `runInteractive()` concurrently.

`pause`/`resume` is orchestrator-side: to pause, do not call `send` again; to
resume, call `send` with the next prompt. The `events` async-iterable emits a
sparse stream for the panel (`started`, and one `message` per turn carrying the
outbox `summary`); `usage` events are emitted from the harvest when present and
also copied onto the resolving `TurnResult`. `send()` is the active driver; the
iterator is passive observation, single-consumer like `WorkerRun`, and completes
on `done` / `error` / `timeout` / `crashed` / `dispose()`. *(ponytail: no custom
backpressure in v1; event volume is one or two events per turn.)*

## Protocol contract (taught via the instruction file)

> For each `inbox/turn-N.md` I give you: do the work it asks, then **write
> `outbox/turn-N.json` before you stop**, matching the same `N`:
> - Pausing / need the next instruction → `{ "status": "paused", "summary": "<what you did>" }`
> - Whole task complete → `{ "status": "done", "summary": "...", "filesTouched": ["..."] }`
> - Unrecoverable error → `{ "status": "error", "reason": "..." }`
>
> Never delete inbox files. Write the outbox file in a **single operation** as the
> **last action** of a turn (write `turn-N.json.tmp`, then rename to `turn-N.json`)
> so the orchestrator rarely sees a half-written file. The mailbox retry remains
> mandatory because the agent may ignore this instruction.

The outbox **existence** is the turn boundary; its `status` decides the next move.
For Codex, usage/session-id never come from the agent — they come from the rollout
harvest. For CLIs without rollout-equivalent metadata, `session-info.json` is an
explicit degraded fallback.

## Readiness handshake & sad path

- **Readiness:** after launch we cannot read the terminal, so turn-1's ping is the
  readiness probe. If no `outbox/turn-1.json` appears within `readyTimeoutMs`
  (default 30s), re-send the ping once before declaring failure (mitigates the
  documented sendText startup race). A short fixed pre-ping delay (~1.5s) reduces
  the race further. *(ponytail: delay is a tuning knob, not load-bearing.)*
- **Turn timeout** (`turnTimeoutMs`, default 5 min): no outbox → `timeout`.
- **Crash:** poll the terminal process group (`pgrep -g <pgid>`) or recursively
  walk descendants of `terminal.processId` on macOS/Linux every ~3s; no `codex`
  descendant while the turn is open → `crashed`. This is best-effort; terminal
  close and turn timeout are still the hard signals.
  *(ponytail: Windows child-PID polling is TBD; macOS/Linux only in v1.)*
- **Terminal death:** `onDidCloseTerminal` / `exitStatus` → `crashed`.
- On `timeout`/`crashed`, the orchestrator may attempt `codex resume <sessionId>`
  (recovery is **out of scope for v1** — we surface the status; recovery is a later US).

## Error classification

Reuse the existing pure `classifyError(text)` (`limit`/`transport`/`terminal`).
Inputs available to it in interactive mode: the agent-written `error.reason`, plus
any stderr from terminal close. *(ponytail: a real 429 mid-TUI may kill the session
before the agent writes `error.json`; then we report `crashed`, and a later
fallback US classifies from the rollout/last-known state.)*

## Proof of function (acceptance gate)

Abstract the terminal + clock behind a `TerminalTransport` interface so the core is
testable without a real CLI.

- **turn cycle** *(fake transport, fast):* `send()` → fake writes `outbox/turn-N.json`
  → assert `TurnResult` for each of `paused` / `done` (with usage from a fake
  rollout) / `error`.
- **timeout** *(fake, fast):* fake never writes outbox → `status:'timeout'` after `turnTimeoutMs`.
- **partial outbox** *(fake, fast):* fake writes invalid JSON then valid → reader
  retries and resolves on the valid content, not the half-written one.
- **crash** *(fake, fast):* fake reports no child PID → `status:'crashed'`.
- **rollout parser** *(pure, fast):* `parseCodexRollout(sample)` extracts `sessionId`
  from `session_meta`, usage from `token_count.info.total_token_usage`, and
  optional `rate_limits`, using a real sample JSONL captured from `codex`.
- **doorbell** *(pure, fast):* asserts the exact `sendText(ping,false)` +
  `sendSequence("\t")` calls.
- **submit-key gate** *(manual, pre-plan):* **DONE** — `src/test/terminal-probe.test.ts`
  (`TERMINAL_PROBE=1`, run 2026-07-01) proves Codex launched with the
  process-local keymap/paste-burst overrides submits via
  `sendSequence("\t")` in a real VSCode integrated terminal.
- **slash-status diagnostic** *(manual, non-production):* **DONE** — the same
  probe run sends `/status`, copies the terminal selection, and asserts the raw
  text contains session/model/sandbox/approval/account/cwd hints. Proves the
  human-visible status surface; does not replace rollout harvesting.
- **session-info fallback** *(manual/CLI-specific):* **N/A for codex** (rollout
  harvest is authoritative); the same probe mechanism is proven for agy-ultra,
  which needs the fallback.
- **integration** *(real codex, slow, uses quota):* the probe proves the
  *mechanism* (mailbox + doorbell + pause/resume/done) against a real CLI, but
  drives it with probe-local helpers, not the production `InteractiveSession`
  code. A remaining task: an integration test that calls
  `startInteractive(codexInteractive, opts)` directly, `send()`s two turns, and
  asserts outbox-derived `TurnResult`s + harvested usage from the real rollout
  file + a live human can still type in the terminal.

## Out of scope (v1)

- Multi-worker fleet / scheduler (only `workerId` path naming is reserved).
- claude / agy interactive (their skeleton specs; same frame, different profile).
- Automated crash/timeout **recovery** via `codex resume` (later US).
- Windows child-PID polling.
- Webview panel rework for the sparse interactive event stream (smoke log only).
- Replacing `codex exec --json` (it stays for one-shot tasks).
