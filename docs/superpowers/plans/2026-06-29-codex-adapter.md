# Codex Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone codex CLI bridge that runs a task via `codex exec --json`, streams typed events, and resolves a terminal status with error classification.

**Architecture:** A small pure parser (`events.ts`) maps codex JSONL lines to a codex-specific `CodexEvent` union; a pure `classifyError` (`classify.ts`) buckets stderr into limit/transport/terminal; `runCodex` (`codex-adapter.ts`) spawns the child, bridges its stdout lines to an async iterator, and resolves a `CodexResult` on close. No shared adapter interface — extracted later once ≥2 adapters exist.

**Tech Stack:** TypeScript (Node16 modules, strict), Node `child_process` + `readline`, mocha/`@vscode/test-cli` test runner, `assert`.

## Global Constraints

- Verified against `codex-cli 0.142.3`; invocation `codex exec --json --skip-git-repo-check -s <sandbox> -C <cwd> [-m <model>] "<prompt>"`.
- Child `stdin` MUST be `'ignore'` and the prompt passed as an argv argument — otherwise codex blocks on `"Reading additional input from stdin..."`.
- Default sandbox is `read-only`.
- Scope is codex only: NO shared `AgentAdapter`/`WorkerEvent` type, NO fallback/retry, NO step-function panel.
- New code lives under `src/adapters/codex/`, isolated from `src/webview/`.
- Tests reuse the existing runner: `*.test.ts` under `src/test/`, compiled to `out/` by `npm run compile-tests`, run with `npm test`.
- The real-CLI integration test is gated behind `process.env.CODEX_E2E` so `npm test` does not burn quota by default.
- Relative imports omit the `.js` extension (matches existing `src/test/*.test.ts`).

---

## US-1: Codex adapter

A developer can call `runCodex({prompt, cwd})`, iterate typed events as codex runs, and await a `CodexResult` with a clear `success`/`failed`/`cancelled` status (failures classified). Proven by deterministic parser/classifier unit tests plus an opt-in real-CLI integration test.

### Task 1: Event types + JSONL line parser

**Files:**
- Create: `src/adapters/codex/events.ts`
- Test: `src/test/codex-events.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface CodexUsage { inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningOutputTokens: number }`
  - `type ErrorClass = 'limit' | 'transport' | 'terminal'`
  - `type CodexEvent = { kind:'started'; threadId:string } | { kind:'message'; text:string } | ({ kind:'usage' } & CodexUsage) | { kind:'unknown'; raw:unknown }`
  - `interface CodexResult { status:'success'|'failed'|'cancelled'; reason?:string; errorClass?:ErrorClass; usage?:CodexUsage; lastMessage?:string }`
  - `function mapCodexLine(line: string): CodexEvent | null`

- [ ] **Step 1: Write the failing test**

Create `src/test/codex-events.test.ts`:

```ts
import * as assert from "assert";
import { mapCodexLine } from "../adapters/codex/events";

suite("mapCodexLine", () => {
  test("thread.started → started", () => {
    assert.deepStrictEqual(
      mapCodexLine('{"type":"thread.started","thread_id":"abc"}'),
      { kind: "started", threadId: "abc" });
  });

  test("agent_message item → message", () => {
    assert.deepStrictEqual(
      mapCodexLine('{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"pong"}}'),
      { kind: "message", text: "pong" });
  });

  test("turn.completed → usage", () => {
    assert.deepStrictEqual(
      mapCodexLine('{"type":"turn.completed","usage":{"input_tokens":12,"cached_input_tokens":9,"output_tokens":5,"reasoning_output_tokens":0}}'),
      { kind: "usage", inputTokens: 12, cachedInputTokens: 9, outputTokens: 5, reasoningOutputTokens: 0 });
  });

  test("blank line → null", () => assert.strictEqual(mapCodexLine("  "), null));

  test("non-JSON stdin notice → null", () =>
    assert.strictEqual(mapCodexLine("Reading additional input from stdin..."), null));

  test("unknown type → unknown{raw}", () => {
    assert.deepStrictEqual(mapCodexLine('{"type":"turn.started"}'),
      { kind: "unknown", raw: { type: "turn.started" } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile-tests`
Expected: FAIL — `Cannot find module '../adapters/codex/events'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/adapters/codex/events.ts`:

