# Adapter Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull the codex/claude/agy adapters behind one `AgentAdapter` interface emitting a normalized `WorkerEvent` stream, and collapse the three byte-identical `classify.ts` copies and three near-identical webview bridges into one each.

**Architecture:** A new `src/adapters/types.ts` holds the CLI-agnostic contract (`WorkerEvent`, `WorkerUsage`, `WorkerResult`, `RunOpts`, `WorkerRun`, `AgentAdapter`, `ErrorClass`). A new `src/adapters/classify.ts` holds the single classifier. Each adapter's `mapXLine` returns `WorkerEvent`(s); each `runX` returns a `WorkerRun` and additionally exports an `AgentAdapter` value. A new `src/adapters/webview-bridge.ts` streams any `AgentAdapter` to the panel. Pure refactor — spawn/JSONL/cancel mechanics are unchanged.

**Tech Stack:** TypeScript, Node (`child_process`, `readline`), Mocha (`suite`/`test`) + `node:assert` via `vscode-test`, esbuild. Spec: [`../specs/2026-06-29-adapter-unification-design.md`](../specs/2026-06-29-adapter-unification-design.md).

## Global Constraints

- **Decision A holds:** adapters carry no fallback/retry logic. This is a pure refactor — no behavior change to spawn args, success/failure gating, or cancel.
- **`RunOpts` split (refines the spec):** the shared `RunOpts` is the *common* contract (`prompt`, `cwd`, `model?`, `configDir?`, `oauthToken?`) — the fields the smoke UI's `TestFields` and the future orchestrator set generically. Each adapter keeps its advanced knobs in `<Cli>RunOpts extends RunOpts`. This sidesteps the `sandbox` type conflict (string union in codex vs boolean in agy) by keeping `sandbox` per-adapter, not in the shared type.
- **Usage mapping:** codex `cached_input_tokens` + claude `cache_read_input_tokens` → `cachedInputTokens`; claude `cache_creation_input_tokens` → `cacheWriteTokens`; codex `reasoning_output_tokens` → `reasoningTokens`; claude `total_cost_usd` → `costUsd`. Fields a provider doesn't report stay `undefined`.
- **`unknown` events** are preserved verbatim (`raw`) by every adapter exactly as today.
- **Tests** use Mocha globals `suite`/`test` + `import * as assert from "assert"`. Run the full suite with `npm test` (its `pretest` compiles + lints). Real-CLI suites stay gated behind `CODEX_E2E` / `CLAUDE_E2E`.
- **Commits** follow repo convention and end with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

---

## US-1: Normalized adapter core (`adapters--events` + `adapters--errors`)

All three adapters emit `WorkerEvent`, expose an `AgentAdapter`, and call one shared `classifyError`. Per-CLI event/usage/result types and the three `classify.ts` copies are deleted.

### Task 1: Shared contract + shared classifier

**Files:**
- Create: `src/adapters/types.ts`
- Create: `src/adapters/classify.ts`
- Test: `src/test/classify.test.ts`

**Interfaces:**
- Produces: `WorkerEvent`, `WorkerUsage`, `WorkerResult`, `RunOpts`, `WorkerRun`, `AgentAdapter`, `ErrorClass` (from `types.ts`); `classifyError(text: string): ErrorClass` (from `classify.ts`).

- [ ] **Step 1: Create the shared contract**

`src/adapters/types.ts`:

```ts
export type ErrorClass = "limit" | "transport" | "terminal";

export type WorkerEvent =
  | { kind: "started"; sessionId: string; model?: string }
  | { kind: "message"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_call"; name: string; input: unknown }
  | ({ kind: "usage" } & WorkerUsage)
  | { kind: "unknown"; raw: unknown };

export interface WorkerUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number; // codex cached_input + claude cache_read (both cache reads)
  cacheWriteTokens?: number;  // claude cache_creation
  reasoningTokens?: number;   // codex reasoning_output
  costUsd?: number;           // claude only
}

export interface WorkerResult {
  status: "success" | "failed" | "cancelled";
  reason?: string;
  errorClass?: ErrorClass;
  usage?: WorkerUsage;
  lastMessage?: string;
}

// Shared, CLI-agnostic run options. Adapters widen this with their own knobs.
export interface RunOpts {
  prompt: string;
  cwd: string;
  model?: string;
  configDir?: string;  // CODEX_HOME / CLAUDE_CONFIG_DIR / HOME
  oauthToken?: string; // claude-only; other adapters ignore it
}

/**
 * Async iterator is single-consumer: create one `for await` loop per run.
 * Concurrent iteration shares one internal event queue and is not supported.
 */
export interface WorkerRun extends AsyncIterable<WorkerEvent> {
  cancel(): void;
  result: Promise<WorkerResult>;
}

export interface AgentAdapter {
  readonly id: "codex" | "claude" | "agy";
  run(opts: RunOpts): WorkerRun;
}
```

