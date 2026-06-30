# Interactive Claude Adapter — Design (skeleton)

**Date:** 2026-06-30
**Epic:** Adapters · **Feature/US:** Interactive (terminal) mode — Claude
**Parent:** [`2026-06-29-skynet-vision-design.md`](2026-06-29-skynet-vision-design.md)
**Frame:** [`2026-06-30-interactive-codex-design.md`](2026-06-30-interactive-codex-design.md) — **read it first.**

## Scope of this skeleton

The mechanism (mailbox + doorbell + file-based turn boundary, `SessionHarvester`,
sad-path state machine, `InteractiveSession`/`TurnResult` shapes, proof strategy)
is **defined once in the Codex frame** and shared verbatim. This document only
fills the **Claude `InteractiveCliProfile`** and flags what must be verified
against the real CLI before a plan is written.

Add alongside the existing `runClaude` (`claude -p … --output-format stream-json`,
`src/adapters/claude/`); do not replace it.

## Claude profile (deltas vs the frame)

```ts
const claudeInteractive: InteractiveCliProfile = {
  id: "claude",
  // NEEDS-VERIFY: exact auto-approve flag for INTERACTIVE mode.
  //   one-shot uses --permission-mode; interactive likely
  //   --permission-mode bypassPermissions  OR  --dangerously-skip-permissions
  launchArgv: (o) => [
    ...(o.model ? ["--model", o.model] : []),
    "--permission-mode", "bypassPermissions",   // VERIFY
    "--add-dir", o.cwd,
  ],
  // From the existing adapter — confirmed:
  configEnv: (dir) => ({
    ...(dir ? { CLAUDE_CONFIG_DIR: dir } : {}),
    // oauthToken passed via CLAUDE_CODE_OAUTH_TOKEN as today (RunOpts.oauthToken)
  }),
  instructionFile: "CLAUDE.md",                  // confirmed (Claude reads CLAUDE.md)
  submitSequence: "\u001b[13u",                  // Ink TUI = kitty protocol; same knob as codex
  // NEEDS-VERIFY: transcript path + slug rule + usage field names.
  //   believed ~/.claude/projects/<cwd-slug>/<sessionId>.jsonl
  //   (relocated under CLAUDE_CONFIG_DIR when set)
  sessionDir: (dir) => dir ? path.join(dir, "projects")
                           : path.join(os.homedir(), ".claude", "projects"),
  harvest: (text) => parseClaudeTranscript(text), // sessionId + usage (incl. cache tokens + costUsd)
};
```

## What must be verified before planning

| Item | Status |
|---|---|
| Interactive auto-approve flag (`bypassPermissions` vs `--dangerously-skip-permissions`) | **VERIFY** |
| Transcript file path + cwd→slug rule, and whether it follows `CLAUDE_CONFIG_DIR` | **VERIFY** |
| Transcript JSONL schema: where `sessionId`, per-turn `usage` (input/output/cache), and `costUsd` live | **VERIFY** |
| Whether transcript is written **incrementally** (frame assumes yes) | **VERIFY** |
| Resume command (`claude --resume <id>` / `claude -c`) for crash recovery | **VERIFY (later US)** |
| `submitSequence` `\u001b[13u` vs `\r` in VSCode terminal | **TEST (shared knob)** |

## Advantage over codex

Claude is the richest of the three for harvesting: its transcript already carries
**cost (`costUsd`) and cache-token usage**, so `harvest()` can populate
`WorkerUsage` more completely than codex's `token_count` (no cost field). Confirm
field names during the verify pass.

## Out of scope

Same as the frame, plus: this skeleton is **not implementation-ready** until the
VERIFY rows above are resolved. Everything else (multi-worker, recovery, Windows
PID polling, panel rework) is inherited from the frame's Out-of-scope.