```ts
export interface CodexUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export type ErrorClass = "limit" | "transport" | "terminal";

export type CodexEvent =
  | { kind: "started"; threadId: string }
  | { kind: "message"; text: string }
  | ({ kind: "usage" } & CodexUsage)
  | { kind: "unknown"; raw: unknown };

export interface CodexResult {
  status: "success" | "failed" | "cancelled";
  reason?: string;
  errorClass?: ErrorClass;
  usage?: CodexUsage;
  lastMessage?: string;
}

// Map one codex `exec --json` JSONL line to a CodexEvent.
// Returns null for blank or non-JSON lines (e.g. the stdin notice).
export function mapCodexLine(line: string): CodexEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let obj: any;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  switch (obj?.type) {
    case "thread.started":
      return { kind: "started", threadId: String(obj.thread_id ?? "") };
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
        cachedInputTokens: u.cached_input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        reasoningOutputTokens: u.reasoning_output_tokens ?? 0,
      };
    }
    default:
      return { kind: "unknown", raw: obj };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all 6 `mapCodexLine` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/codex/events.ts src/test/codex-events.test.ts
git commit -m "feat: codex event types + JSONL line parser"
```

### Task 2: Error classifier

**Files:**
- Create: `src/adapters/codex/classify.ts`
- Test: `src/test/codex-classify.test.ts`

**Interfaces:**
- Consumes: `ErrorClass` from `./events`.
- Produces: `function classifyError(stderr: string): ErrorClass`.
  (Exit-code → status is decided in Task 3; the classifier only needs stderr text.)

- [ ] **Step 1: Write the failing test**

Create `src/test/codex-classify.test.ts`:

```ts
import * as assert from "assert";
import { classifyError } from "../adapters/codex/classify";

suite("classifyError", () => {
  test("429 rate limit → limit", () =>
    assert.strictEqual(classifyError("Error: 429 rate limit exceeded"), "limit"));
  test("quota → limit", () =>
    assert.strictEqual(classifyError("You have exceeded your quota"), "limit"));
  test("ECONNRESET → transport", () =>
    assert.strictEqual(classifyError("ECONNRESET while connecting"), "transport"));
  test("timeout → transport", () =>
    assert.strictEqual(classifyError("request timeout"), "transport"));
  test("other → terminal", () =>
    assert.strictEqual(classifyError("invalid prompt syntax"), "terminal"));
  test("empty → terminal", () =>
    assert.strictEqual(classifyError(""), "terminal"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile-tests`
Expected: FAIL — `Cannot find module '../adapters/codex/classify'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/adapters/codex/classify.ts`:

```ts
import type { ErrorClass } from "./events";

const LIMIT = /rate.?limit|429|quota|too many requests/i;
const TRANSPORT = /network|econn|etimedout|timeout|socket|dns|enotfound/i;

// ponytail: heuristic stderr patterns from docs/reason, not from observed
// limit/transport output (a real 429 can't be induced on demand). Refine the
// regexes the first time we capture real limit/transport stderr.
export function classifyError(stderr: string): ErrorClass {
  if (LIMIT.test(stderr)) return "limit";
  if (TRANSPORT.test(stderr)) return "transport";
  return "terminal";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all 6 `classifyError` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/codex/classify.ts src/test/codex-classify.test.ts
git commit -m "feat: codex error classifier (limit/transport/terminal)"
```

### Task 3: runCodex adapter + real-CLI proof

**Files:**
- Create: `src/adapters/codex/codex-adapter.ts`
- Test: `src/test/codex-adapter.integration.test.ts`

**Interfaces:**
- Consumes: `mapCodexLine`, `CodexEvent`, `CodexResult`, `CodexUsage` from `./events`; `classifyError` from `./classify`.
- Produces:
  - `interface RunOpts { prompt:string; cwd:string; model?:string; sandbox?:'read-only'|'workspace-write'|'danger-full-access' }`
  - `interface CodexRun extends AsyncIterable<CodexEvent> { cancel(): void; result: Promise<CodexResult> }`
  - `function runCodex(opts: RunOpts): CodexRun`

- [ ] **Step 1: Write the failing test**

Create `src/test/codex-adapter.integration.test.ts`. Gated behind `CODEX_E2E` so a normal `npm test` skips it:

```ts
import * as assert from "assert";
import * as os from "os";
import { runCodex } from "../adapters/codex/codex-adapter";
import type { CodexEvent } from "../adapters/codex/events";

const describe = process.env.CODEX_E2E ? suite : suite.skip;

describe("codex adapter (real CLI, slow — set CODEX_E2E=1)", function () {
  this.timeout(120_000);

  test("happy path: reply pong → success with usage", async () => {
    const run = runCodex({ prompt: "Reply with exactly the word: pong", cwd: os.tmpdir() });
    const events: CodexEvent[] = [];
    for await (const ev of run) events.push(ev);
    const result = await run.result;
    assert.strictEqual(result.status, "success");
    assert.ok(result.usage, "usage captured");
    assert.ok((result.lastMessage ?? "").toLowerCase().includes("pong"), "agent said pong");
    assert.ok(events.some((e) => e.kind === "message"), "a message event streamed");
  });

  test("cancel mid-run → cancelled", async () => {
    const run = runCodex({
      prompt: "Count slowly from 1 to 200, one number per line.",
      cwd: os.tmpdir(),
    });
    for await (const ev of run) {
      if (ev.kind === "started") run.cancel();
    }
    const result = await run.result;
    assert.strictEqual(result.status, "cancelled");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile-tests`