- [ ] **Step 2: Write the failing classifier test**

`src/test/classify.test.ts`:

```ts
import * as assert from "assert";
import { classifyError } from "../adapters/classify";

suite("classifyError", () => {
  test("429 rate limit -> limit", () =>
    assert.strictEqual(classifyError("Error: 429 rate limit exceeded"), "limit"));
  test("quota -> limit", () =>
    assert.strictEqual(classifyError("You have exceeded your quota"), "limit"));
  test("ECONNRESET -> transport", () =>
    assert.strictEqual(classifyError("ECONNRESET while connecting"), "transport"));
  test("timeout -> transport", () =>
    assert.strictEqual(classifyError("request timeout"), "transport"));
  test("other -> terminal", () =>
    assert.strictEqual(classifyError("invalid prompt syntax"), "terminal"));
  test("empty -> terminal", () =>
    assert.strictEqual(classifyError(""), "terminal"));
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run compile-tests && npx mocha out/test/classify.test.js`
Expected: FAIL — `Cannot find module '../adapters/classify'`.

- [ ] **Step 4: Create the shared classifier**

`src/adapters/classify.ts`:

```ts
import type { ErrorClass } from "./types";

const LIMIT = /rate.?limit|429|quota|too many requests/i;
const TRANSPORT = /network|econn|etimedout|timeout|socket|dns|enotfound/i;

// ponytail: heuristic patterns inherited from the adapters, unverified against
// real limit/transport output. Refine the regexes on first real capture.
export function classifyError(text: string): ErrorClass {
  if (LIMIT.test(text)) {
    return "limit";
  }
  if (TRANSPORT.test(text)) {
    return "transport";
  }
  return "terminal";
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run compile-tests && npx mocha out/test/classify.test.js`
Expected: PASS — 6 passing.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/types.ts src/adapters/classify.ts src/test/classify.test.ts
git commit -m "feat: shared adapter contract (WorkerEvent) + shared classifier"
```

---

### Task 2: Convert the codex adapter

**Files:**
- Modify: `src/adapters/codex/events.ts` (return `WorkerEvent`, drop per-CLI types)
- Modify: `src/adapters/codex/codex-adapter.ts` (shared types, `../classify`, export `codexAdapter`)
- Delete: `src/adapters/codex/classify.ts`, `src/test/codex-classify.test.ts`
- Modify: `src/test/codex-events.test.ts`, `src/test/codex-adapter.integration.test.ts`

**Interfaces:**
- Consumes: `WorkerEvent`, `WorkerUsage`, `WorkerResult`, `WorkerRun`, `RunOpts`, `AgentAdapter` (Task 1); `classifyError` (Task 1).
- Produces: `mapCodexLine(line: string): WorkerEvent | null`; `runCodex(opts: CodexRunOpts): WorkerRun`; `codexAdapter: AgentAdapter` (`id: "codex"`); `CodexRunOpts extends RunOpts { sandbox? }`.

- [ ] **Step 1: Rewrite the codex event test (failing)**

Replace `src/test/codex-events.test.ts` with:

```ts
import * as assert from "assert";
import { mapCodexLine } from "../adapters/codex/events";

suite("mapCodexLine", () => {
  test("thread.started -> started (sessionId)", () => {
    assert.deepStrictEqual(
      mapCodexLine('{"type":"thread.started","thread_id":"abc"}'),
      { kind: "started", sessionId: "abc" });
  });

  test("agent_message item -> message", () => {
    assert.deepStrictEqual(
      mapCodexLine('{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"pong"}}'),
      { kind: "message", text: "pong" });
  });

  test("turn.completed -> usage (cached + reasoning)", () => {
    assert.deepStrictEqual(
      mapCodexLine('{"type":"turn.completed","usage":{"input_tokens":12,"cached_input_tokens":9,"output_tokens":5,"reasoning_output_tokens":0}}'),
      { kind: "usage", inputTokens: 12, outputTokens: 5, cachedInputTokens: 9, reasoningTokens: 0 });
  });

  test("blank line -> null", () => assert.strictEqual(mapCodexLine("  "), null));

  test("non-JSON stdin notice -> null", () =>
    assert.strictEqual(mapCodexLine("Reading additional input from stdin..."), null));

  test("unknown type -> unknown{raw}", () => {
    assert.deepStrictEqual(mapCodexLine('{"type":"turn.started"}'),
      { kind: "unknown", raw: { type: "turn.started" } });
  });
});
```

- [ ] **Step 2: Run the event test to verify it fails**

Run: `npm run compile-tests && npx mocha out/test/codex-events.test.js`
Expected: FAIL — `started` still has `threadId`; usage still has `reasoningOutputTokens`.

- [ ] **Step 3: Rewrite the codex events mapper**

Replace `src/adapters/codex/events.ts` with:

```ts
import type { WorkerEvent } from "../types";

