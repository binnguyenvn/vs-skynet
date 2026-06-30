# Interactive Antigravity (agy) Adapter — Design (skeleton)

**Date:** 2026-06-30
**Epic:** Adapters · **Feature/US:** Interactive (terminal) mode — Antigravity
**Parent:** [`2026-06-29-skynet-vision-design.md`](2026-06-29-skynet-vision-design.md)
**Frame:** [`2026-06-30-interactive-codex-design.md`](2026-06-30-interactive-codex-design.md) — **read it first.**

## Scope of this skeleton

The shared mechanism is defined in the Codex frame. This document fills the **agy
`InteractiveCliProfile`** — but agy is the **weakest fit** of the three and most
fields are **NEEDS-RESEARCH**. Do not plan implementation until they resolve.

Add alongside the existing `runAgy` (`agy --print`, `src/adapters/agy/`); do not
replace it.

## Known starting point (from the existing one-shot adapter)

- One-shot launch: `agy --print <prompt> --dangerously-skip-permissions --sandbox [--model m] --add-dir <cwd>`.
- **`--print` is plain-text only** — no JSON, no usage, no event stream (per the
  released agy adapter spec). This is the crux: agy gives the least machine-readable
  output of the three.
- Isolation is via **`HOME`** (not a dedicated config-dir env var).

## agy profile (mostly unverified)

```ts
const agyInteractive: InteractiveCliProfile = {
  id: "agy",
  // NEEDS-RESEARCH: does `agy` (no --print) start an interactive TUI at all?
  //   what flags set model / auto-approve / sandbox / cwd in interactive mode?
  launchArgv: (o) => [
    "--dangerously-skip-permissions", "--sandbox",
    ...(o.model ? ["--model", o.model] : []),
    "--add-dir", o.cwd,
  ],
  configEnv: (dir) => (dir ? { HOME: dir } : {}),   // confirmed (HOME isolation)
  instructionFile: "GEMINI.md",        // NEEDS-RESEARCH (GEMINI.md? AGENTS.md? other?)
  submitSequence: "\u001b[13u",  // LIKELY kitty (Ink/React TUI) — TEST, fall back to "\r"
  // NEEDS-RESEARCH: does agy persist a session transcript on disk, and where?
  //   (~/.gemini/… ? under HOME?) format? any usage at all?
  sessionDir: (dir) => path.join(dir ?? os.homedir(), ".gemini"), // GUESS — verify
  harvest: () => ({}),                  // may be unavailable — see below
};
```

## What must be researched before planning

| Item | Status |
|---|---|
| Does `agy` have an interactive TUI mode, and its launch flags | **RESEARCH** |
| Auto-approve / sandbox / model / cwd flags in interactive mode | **RESEARCH** |
| Instruction-file name agy reads (`GEMINI.md`?) | **RESEARCH** |
| Whether agy writes any session transcript on disk, where, and its format | **RESEARCH** |
| Whether **any** token/usage data is obtainable (likely **not** — `--print` has none) | **RESEARCH** |
| `submitSequence` `\u001b[13u` vs `\r` | **TEST (shared knob)** |

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
