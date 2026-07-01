# Interactive Claude Adapter — Design (groomed)

**Date:** 2026-06-30 · **Groomed:** 2026-07-01
**Epic:** Adapters · **Feature/US:** Interactive (terminal) mode — Claude
**Parent:** [`2026-06-29-skynet-vision-design.md`](2026-06-29-skynet-vision-design.md)
**Frame:** [`2026-06-30-interactive-codex-design.md`](2026-06-30-interactive-codex-design.md) — **read it first.**

## Scope of this skeleton

The mechanism (mailbox + doorbell + file-based turn boundary, `SessionHarvester`,
sad-path state machine, `InteractiveSession`/`TurnResult` shapes, proof strategy)
is **defined once in the Codex frame** and shared verbatim. This document only
fills the **Claude `InteractiveCliProfile`** and records what was verified
against the real CLI before a plan is written.

Add alongside the existing `runClaude` (`claude -p … --output-format stream-json`,
`src/adapters/claude/`); do not replace it.

## Sources

- `claude --help` (installed `claude` 2.1.197).
- **This session's own live transcript** — Claude Code CLI writing this very
  document is itself a running `claude` session, so its own on-disk JSONL
  under `$CLAUDE_CONFIG_DIR/projects/<slug>/<sessionId>.jsonl` (config dir
  `~/.agents/cc-tu`) is real, unstaged production evidence for the transcript
  path, slug rule, incremental-write behavior, and JSONL schema — no synthetic
  fixture needed.
- `src/test/terminal-probe.test.ts` (`TERMINAL_PROBE=1`), extended with a
  `claude` profile and run against a real `claude` install via
  `vscode-test`'s Extension Development Host.
- Direct pty probes (`expect`) launching bare `claude --permission-mode
  bypassPermissions --add-dir <cwd>` against both a fresh `CLAUDE_CONFIG_DIR`
  and the already-onboarded `~/.agents/cc-tu`, to isolate onboarding
  screens from the mailbox mechanics.

## Claude profile (deltas vs the frame)

```ts
const claudeInteractive: InteractiveCliProfile = {
  id: "claude",
  launchArgv: (o) => [
    ...(o.model ? ["--model", o.model] : []),
    "--permission-mode", "bypassPermissions",   // VERIFIED (see below)
    "--add-dir", o.cwd,
  ],
  configEnv: (dir) => ({
    ...(dir ? { CLAUDE_CONFIG_DIR: dir } : {}),
    // CLAUDE_CODE_OAUTH_TOKEN passed via RunOpts.oauthToken, same as the
    // existing one-shot adapter — NOT ANTHROPIC_API_KEY (see gotcha below).
  }),
  instructionFile: "CLAUDE.md",                  // confirmed
  submitSequence: "\r",                           // VERIFIED — plain Enter, not kitty escape
  sessionDir: (dir) => dir ? path.join(dir, "projects")
                           : path.join(os.homedir(), ".claude", "projects"),
  harvest: (text) => parseClaudeTranscript(text), // sessionId + usage; NO cost (see below)
};
```

## What was verified

