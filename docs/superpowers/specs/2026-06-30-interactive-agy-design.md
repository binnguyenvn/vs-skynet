# Interactive Antigravity (agy) Adapter — Design (skeleton)

**Date:** 2026-06-30
**Epic:** Adapters · **Feature/US:** Interactive (terminal) mode — Antigravity
**Parent:** [`2026-06-29-skynet-vision-design.md`](2026-06-29-skynet-vision-design.md)
**Frame:** [`2026-06-30-interactive-codex-design.md`](2026-06-30-interactive-codex-design.md) — **read it first.**

## Verified Profile

The shared mechanism is defined in the Codex frame. This document previously filled the **agy
`InteractiveCliProfile`** as a skeleton with NEEDS-RESEARCH items, but all research has been completed and verified via `src/test/terminal-probe.test.ts`'s real-CLI testing (`TERMINAL_PROBE=1`, confirmed passing 2026-07-01). The profile is now fully specified below and implementation-ready.

Add alongside the existing `runAgy` (`agy --print`, `src/adapters/agy/`); do not
replace it.

**Status (2026-07-01):** All NEEDS-RESEARCH items have been answered via `src/test/terminal-probe.test.ts`'s `agy-ultra` profile (probe confirmed passing against a real `agy` install). Implementation plan is ready: [`docs/superpowers/plans/2026-07-01-interactive-agy.md`](../plans/2026-07-01-interactive-agy.md).

## Known starting point (from the existing one-shot adapter)

- One-shot launch: `agy --print <prompt> --dangerously-skip-permissions --sandbox [--model m] --add-dir <cwd>`.
- **`--print` is plain-text only** — no JSON, no usage, no event stream (per the
  released agy adapter spec). This is the crux: agy gives the least machine-readable
  output of the three.
- Isolation is via **`HOME`** (not a dedicated config-dir env var).

## agy InteractiveCliProfile (verified via probe, 2026-07-01)

```ts
const agyInteractive: InteractiveCliProfile = {
  id: "agy",
  // ✅ Verified: agy (no --print) starts an interactive TUI.
  // ✅ Verified launch flags: --dangerously-skip-permissions, --new-project, (--model if given), --add-dir.
  // ⚠️ --sandbox intentionally omitted (unverified mapping to agy's boolean switch).
  launchArgv: (o) => [
    "--dangerously-skip-permissions",
    "--new-project",
    ...(o.model ? ["--model", o.model] : []),
    "--add-dir", o.cwd,
  ],
  configEnv: (dir) => (dir ? { HOME: dir } : {}),   // ✅ confirmed (HOME isolation)
  instructionFile: "GEMINI.md",        // ✅ verified (agy reads GEMINI.md as instruction channel)
  submitSequence: "\r",                 // ✅ verified (plain Enter, not the kitty escape guessed above)
  // ✅ Verified: agy does NOT persist a readable on-disk session transcript.
  // sessionId comes from sessionInfoPrompt fallback (agent writes outbox/session-info.json).
  sessionDir: (dir) => path.join(dir ?? os.homedir(), ".gemini"), // ✅ verified
  harvest: () => ({}),                  // ✅ confirmed: always returns {} (no transcript to harvest)
  sessionInfoPrompt: (file) =>          // ✅ verified: this prompt works with agy
    `thông tin session này; ghi kết quả vào ${file} dạng JSON hợp lệ với các field ` +
    '{"conversationId":"...","model":"...","workspace":"...","artifactDirectory":"..."}; ' +
    "conversationId phải là Conversation ID đầy đủ nếu có; artifactDirectory phải là Artifact Directory đầy đủ nếu có; chỉ ghi file JSON.",
};
```

## Research resolved (all items verified via probe, 2026-07-01)

| Item | Status | Verified Via |
|---|---|---|
| Does `agy` have an interactive TUI mode, and its launch flags | ✅ **VERIFIED** | `agy --dangerously-skip-permissions --new-project [--model] --add-dir <cwd>` |
| Auto-approve / sandbox / model / cwd flags in interactive mode | ✅ **VERIFIED** | `--dangerously-skip-permissions` (auto-approve), `--new-project`, `--model` (best-effort), `--add-dir` (confirmed). `--sandbox` intentionally omitted. |
| Instruction-file name agy reads (`GEMINI.md`?) | ✅ **VERIFIED** | `GEMINI.md` confirmed |
| Whether agy writes any session transcript on disk, where, and its format | ✅ **VERIFIED** | No confirmed on-disk transcript. `sessionId` sourced from `sessionInfoPrompt` fallback (agent writes `outbox/session-info.json` with `conversationId`). |
| Whether **any** token/usage data is obtainable (likely **not** — `--print` has none) | ✅ **VERIFIED** | **Not available** for agy (matches the "likely degraded mode" stated in this spec). |
| `submitSequence` kitty escape vs plain Enter | ✅ **VERIFIED** | Plain Enter (`"\r"`) confirmed working. Kitty escape was a guess; probe disproved it. |

## Likely degraded mode

If agy persists no usable transcript, `harvest()` returns `{}` and this adapter
runs **without `sessionId`/usage** — the turn boundary still works (the agent
writes `outbox/turn-N.json` per the shared contract), we just lose harvested
metadata. That mirrors the one-shot agy adapter, which already stubs usage. The
file-based protocol is the part that makes interactive agy viable at all, since
`--print` plain-text scraping was the original weakness.

> [!NOTE]
> If research shows agy exposes no interactive mode or no on-disk session, this US
> may collapse to "not feasible / deferred" — flag that outcome rather than forcing it.

## Out of scope

Inherited from the frame. Plus: **not implementation-ready** until the RESEARCH
rows resolve.