Expected: FAIL — `Cannot find module '../adapters/codex/codex-adapter'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/adapters/codex/codex-adapter.ts`:

```ts
import { spawn } from "node:child_process";
import * as readline from "node:readline";
import { classifyError } from "./classify";
import { mapCodexLine, type CodexEvent, type CodexResult, type CodexUsage } from "./events";

export interface RunOpts {
  prompt: string;
  cwd: string;
  model?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
}

export interface CodexRun extends AsyncIterable<CodexEvent> {
  cancel(): void;
  result: Promise<CodexResult>;
}

export function runCodex(opts: RunOpts): CodexRun {
  const args = [
    "exec", "--json", "--skip-git-repo-check",
    "-s", opts.sandbox ?? "read-only",
    "-C", opts.cwd,
  ];
  if (opts.model) args.push("-m", opts.model);
  args.push(opts.prompt);

  // stdin 'ignore' is mandatory — an open/empty pipe makes codex block.
  const child = spawn("codex", args, { stdio: ["ignore", "pipe", "pipe"] });

  let stderr = "";
  child.stderr!.on("data", (d) => { stderr += d.toString(); });

  let cancelled = false;
  let usage: CodexUsage | undefined;
  let lastMessage: string | undefined;
  let sawTurn = false;

  // Bridge readline 'line' / process 'close' callbacks to an async iterator.
  const queue: CodexEvent[] = [];
  let resolveNext: ((r: IteratorResult<CodexEvent>) => void) | null = null;
  let finished = false;

  const emit = (ev: CodexEvent) => {
    if (ev.kind === "usage") { usage = ev; sawTurn = true; }
    if (ev.kind === "message") lastMessage = ev.text;
    if (resolveNext) {
      const r = resolveNext; resolveNext = null;
      r({ value: ev, done: false });
    } else {
      queue.push(ev);
    }
  };

  const finishIter = () => {
    finished = true;
    if (resolveNext) {
      const r = resolveNext; resolveNext = null;
      r({ value: undefined as unknown as CodexEvent, done: true });
    }
  };

  const rl = readline.createInterface({ input: child.stdout! });
  rl.on("line", (line) => {
    const ev = mapCodexLine(line);
    if (ev) emit(ev);
  });

  let settled = false;
  const result = new Promise<CodexResult>((resolve) => {
    const settle = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      rl.close();
      finishIter();
      if (cancelled) {
        resolve({ status: "cancelled", reason: "cancelled by caller", usage, lastMessage });
      } else if (exitCode === 0 && sawTurn) {
        resolve({ status: "success", usage, lastMessage });
      } else {
        resolve({
          status: "failed",
          reason: stderr.trim() || `codex exited with code ${exitCode}`,
          errorClass: classifyError(stderr),
          usage,
          lastMessage,
        });
      }
    };
    child.on("error", (err) => { stderr += String(err.message); settle(null); });
    child.on("close", (code) => settle(code));
  });

  const iterator: AsyncIterator<CodexEvent> = {
    next() {
      if (queue.length) return Promise.resolve({ value: queue.shift()!, done: false });
      if (finished) return Promise.resolve({ value: undefined as unknown as CodexEvent, done: true });
      return new Promise((r) => { resolveNext = r; });
    },
  };

  return {
    cancel() { cancelled = true; child.kill("SIGTERM"); },
    result,
    [Symbol.asyncIterator]() { return iterator; },
  };
}
```

- [ ] **Step 4: Run the unit suites (fast) to verify nothing regressed**

Run: `npm test`
Expected: PASS — Task 1 & 2 suites green; the integration suite shows as **pending/skipped** (CODEX_E2E unset).

- [ ] **Step 5: Run the real-CLI proof (slow, uses quota)**

Run: `CODEX_E2E=1 npm test`
Expected: PASS — `happy path` resolves `status:'success'` with usage and a `pong` message; `cancel mid-run` resolves `status:'cancelled'`.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/codex/codex-adapter.ts src/test/codex-adapter.integration.test.ts
git commit -m "feat: runCodex adapter with streaming events, cancel, and real-CLI proof"
```
