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
  through files, never screen scraping.**
- **No `node-pty`.** Native ABI must match VSCode's Electron, officially
  unsupported, breaks on VSCode updates. → Use VSCode's own `createTerminal`.
- **Session metadata is read from the CLI's own rollout file, not the screen** —
  accurate usage/session-id without trusting agent self-report.

## Verified ground truth (real CLI)

`codex` (Rust/ratatui TUI). Sources: developers.openai.com/codex, github.com/openai/codex.

- **Launch interactive:** `codex -C <cwd> -m <model> -s workspace-write -a never`
  (or `--dangerously-bypass-approvals-and-sandbox` / `--yolo` to never block on
  approvals). `codex exec` is the non-interactive path we already use. Flags are
  global (shared by `codex`, `exec`, `resume`).
  > [!WARNING]
  > **NEEDS-VERIFY** — confirm `-a never` means *auto-approve within sandbox, never
  > prompt* (the intent) and not *deny everything*. If it blocks, fall back to
  > `--yolo`. The slow integration gate must check the agent can act without a
  > stuck approval prompt.
- **Session rollout file:** `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`
  (default `~/.codex`). JSONL of `RolloutLine` envelopes `{ "type", "payload" }`,
  **written incrementally** during the session. Relevant lines:
  - `session_meta` → conversation/session **id**, cwd, cli version, git info.
  - `event_msg` with `payload.type === "token_count"` → **cumulative** usage:
    `input`, `cached_input` (naming per ccusage/codex-trace parsers), `output`,
    `reasoning`, `total`. Per-turn = current − previous.
- **Resume:** `codex resume <id>` / `codex resume --last` / `/resume` in-TUI. The
  id is the rollout UUID. Native resume is our **crash-recovery fallback**.
- **`CODEX_HOME`** relocates the whole home (config + `sessions/`), so per-account
  isolation (already wired via `opts.configDir`) moves the rollout files too.
- **Submit key:** Codex negotiates the **kitty keyboard protocol**, so an injected
  raw `\r` (0x0D) likely will **not** submit — send the kitty-encoded Enter
  `\u001b[13u` (CSI `13u`). `Ctrl+J` (`\n`) inserts a newline.
  > [!WARNING]
  > **BLOCKING NEEDS-VERIFY before planning** — the kitty negotiation is confirmed;
  > the exact "raw `\r` fails / `\u001b[13u` works in VSCode's xterm.js terminal"
  > is inferred. Verification: launch `codex` in a VSCode integrated terminal,
  > call `sendText("hello", false)` then `sendSequence("\u001b[13u")`, and confirm
  > the prompt submits. If it fails, test `"\r"`. Keep `submitSequence` a config
  > knob either way.

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
   `inbox/turn-N.md`; a `vscode.FileSystemWatcher` on `outbox/turn-N.json` resolves
   the turn. (`workerId` in the path is the only multi-worker affordance in v1.)
   On first run, ensure `.skynet/` is in the repo `.gitignore` (append if absent)
   so the mailbox never shows in `git status`. `dispose()` removes the `<workerId>`
   dir. The protocol teaches tmp+rename; the retry is the actual safety net when
   the agent writes directly or the watcher sees a file mid-write. On a JSON parse
   error it **retries the read over a short window (~500ms)** until the file is
   valid or the turn times out.
   *(ponytail: retry window is a tuning knob, not load-bearing.)*
3. **`Doorbell`** — `terminal.show(false)` → `sendText(pingLine, false)` →
   `commands.executeCommand("workbench.action.terminal.sendSequence", { text: profile.submitSequence })`.
   The ping is tiny (`Read .skynet/<id>/inbox/turn-N.md and follow it.`) so it
   dodges large-paste corruption.
4. **Protocol bootstrap** — write the CLI's instruction file (`profile.instructionFile`,
   Codex = `AGENTS.md`) into `cwd` teaching the contract (below) before launch.
5. **`SessionHarvester`** — locates the newest `rollout-*.jsonl` under
   `profile.sessionDir(configDir)`, parses `session_meta` + latest `token_count`
   into `{ sessionId, usage }`. Read on each turn and at dispose.
6. **`InteractiveSession`** (orchestrator) — the state machine driving turns.

### Per-CLI profile (the seam the skeletons fill)

```ts
interface InteractiveCliProfile {
  id: "codex" | "claude" | "agy";
  launchArgv(opts: InteractiveOpts): string[];        // interactive TUI launch
  configEnv(configDir?: string): Record<string, string>; // CODEX_HOME / CLAUDE_CONFIG_DIR / HOME
  instructionFile: string;                             // "AGENTS.md" | "CLAUDE.md" | ?
  submitSequence: string;                              // "\u001b[13u" (kitty) | "\r"
  sessionDir(configDir?: string): string;              // absolute path; no "~" shorthand
  harvest(sessionFileText: string): { sessionId?: string; usage?: WorkerUsage };
}
```

**Codex profile (fully specified):**

```ts
const codexInteractive: InteractiveCliProfile = {
  id: "codex",
  launchArgv: (o) => ["-C", o.cwd, ...(o.model ? ["-m", o.model] : []),
                      "-s", o.sandbox ?? "workspace-write", "-a", "never"],
  configEnv: (dir) => dir ? { CODEX_HOME: dir } : {},
  instructionFile: "AGENTS.md",
  submitSequence: "\u001b[13u",                        // kitty Enter; knob, test vs "\r"
  sessionDir: (dir) => dir ? path.join(dir, "sessions")
                           : path.join(os.homedir(), ".codex", "sessions"),
                           // recurse YYYY/MM/DD, newest rollout-*.jsonl
  harvest: (text) => parseCodexRollout(text),          // session_meta.id + last token_count
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
  readonly sessionId: Promise<string | undefined>;  // from rollout harvest
  dispose(): void;                              // kill terminal; final harvest
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
Usage/session-id never come from the agent — they come from the rollout harvest.

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
  from `session_meta` and cumulative `usage` from the last `token_count`, using a
  real sample JSONL captured from `codex`.
- **doorbell** *(pure, fast):* asserts the exact `sendText(ping,false)` +
  `sendSequence("\u001b[13u")` calls.
- **submit-key gate** *(manual, pre-plan):* in a real VSCode integrated terminal,
  prove `sendText("hello", false)` + `sendSequence(profile.submitSequence)`
  submits the prompt. If kitty Enter fails, switch the profile knob to `"\r"`.
- **integration** *(real codex, slow, uses quota):* launch interactive, `send` two
  turns, assert outbox files + harvested usage + a live human can still type.

## Out of scope (v1)

- Multi-worker fleet / scheduler (only `workerId` path naming is reserved).
- claude / agy interactive (their skeleton specs; same frame, different profile).
- Automated crash/timeout **recovery** via `codex resume` (later US).
- Windows child-PID polling.
- Webview panel rework for the sparse interactive event stream (smoke log only).
- Replacing `codex exec --json` (it stays for one-shot tasks).