| Item | Finding |
|---|---|
| Interactive auto-approve flag | **VERIFIED** — `--permission-mode bypassPermissions` (matches the existing one-shot adapter). `claude --help` lists it as a valid `--permission-mode` choice, and this very session's own transcript carries a live `{"type":"permission-mode","permissionMode":"bypassPermissions"}` record for exactly this flag under CLI 2.1.197. `--dangerously-skip-permissions` is a separate, blunter flag; no reason to use it over the existing pattern. |
| Transcript path + slug rule | **VERIFIED** — `$CLAUDE_CONFIG_DIR/projects/<slug>/<sessionId>.jsonl` (falls back to `~/.claude/projects/...` when `CLAUDE_CONFIG_DIR` is unset). Slug = absolute cwd with every `/` (including the leading one) replaced by `-`, e.g. `/Users/x/y` → `-Users-x-y`. Confirmed directly: this repo's cwd maps to `~/.agents/cc-tu/projects/-Users-binn-Projects-extension-factory-skynet-harness-active/`, which holds this session's own `.jsonl`. |
| Written incrementally | **VERIFIED** — this session's own transcript file grew from 63 to 66 lines, then to 78+, over the course of ordinary tool calls in this conversation. |
| JSONL schema: `sessionId` | **VERIFIED, simpler than assumed** — `sessionId` (plus `cwd`, `version`, `timestamp`, `gitBranch`) is a top-level field on **every** line regardless of `type`. No dedicated `session_meta`-style line is needed; read it off the newest line. |
| JSONL schema: per-turn usage | **VERIFIED** — lines with `"type":"assistant"` carry `message.usage`: `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens` (plus `cache_creation.{ephemeral_1h_input_tokens,ephemeral_5m_input_tokens}` and `service_tier`). |
| JSONL schema: cost | **VERIFIED ABSENT — corrects the original doc.** Grepped every key across every transcript file in `~/.agents/cc-tu/projects/**/*.jsonl`: no key containing `cost` exists anywhere in the on-disk transcript. `costUsd`/`total_cost_usd` **only** appears in the one-shot `-p --output-format stream-json` final `"result"` line (confirmed by `src/test/claude-adapter.integration.test.ts`'s own fixture). Interactive harvest cannot get cost from the transcript. |
| Alternate cost source | **NEW FINDING** — `$CLAUDE_CONFIG_DIR/.claude.json` → `projects["<absolute-cwd>"]` carries `lastCost`, `lastTotalInputTokens`, `lastTotalOutputTokens`, `lastTotalCacheCreationInputTokens`, `lastTotalCacheReadInputTokens`, `lastSessionId`. This is a coarser, end-of-session rollup (updated around `lastGracefulShutdown`, not per turn) — a usable supplementary source if `WorkerUsage.costUsd` is wanted, but not a per-turn substitute for the transcript. |
| Resume command | **VERIFIED** — `-r, --resume [value]` (by session id or interactive picker) and `-c, --continue` (most recent conversation in cwd), confirmed in `claude --help`. |
| `submitSequence` | **VERIFIED** — plain `\r` (Enter), not the kitty `[13u` escape the original skeleton guessed. Confirmed both by direct `expect` pty probes (Enter reliably dismisses the theme/trust/API-key onboarding screens and would land in the composer the same way) and by manual observation of a live `terminal.sendText` + `sendSequence("\r")` round in the VSCode Extension Development Host. |

## Bootstrap gotchas (Claude-specific — the frame and codex/agy don't have these)

Unlike codex/agy, a **cold `CLAUDE_CONFIG_DIR` × cwd combination goes through up
to three blocking interactive screens before the composer is usable at all**.
Each is real, was hit live during probing, and each is skippable by pre-seeding
config files before the interactive launch:

1. **First-run theme picker** ("Choose the text style...") — only on a
   `CLAUDE_CONFIG_DIR` that has never completed onboarding. Skip by pre-seeding
   `$CLAUDE_CONFIG_DIR/settings.json` with `{"theme": "dark"}` and
   `$CLAUDE_CONFIG_DIR/.claude.json` with `"hasCompletedOnboarding": true`.
2. **Workspace trust dialog** ("Quick safety check: is this a project you
   trust?") — keyed to the terminal's actual `cwd` (not `--add-dir`), fires on
   every **new** cwd regardless of how well-onboarded the config dir is.
   Confirmed live against the already-onboarded `~/.agents/cc-tu` config dir
   with a brand-new temp cwd. Skip by pre-seeding
   `.claude.json.projects["<absolute-cwd>"].hasTrustDialogAccepted = true`
   (mirrors the frame's existing CLAUDE.md-marker bootstrap idea — same
   "write the config before launch" shape, applied to a different file).
3. **"Detected a custom API key" prompt** — fires whenever `ANTHROPIC_API_KEY`
   is present in the launch env and hasn't been approved yet for that config
   dir. **Defaults to "2. No (recommended)"** — a bare Enter *declines* the
   key and falls through to a full interactive OAuth login-method picker,
   which cannot be automated headlessly. Decision persists to
   `.claude.json.customApiKeyResponses.{approved,rejected}` keyed by a suffix
   of the key. **Avoid entirely** by not using `ANTHROPIC_API_KEY` for
   interactive launches — use `CLAUDE_CODE_OAUTH_TOKEN` via `configEnv`,
   exactly like the existing one-shot `runClaude` adapter already does.

**Net implication for the plan:** `runInteractive` needs a small bootstrap step
analogous to the frame's CLAUDE.md marker-block bootstrap — before first
launch of a given `(configDir, cwd)` pair, ensure `hasCompletedOnboarding`,
`projects[cwd].hasTrustDialogAccepted`, and (if API-key auth is ever used)
`customApiKeyResponses` are pre-seeded. A config dir that has already been
used for a one-shot `runClaude` call in that same cwd should already satisfy
all three (per-`help` text, `-p`/non-interactive mode skips the trust dialog
outright, and one-shot auth already goes through `CLAUDE_CODE_OAUTH_TOKEN`) —
so in practice this mostly matters for **brand-new accounts/directories** that
have never run any `claude` command before.

## What's still open

| Item | Status |
|---|---|
| Full automated mailbox pause/resume/done cycle against a **pre-seeded, already-authenticated** config dir | **NOT YET RUN.** Every live probe run so far hit one of the three bootstrap screens above (the probe always uses a fresh temp cwd, so the trust dialog fires every time); none completed a full turn. The mailbox/doorbell/poll mechanics themselves are unchanged from the already-proven codex/agy-ultra pattern in `terminal-probe.test.ts` — only the pre-turn bootstrap differs. Re-run `TERMINAL_PROBE=1 npx vscode-test --grep claude` after the profile's `launchCommand` pre-seeds the config dir per the gotchas above. |
| `/status` output shape | **NOT YET CAPTURED** — blocked on the same bootstrap gap; `statusHints` in the probe profile (`model`, `cwd`, `account`) are a guess, not yet confirmed. |

## Advantage over codex

Claude's transcript carries **cache-token usage** (`cache_creation_input_tokens`,
`cache_read_input_tokens`) the same way codex's rollout does, and every line
self-identifies `sessionId` more simply than codex's dedicated `session_meta`
line. **The original "richest for cost" claim was wrong** — the interactive
transcript has no `costUsd`/`total_cost_usd` field at all (that only exists in
one-shot `-p` output). If cost is wanted, `.claude.json`'s per-project
`lastCost` is the only on-disk source, and it's an end-of-session rollup, not
per-turn.

## Out of scope

Same as the frame, plus: this skeleton is **not implementation-ready** until
the "What's still open" rows above are resolved with a passing automated run.
Everything else (multi-worker, recovery, Windows PID polling, panel rework) is
inherited from the frame's Out-of-scope.