// Map one codex `exec --json` JSONL line to a WorkerEvent.
// Returns null for blank or non-JSON lines (e.g. the stdin notice).
export function mapCodexLine(line: string): WorkerEvent | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  let obj: any;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }

  switch (obj?.type) {
    case "thread.started":
      return { kind: "started", sessionId: String(obj.thread_id ?? "") };
    case "item.completed":
      if (obj.item?.type === "agent_message") {
        return { kind: "message", text: String(obj.item.text ?? "") };
      }
      return { kind: "unknown", raw: obj };
    case "turn.completed": {
      const u = obj.usage ?? {};
      return {
        kind: "usage",
        inputTokens: u.input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        cachedInputTokens: u.cached_input_tokens ?? 0,
        reasoningTokens: u.reasoning_output_tokens ?? 0,
      };
    }
    default:
      return { kind: "unknown", raw: obj };
  }
}
```

- [ ] **Step 4: Convert the codex adapter to shared types**

In `src/adapters/codex/codex-adapter.ts`:

- Replace the top imports (lines 1-4) with:

```ts
import { spawn } from "node:child_process";
import * as readline from "node:readline";
import { classifyError } from "../classify";
import { mapCodexLine } from "./events";
import type { AgentAdapter, RunOpts, WorkerEvent, WorkerResult, WorkerRun, WorkerUsage } from "../types";
```

- Replace the `RunOpts` interface (lines 6-12) with:

```ts
export interface CodexRunOpts extends RunOpts {
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
}
```

- Delete the `CodexRun` interface (lines 14-21, including its doc comment) — `WorkerRun` from `../types` replaces it.
- Change the signature `export function runCodex(opts: RunOpts): CodexRun {` → `export function runCodex(opts: CodexRunOpts): WorkerRun {`.
- Replace every remaining `CodexEvent` with `WorkerEvent`, `CodexResult` with `WorkerResult`, and `CodexUsage` with `WorkerUsage` (the `usage` variable, `queue`, `resolveNext`, `emit`, `finishIter`, `result` Promise, and `iterator` types).
- At the end of the file, after the `runCodex` function, add:

```ts
export const codexAdapter: AgentAdapter = {
  id: "codex",
  run: (opts) => runCodex(opts),
};
```

- [ ] **Step 5: Delete the duplicated codex classifier + its test**

```bash
git rm src/adapters/codex/classify.ts src/test/codex-classify.test.ts
```

- [ ] **Step 6: Fix the codex integration test import**

In `src/test/codex-adapter.integration.test.ts`:
- Line 6: change `import type { CodexEvent } from "../adapters/codex/events";` → `import type { WorkerEvent } from "../adapters/codex/../types";` — or cleaner: `import type { WorkerEvent } from "../adapters/types";`.
- Line 44: change `const events: CodexEvent[] = [];` → `const events: WorkerEvent[] = [];`.

- [ ] **Step 7: Run the codex tests + full compile**

Run: `npm test`
Expected: PASS — codex event/integration suites green, shared classifier green, no `codex/classify` references; lint + type-check clean.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: codex adapter emits WorkerEvent + exports codexAdapter; use shared classifier"
```

---

### Task 3: Convert the claude adapter

**Files:**
- Modify: `src/adapters/claude/events.ts`
- Modify: `src/adapters/claude/claude-adapter.ts`
- Delete: `src/adapters/claude/classify.ts`, `src/test/claude-classify.test.ts`
- Modify: `src/test/claude-events.test.ts`, `src/test/claude-adapter.integration.test.ts`

**Interfaces:**
- Consumes: shared types + `classifyError` (Task 1).
- Produces: `mapClaudeLine(obj: any): WorkerEvent[]`; `runClaude(opts: ClaudeRunOpts): WorkerRun`; `claudeAdapter: AgentAdapter` (`id: "claude"`); `ClaudeRunOpts extends RunOpts { permissionMode?; allowedTools? }`.

- [ ] **Step 1: Rewrite the claude event test (failing)**

Replace `src/test/claude-events.test.ts` with:

```ts
import * as assert from "assert";
import { mapClaudeLine } from "../adapters/claude/events";

suite("mapClaudeLine", () => {
  test("system/init -> [started] (sessionId + model)", () => {
    assert.deepStrictEqual(
      mapClaudeLine({ type: "system", subtype: "init", session_id: "s1", model: "claude-x" }),
      [{ kind: "started", sessionId: "s1", model: "claude-x" }]
    );
  });

  test("system hook noise -> [unknown]", () => {
    assert.deepStrictEqual(
      mapClaudeLine({ type: "system", subtype: "hook_started", hook_name: "SessionStart" }),
      [{ kind: "unknown", raw: { type: "system", subtype: "hook_started", hook_name: "SessionStart" } }]
    );
  });

  test("assistant fans out: text + thinking + tool_use + usage", () => {
    const obj = {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "pong" },
          { type: "thinking", thinking: "hmm" },
          { type: "tool_use", name: "Bash", input: { cmd: "ls" } },
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 2,
          cache_creation_input_tokens: 1,
          cache_read_input_tokens: 5,
        },
      },
    };
    assert.deepStrictEqual(mapClaudeLine(obj), [
      { kind: "message", text: "pong" },
      { kind: "thinking", text: "hmm" },
      { kind: "tool_call", name: "Bash", input: { cmd: "ls" } },
      { kind: "usage", inputTokens: 10, outputTokens: 2, cachedInputTokens: 5, cacheWriteTokens: 1 },
    ]);
  });

  test("result with usage -> [usage] with cost", () => {
    assert.deepStrictEqual(
      mapClaudeLine({ type: "result", usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 5 }, total_cost_usd: 0.01 }),
      [{ kind: "usage", inputTokens: 10, outputTokens: 2, cachedInputTokens: 5, cacheWriteTokens: 0, costUsd: 0.01 }]
    );
  });
});
```

- [ ] **Step 2: Run the event test to verify it fails**

Run: `npm run compile-tests && npx mocha out/test/claude-events.test.js`
Expected: FAIL — usage still has `cacheCreationInputTokens`/`cacheReadInputTokens`.

- [ ] **Step 3: Rewrite the claude events mapper**

Replace `src/adapters/claude/events.ts` with:

```ts
import type { WorkerEvent, WorkerUsage } from "../types";

function toUsage(u: any): WorkerUsage {
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cachedInputTokens: u?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
  };
}

export function mapClaudeLine(obj: any): WorkerEvent[] {
  switch (obj?.type) {
    case "system":
      if (obj.subtype === "init") {
        return [{ kind: "started", sessionId: String(obj.session_id ?? ""), model: String(obj.model ?? "") }];
      }
      return [{ kind: "unknown", raw: obj }];
    case "assistant": {
      const out: WorkerEvent[] = [];
      for (const b of obj.message?.content ?? []) {
        if (b?.type === "text") {
          out.push({ kind: "message", text: String(b.text ?? "") });
        } else if (b?.type === "thinking") {
          out.push({ kind: "thinking", text: String(b.thinking ?? b.text ?? "") });
        } else if (b?.type === "tool_use") {
          out.push({ kind: "tool_call", name: String(b.name ?? ""), input: b.input });
        } else {
          out.push({ kind: "unknown", raw: b });
        }
      }
      if (obj.message?.usage) {
        out.push({ kind: "usage", ...toUsage(obj.message.usage) });
      }
      return out;
    }
    case "result":
      return obj.usage ? [{ kind: "usage", ...toUsage(obj.usage), costUsd: obj.total_cost_usd }] : [];
    default:
      return [{ kind: "unknown", raw: obj }];
  }
}
```

- [ ] **Step 4: Convert the claude adapter to shared types**

In `src/adapters/claude/claude-adapter.ts`:

- Replace the top imports (lines 3-4) with:

```ts
import { classifyError } from "../classify";
import { mapClaudeLine } from "./events";
import type { AgentAdapter, RunOpts, WorkerEvent, WorkerResult, WorkerRun, WorkerUsage } from "../types";
```

- Replace the `RunOpts` interface (lines 6-14) with (note: `model`, `configDir`, `oauthToken` now come from the shared `RunOpts`):

```ts
export interface ClaudeRunOpts extends RunOpts {
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
  allowedTools?: string[];
}
```

- Delete the `ClaudeRun` interface (lines 16-23, including its doc comment).
- Change `export function runClaude(opts: RunOpts): ClaudeRun {` → `export function runClaude(opts: ClaudeRunOpts): WorkerRun {`.
- Replace every remaining `ClaudeEvent` → `WorkerEvent`, `ClaudeResult` → `WorkerResult`, `ClaudeUsage` → `WorkerUsage`.
- The `classifyError(`${resultText}\n${stderr}`)` call (line 125) is unchanged — it now resolves to `../classify`.
- At the end of the file, after `runClaude`, add:

```ts
export const claudeAdapter: AgentAdapter = {
  id: "claude",
  run: (opts) => runClaude(opts),
};
```

- [ ] **Step 5: Delete the duplicated claude classifier + its test**

```bash
git rm src/adapters/claude/classify.ts src/test/claude-classify.test.ts
```

- [ ] **Step 6: Fix the claude integration test import**

In `src/test/claude-adapter.integration.test.ts`:
- Line 6: change `import type { ClaudeEvent } from "../adapters/claude/events";` → `import type { WorkerEvent } from "../adapters/types";`.
- Lines 46 and 123: change `const events: ClaudeEvent[] = [];` → `const events: WorkerEvent[] = [];`.

- [ ] **Step 7: Run the claude tests + full compile**

Run: `npm test`
Expected: PASS — claude event/integration suites green; shared classifier still the only `classifyError` test.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: claude adapter emits WorkerEvent + exports claudeAdapter; use shared classifier"
```

---

### Task 4: Convert the agy adapter

**Files:**
- Modify: `src/adapters/agy/events.ts`
- Modify: `src/adapters/agy/agy-adapter.ts`
- Delete: `src/adapters/agy/classify.ts`, `src/test/agy-classify.test.ts`
- Modify: `src/test/agy-events.test.ts`, `src/test/agy-adapter.integration.test.ts`

**Interfaces:**
- Consumes: shared types + `classifyError` (Task 1).
- Produces: `mapAgyLine(line: string): WorkerEvent | null`; `runAgy(opts: AgyRunOpts): WorkerRun`; `agyAdapter: AgentAdapter` (`id: "agy"`); `AgyRunOpts extends RunOpts { sandbox?: boolean; skipPermissions? }`.

- [ ] **Step 1: Rewrite the agy event test (failing)**

Replace `src/test/agy-events.test.ts` with:

```ts
import * as assert from "assert";
import { mapAgyLine } from "../adapters/agy/events";

suite("mapAgyLine", () => {
  test("plain text line -> message", () => {
    assert.deepStrictEqual(mapAgyLine("pong"), { kind: "message", text: "pong" });
  });

  test("plain text line is trimmed", () => {
    assert.deepStrictEqual(mapAgyLine("  hello  "), { kind: "message", text: "hello" });
  });

  test("blank line -> null", () => assert.strictEqual(mapAgyLine("   "), null));

  // Forward-compat stub branches (dormant until the SDK sidecar emits JSONL):
  test("JSON thread.started -> started (sessionId)", () => {
    assert.deepStrictEqual(
      mapAgyLine('{"type":"thread.started","thread_id":"abc"}'),
      { kind: "started", sessionId: "abc" });
  });

  test("JSON tool_call -> tool_call (input)", () => {
    assert.deepStrictEqual(
      mapAgyLine('{"type":"tool_call","name":"run_command","args":{"cmd":"ls"}}'),
      { kind: "tool_call", name: "run_command", input: { cmd: "ls" } });
  });

  test("JSON thought -> thinking", () => {
    assert.deepStrictEqual(
      mapAgyLine('{"type":"thought","text":"hmm"}'),
      { kind: "thinking", text: "hmm" });
  });

  test("JSON usage -> usage", () => {
    assert.deepStrictEqual(
      mapAgyLine('{"type":"usage","input_tokens":12,"output_tokens":5}'),
      { kind: "usage", inputTokens: 12, outputTokens: 5 });
  });

  test("unknown JSON type -> unknown{raw}", () => {
    assert.deepStrictEqual(
      mapAgyLine('{"type":"weird"}'),
      { kind: "unknown", raw: { type: "weird" } });
  });
});
```

- [ ] **Step 2: Run the event test to verify it fails**

Run: `npm run compile-tests && npx mocha out/test/agy-events.test.js`
Expected: FAIL — `started` still `threadId`; `thought` kind still `thought`; `tool_call` still `args`.

- [ ] **Step 3: Rewrite the agy events mapper**

Replace `src/adapters/agy/events.ts` with:

```ts
import type { WorkerEvent } from "../types";

// Map one agy stdout line to a WorkerEvent. Today agy prints plain markdown;
// structured JSONL branches are for the future SDK sidecar path.
export function mapAgyLine(line: string): WorkerEvent | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  let obj: any;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return { kind: "message", text: trimmed };
  }

  // ponytail: dormant until agy or a sidecar emits JSONL; keeps the parser swap tiny.
  switch (obj?.type) {
    case "thread.started":
      return { kind: "started", sessionId: String(obj.thread_id ?? "") };
    case "tool_call":
      return { kind: "tool_call", name: String(obj.name ?? ""), input: obj.args };
    case "thought":
      return { kind: "thinking", text: String(obj.text ?? "") };
    case "usage":
      return { kind: "usage", inputTokens: obj.input_tokens ?? 0, outputTokens: obj.output_tokens ?? 0 };
    default:
      return { kind: "unknown", raw: obj };
  }
}
```

- [ ] **Step 4: Convert the agy adapter to shared types**

In `src/adapters/agy/agy-adapter.ts`:

- Replace the top imports (lines 3-4) with:

```ts
import { classifyError } from "../classify";
import { mapAgyLine } from "./events";
import type { AgentAdapter, RunOpts, WorkerEvent, WorkerResult, WorkerRun } from "../types";
```

- Replace the `RunOpts` interface (lines 6-13) with:

```ts
export interface AgyRunOpts extends RunOpts {
  sandbox?: boolean;
  skipPermissions?: boolean;
}
```

- Delete the `AgyRun` interface (lines 15-22, including its doc comment).
- Change `export function runAgy(opts: RunOpts): AgyRun {` → `export function runAgy(opts: AgyRunOpts): WorkerRun {`.
- Replace every remaining `AgyEvent` → `WorkerEvent`, `AgyResult` → `WorkerResult` (agy has no usage variable to retype).
- At the end of the file, after `runAgy`, add:

```ts
export const agyAdapter: AgentAdapter = {
  id: "agy",
  run: (opts) => runAgy(opts),
};
```

- [ ] **Step 5: Delete the duplicated agy classifier + its test**

```bash
git rm src/adapters/agy/classify.ts src/test/agy-classify.test.ts
```

- [ ] **Step 6: Fix the agy integration test import**

In `src/test/agy-adapter.integration.test.ts`:
- Line 6: change `import type { AgyEvent } from "../adapters/agy/events";` → `import type { WorkerEvent } from "../adapters/types";`.
- Lines 27, 54, 73: change `const events: AgyEvent[] = [];` → `const events: WorkerEvent[] = [];`.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS — all three adapters now emit `WorkerEvent`; `git grep -n "CodexEvent\|ClaudeEvent\|AgyEvent\|/classify\"" src` returns nothing.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: agy adapter emits WorkerEvent + exports agyAdapter; use shared classifier"
```

---

## US-2: Generic webview bridge

One bridge streams any `AgentAdapter` to the panel; the three `<cli>/webview-bridge.ts` and their tests are deleted; `panel.ts` selects the adapter. `protocol.ts` and the React UI are unchanged.

### Task 5: Collapse the three webview bridges into one

**Files:**
- Create: `src/adapters/webview-bridge.ts`
- Create: `src/test/webview-bridge.test.ts`
- Delete: `src/adapters/codex/webview-bridge.ts`, `src/adapters/claude/webview-bridge.ts`, `src/adapters/agy/webview-bridge.ts`
- Delete: `src/test/codex-webview-bridge.test.ts`, `src/test/claude-webview-bridge.test.ts`, `src/test/agy-webview-bridge.test.ts`
- Modify: `src/webview/panel.ts`

**Interfaces:**
- Consumes: `AgentAdapter`, `RunOpts`, `WorkerEvent` (Task 1); `codexAdapter`/`claudeAdapter`/`agyAdapter` (Tasks 2-4); `ExtensionToWebview` from `../webview/protocol`.
- Produces: `streamAdapterTestToWebview(adapter: AgentAdapter, webview: LogWebview, cwd: string, overrides?: Partial<RunOpts>): Promise<void>`.

- [ ] **Step 1: Write the failing generic bridge test**

`src/test/webview-bridge.test.ts`:

```ts
import * as assert from "assert";
import { streamAdapterTestToWebview } from "../adapters/webview-bridge";
import type { AgentAdapter, WorkerEvent, WorkerResult } from "../adapters/types";
import type { ExtensionToWebview } from "../webview/protocol";

function fakeAdapter(id: AgentAdapter["id"], events: WorkerEvent[], result: WorkerResult): AgentAdapter {
  return {
    id,
    run: () => ({
      cancel() {},
      result: Promise.resolve(result),
      async *[Symbol.asyncIterator]() {
        yield* events;
      },
    }),
  };
}

suite("streamAdapterTestToWebview", () => {
  test("posts normalized events + result as <id>Log messages", async () => {
    const posted: ExtensionToWebview[] = [];
    const events: WorkerEvent[] = [
      { kind: "started", sessionId: "s1", model: "claude-x" },
      { kind: "thinking", text: "hmm" },
      { kind: "tool_call", name: "Bash", input: { cmd: "ls" } },
      { kind: "message", text: "pong" },
      { kind: "usage", inputTokens: 10, outputTokens: 2, cachedInputTokens: 5, cacheWriteTokens: 0, costUsd: 0.01 },
    ];
    const adapter = fakeAdapter("claude", events, { status: "success", lastMessage: "pong" });

    await streamAdapterTestToWebview(adapter, { postMessage: (m) => (posted.push(m), true) }, "/tmp");

    assert.deepStrictEqual(posted, [
      { type: "claudeLog", level: "info", text: "Starting Claude test..." },
      { type: "claudeLog", level: "info", text: "started session s1 (claude-x)" },
      { type: "claudeLog", level: "info", text: "thinking: hmm" },
      { type: "claudeLog", level: "info", text: "tool Bash" },
      { type: "claudeLog", level: "info", text: "pong" },
      { type: "claudeLog", level: "info", text: "usage in=10 out=2 cached=5 cacheW=0 cost=$0.01" },
      { type: "claudeLog", level: "info", text: "done success" },
    ]);
  });

  test("started without model omits the parenthetical; channel matches id", async () => {
    const posted: ExtensionToWebview[] = [];
    const adapter = fakeAdapter("codex", [{ kind: "started", sessionId: "abc" }], { status: "success" });

    await streamAdapterTestToWebview(adapter, { postMessage: (m) => (posted.push(m), true) }, "/tmp");

    assert.deepStrictEqual(posted, [
      { type: "codexLog", level: "info", text: "Starting Codex test..." },
      { type: "codexLog", level: "info", text: "started session abc" },
      { type: "codexLog", level: "info", text: "done success" },
    ]);
  });

  test("failure posts an error line", async () => {
    const posted: ExtensionToWebview[] = [];
    const adapter = fakeAdapter("agy", [], { status: "failed", reason: "boom" });

    await streamAdapterTestToWebview(adapter, { postMessage: (m) => (posted.push(m), true) }, "/tmp");

    assert.deepStrictEqual(posted, [
      { type: "agyLog", level: "info", text: "Starting Agy test..." },
      { type: "agyLog", level: "error", text: "done failed: boom" },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run compile-tests && npx mocha out/test/webview-bridge.test.js`
Expected: FAIL — `Cannot find module '../adapters/webview-bridge'`.

- [ ] **Step 3: Create the generic bridge**

`src/adapters/webview-bridge.ts`:

```ts
import type { AgentAdapter, RunOpts, WorkerEvent } from "./types";
import type { ExtensionToWebview } from "../webview/protocol";

interface LogWebview {
  postMessage(msg: ExtensionToWebview): boolean | PromiseLike<boolean>;
}

const LABELS: Record<AgentAdapter["id"], string> = { codex: "Codex", claude: "Claude", agy: "Agy" };

function formatEvent(ev: WorkerEvent): string | null {
  switch (ev.kind) {
    case "started":
      return `started session ${ev.sessionId}${ev.model ? ` (${ev.model})` : ""}`;
    case "message":
      return ev.text;
    case "thinking":
      return `thinking: ${ev.text}`;
    case "tool_call":
      return `tool ${ev.name}`;
    case "usage": {
      let s = `usage in=${ev.inputTokens} out=${ev.outputTokens}`;
      if (ev.cachedInputTokens !== undefined) { s += ` cached=${ev.cachedInputTokens}`; }
      if (ev.cacheWriteTokens !== undefined) { s += ` cacheW=${ev.cacheWriteTokens}`; }
      if (ev.reasoningTokens !== undefined) { s += ` reasoning=${ev.reasoningTokens}`; }
      if (ev.costUsd !== undefined) { s += ` cost=$${ev.costUsd}`; }
      return s;
    }
    case "unknown":
      return null;
  }
}

export async function streamAdapterTestToWebview(
  adapter: AgentAdapter,
  webview: LogWebview,
  cwd: string,
  overrides: Partial<RunOpts> = {}
): Promise<void> {
  const logType = `${adapter.id}Log` as "codexLog" | "claudeLog" | "agyLog";
  const post = (level: "info" | "error", text: string) =>
    webview.postMessage({ type: logType, level, text });

  await post("info", `Starting ${LABELS[adapter.id]} test...`);

  const run = adapter.run({ prompt: "Reply with exactly the word: pong", cwd, ...overrides });

  try {
    for await (const ev of run) {
      const text = formatEvent(ev);
      if (text) {
        await post("info", text);
      }
    }

    const result = await run.result;
    if (result.status === "success") {
      await post("info", "done success");
    } else {
      await post("error", `done ${result.status}: ${result.reason ?? "unknown error"}`);
    }
  } catch (err) {
    await post("error", err instanceof Error ? err.message : String(err));
  }
}
```

- [ ] **Step 4: Run the bridge test to verify it passes**

Run: `npm run compile-tests && npx mocha out/test/webview-bridge.test.js`
Expected: PASS — 3 passing.

- [ ] **Step 5: Delete the three old bridges and their tests**

```bash
git rm src/adapters/codex/webview-bridge.ts src/adapters/claude/webview-bridge.ts src/adapters/agy/webview-bridge.ts \
       src/test/codex-webview-bridge.test.ts src/test/claude-webview-bridge.test.ts src/test/agy-webview-bridge.test.ts
```

- [ ] **Step 6: Rewire `panel.ts` to the generic bridge**

In `src/webview/panel.ts`:

- Replace the three bridge imports (lines 2-4) with:

```ts
import { agyAdapter } from "../adapters/agy/agy-adapter";
import { claudeAdapter } from "../adapters/claude/claude-adapter";
import { codexAdapter } from "../adapters/codex/codex-adapter";
import { streamAdapterTestToWebview } from "../adapters/webview-bridge";
```

- Replace the three `if (msg.type === "test…")` blocks (lines 48-58) with (`oauthToken` is now a harmless shared field, so the codex/agy `_drop` destructuring is removed):

```ts
      if (msg.type === "testCodex") {
        void streamAdapterTestToWebview(codexAdapter, webview, cwd(), clean(msg.fields));
      }
      if (msg.type === "testAgy") {
        void streamAdapterTestToWebview(agyAdapter, webview, cwd(), clean(msg.fields));
      }
      if (msg.type === "testClaude") {
        void streamAdapterTestToWebview(claudeAdapter, webview, cwd(), clean(msg.fields));
      }
```

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS — generic bridge suite green; `git grep -n "webview-bridge" src` shows only `src/adapters/webview-bridge.ts`, `src/test/webview-bridge.test.ts`, and `src/webview/panel.ts`; lint + type-check clean.

- [ ] **Step 8: Manual smoke check (optional, dev)**

Launch the extension (F5), open the Skynet webview, click **Test Codex / Test Claude / Test Agy**; each streams lines into its log panel ending in `done success`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: one generic webview bridge over WorkerEvent; rewire panel"
```

---

## Self-Review notes

- **Spec coverage:** `WorkerEvent`/`WorkerUsage`/`WorkerResult`/`AgentAdapter` (Task 1); per-CLI mappers → `WorkerEvent` (Tasks 2-4); shared classifier + 3 deletions (Tasks 1-4 = `adapters--errors`); generic bridge + panel rewire (Task 5). All spec sections map to a task.
- **Spec refinement:** the shared `RunOpts` is the common contract (not the full superset the spec sketched) because `sandbox` has conflicting types across codex/agy; advanced knobs live in `<Cli>RunOpts extends RunOpts`. `oauthToken` is kept in the shared `RunOpts` so the smoke UI passes it generically. The spec's `RunOpts` section is updated to match.
- **Type consistency:** `WorkerEvent`/`WorkerUsage` field names are identical across mappers, tests, and `formatEvent`. `runX` returns `WorkerRun`; each adapter exports `<id>Adapter: AgentAdapter`. `streamAdapterTestToWebview` signature matches its test and `panel.ts` call sites.
