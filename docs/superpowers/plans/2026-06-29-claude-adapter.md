# Claude Code (claude) Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone, concrete TypeScript adapter that runs a task through the Claude Code CLI (`claude -p --output-format stream-json`) and turns its JSONL output into a typed, observable event stream with a clear terminal status, plus a manual webview smoke UI to prove it.

**Architecture:** Mirror the existing codex/agy adapters file-for-file in a new `src/adapters/claude/` directory: `events.ts` (typed events + line mapper), `classify.ts` (error heuristic, copied verbatim from codex), `claude-adapter.ts` (`runClaude` — spawns the child, exposes an async iterator + `result` promise), `webview-bridge.ts` (formats events as log lines). The CLI emits **rich JSONL** (the richest of the three): `system/init`, `assistant` content blocks (`text`/`thinking`/`tool_use`) with cache-token usage, and a terminal `result`. Unlike codex's one-event-per-line mapper, `mapClaudeLine` takes a **parsed object** and **fans out to an array** (one `assistant` line → many events).

**Tech Stack:** TypeScript, Node `child_process`/`readline`, VSCode extension host + React webview, `vscode-test`/mocha test runner (`suite`/`test`, node `assert`).

## Global Constraints

- **Verified ground truth:** `claude 2.1.195`. Non-interactive invocation: `claude -p "<prompt>" --output-format stream-json --verbose [--model <m>] --permission-mode <mode> [--allowedTools ...] --add-dir <cwd>`. Output is **JSONL on stdout**; event `type`s observed: `system` (`subtype:"init"` + hook noise), `assistant` (`message.content[]` + `message.usage`), `result` (`is_error`, `result`, `total_cost_usd`, `usage`).
- **`--verbose` is required** for the full event stream under `-p` with `--output-format stream-json`.
- **Prompt is positional and passed right after `-p`** (before the variadic `--allowedTools`/`--add-dir` flags, so commander never swallows it). stdin `'ignore'` on the spawned child (anti-block discipline mirrored from codex/agy).
- **No `-C` flag:** set the child working directory via the spawn `cwd` option **and** pass `--add-dir <cwd>`.
- **Permission default `'default'`:** under `-p` there is no one to approve tool prompts, so tools are denied and the agent continues — the safe read-only-equivalent. The adapter does **not** pass `--dangerously-skip-permissions` by default. Callers opt into real tool work via `permissionMode: 'acceptEdits' | 'bypassPermissions'` and optional `allowedTools`.
- **Success rule (GOTCHA):** success requires `exitCode === 0` **and** a captured `result` event with `is_error === false`. `result.subtype` is unreliable — an observed run returned `subtype:"success"` with `is_error:true` ("Not logged in"). Gate on `is_error`, never on `subtype`.
- **Error classification reads result text AND stderr:** claude reports failures in the structured `result.result` field, not only stderr. `classifyError` is **copied verbatim** from `src/adapters/codex/classify.ts`; the adapter calls it on `` `${resultText}\n${stderr}` ``. This is the **3rd** consumer (strongest extraction trigger), but the extraction is a separate US.
- **No shared types yet:** the adapter stays concrete and claude-specific.
- **Tests:** live in `src/test/`, compiled by `npm run compile-tests`, run with `npm test` (vscode-test/mocha). The real-CLI integration test is gated behind `process.env.CLAUDE_E2E` so a normal `npm test` does not consume quota. Note: the real-CLI happy path requires a `claude` that is logged in for the chosen model.

---

## US-1: Claude Code adapter

A working, tested `runClaude(opts)` that streams typed events from `claude -p --output-format stream-json` and resolves a terminal `ClaudeResult`. Usable end-to-end via tests (fake-CLI fast path + real-CLI gated path); no UI required.

### Task 1: Event types + JSONL line mapper

**Files:**
- Create: `src/adapters/claude/events.ts`
- Test: `src/test/claude-events.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ClaudeUsage`, `ErrorClass`, `ClaudeEvent`, `ClaudeResult` types; `mapClaudeLine(obj: any): ClaudeEvent[]`.

- [ ] **Step 1: Write the failing test**

Create `src/test/claude-events.test.ts`:

```ts
import * as assert from "assert";
import { mapClaudeLine } from "../adapters/claude/events";

suite("mapClaudeLine", () => {
  test("system/init -> [started]", () => {
    assert.deepStrictEqual(
      mapClaudeLine({ type: "system", subtype: "init", session_id: "s1", model: "claude-x" }),
      [{ kind: "started", sessionId: "s1", model: "claude-x" }]);
  });

  test("system hook noise -> [unknown]", () => {
    assert.deepStrictEqual(
      mapClaudeLine({ type: "system", subtype: "hook_started", hook_name: "SessionStart" }),
      [{ kind: "unknown", raw: { type: "system", subtype: "hook_started", hook_name: "SessionStart" } }]);
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
          input_tokens: 10, output_tokens: 2,
          cache_creation_input_tokens: 1, cache_read_input_tokens: 5,
        },
      },
    };
    assert.deepStrictEqual(mapClaudeLine(obj), [
      { kind: "message", text: "pong" },
      { kind: "thinking", text: "hmm" },
      { kind: "tool_call", name: "Bash", input: { cmd: "ls" } },
      { kind: "usage", inputTokens: 10, outputTokens: 2, cacheCreationInputTokens: 1, cacheReadInputTokens: 5 },
    ]);
  });

  test("result with usage -> [usage incl. cost]", () => {
    assert.deepStrictEqual(
      mapClaudeLine({
        type: "result", subtype: "success", is_error: false, result: "pong",
        total_cost_usd: 0.01,
        usage: { input_tokens: 10, output_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 5 },
      }),
      [{ kind: "usage", inputTokens: 10, outputTokens: 2, cacheCreationInputTokens: 0, cacheReadInputTokens: 5, costUsd: 0.01 }]);
  });

  test("unknown type -> [unknown{raw}]", () => {
    assert.deepStrictEqual(
      mapClaudeLine({ type: "weird" }),
      [{ kind: "unknown", raw: { type: "weird" } }]);
  });

  test("unrecognized content block -> [unknown{raw block}]", () => {
    assert.deepStrictEqual(
      mapClaudeLine({ type: "assistant", message: { content: [{ type: "image", source: {} }] } }),
      [{ kind: "unknown", raw: { type: "image", source: {} } }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../adapters/claude/events`.

- [ ] **Step 3: Write minimal implementation**

Create `src/adapters/claude/events.ts`:

```ts
export interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  costUsd?: number;            // from result.total_cost_usd (only on the result event)
}

export type ErrorClass = "limit" | "transport" | "terminal";

export type ClaudeEvent =
  | { kind: "started"; sessionId: string; model: string }   // system/init
  | { kind: "message"; text: string }                        // assistant text block
  | { kind: "thinking"; text: string }                       // assistant thinking block
  | { kind: "tool_call"; name: string; input: unknown }      // assistant tool_use block
  | ({ kind: "usage" } & ClaudeUsage)                        // assistant/result usage
  | { kind: "unknown"; raw: unknown };                       // system/hook_*, future events

export interface ClaudeResult {
  status: "success" | "failed" | "cancelled";
  reason?: string;
  errorClass?: ErrorClass;
  usage?: ClaudeUsage;        // last/aggregate usage incl. cost
  lastMessage?: string;       // last assistant text (or result.result)
}

function toUsage(u: any): ClaudeUsage {
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheCreationInputTokens: u?.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: u?.cache_read_input_tokens ?? 0,
  };
}

// Map one parsed claude stream-json object to zero-or-more ClaudeEvents.
// An `assistant` object fans out: one event per content block + a usage event.
// The adapter does JSON.parse + result capture; this mapper is pure.
export function mapClaudeLine(obj: any): ClaudeEvent[] {
  switch (obj?.type) {
    case "system":
      if (obj.subtype === "init") {
        return [{ kind: "started", sessionId: String(obj.session_id ?? ""), model: String(obj.model ?? "") }];
      }
      return [{ kind: "unknown", raw: obj }];   // hook_started / hook_response / future subtypes
    case "assistant": {
      const out: ClaudeEvent[] = [];
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — `mapClaudeLine` suite green.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/claude/events.ts src/test/claude-events.test.ts
git commit -m "feat: claude adapter event types + JSONL line mapper"
```

### Task 2: Error classifier

**Files:**
- Create: `src/adapters/claude/classify.ts`
- Test: `src/test/claude-classify.test.ts`

**Interfaces:**
- Consumes: `ErrorClass` from `./events` (Task 1).
- Produces: `classifyError(text: string): ErrorClass`.

- [ ] **Step 1: Write the failing test**

Create `src/test/claude-classify.test.ts`:

```ts
import * as assert from "assert";
import { classifyError } from "../adapters/claude/classify";

suite("classifyError (claude)", () => {
  test("429 rate limit -> limit", () =>
    assert.strictEqual(classifyError("Error: 429 rate limit exceeded"), "limit"));
  test("quota -> limit", () =>
    assert.strictEqual(classifyError("You have exceeded your quota"), "limit"));
  test("ECONNRESET -> transport", () =>
    assert.strictEqual(classifyError("ECONNRESET while connecting"), "transport"));
  test("timeout -> transport", () =>
    assert.strictEqual(classifyError("request timeout"), "transport"));
  test("not logged in -> terminal", () =>
    assert.strictEqual(classifyError("Not logged in · Please run /login"), "terminal"));
  test("empty -> terminal", () =>
    assert.strictEqual(classifyError(""), "terminal"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../adapters/claude/classify`.

- [ ] **Step 3: Write minimal implementation**

Create `src/adapters/claude/classify.ts` (copied verbatim from `src/adapters/codex/classify.ts`):

```ts
import type { ErrorClass } from "./events";

const LIMIT = /rate.?limit|429|quota|too many requests/i;
const TRANSPORT = /network|econn|etimedout|timeout|socket|dns|enotfound/i;

// ponytail: classify.ts is now duplicated across codex + agy + claude. THREE
// consumers — the strongest trigger yet to extract a shared classifier in the
// "Error classification" US. Not extracted here, to keep this adapter standalone.
// ponytail: heuristic patterns are inherited from codex and unverified against
// real claude limit/transport output. Refine on first real capture.
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — `classifyError (claude)` suite green.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/claude/classify.ts src/test/claude-classify.test.ts
git commit -m "feat: claude adapter error classifier (copied from codex)"
```

### Task 3: runClaude adapter + fake-CLI and real-CLI proof

**Files:**
- Create: `src/adapters/claude/claude-adapter.ts`
- Test: `src/test/claude-adapter.integration.test.ts`

**Interfaces:**
- Consumes: `mapClaudeLine`, `ClaudeEvent`, `ClaudeResult`, `ClaudeUsage` from `./events` (Task 1); `classifyError` from `./classify` (Task 2).
- Produces: `RunOpts { prompt: string; cwd: string; model?: string; permissionMode?: "default" | "acceptEdits" | "bypassPermissions"; allowedTools?: string[] }`; `ClaudeRun extends AsyncIterable<ClaudeEvent> { cancel(): void; result: Promise<ClaudeResult> }`; `runClaude(opts: RunOpts): ClaudeRun`.

- [ ] **Step 1: Write the failing test**

Create `src/test/claude-adapter.integration.test.ts`. The fast tests use a fake `claude` script on `PATH` (no quota); the real-CLI tests are gated behind `CLAUDE_E2E`:

```ts
import * as assert from "assert";
import * as fs from "node:fs/promises";
import * as os from "os";
import * as path from "node:path";
import { runClaude } from "../adapters/claude/claude-adapter";
import type { ClaudeEvent } from "../adapters/claude/events";

async function withFakeClaude(script: string, fn: () => Promise<void>): Promise<void> {
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), "fake-claude-"));
  const claudePath = path.join(binDir, "claude");
  await fs.writeFile(claudePath, script);
  await fs.chmod(claudePath, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${oldPath ?? ""}`;
  try {
    await fn();
  } finally {
    process.env.PATH = oldPath;
    await fs.rm(binDir, { recursive: true, force: true });
  }
}

const HAPPY = `#!/bin/sh
printf '%s\\n' '{"type":"system","subtype":"hook_started","hook_name":"SessionStart"}'
printf '%s\\n' '{"type":"system","subtype":"init","session_id":"s1","model":"claude-x"}'
printf '%s\\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"pong"}],"usage":{"input_tokens":10,"output_tokens":2,"cache_creation_input_tokens":0,"cache_read_input_tokens":5}}}'
printf '%s\\n' '{"type":"result","subtype":"success","is_error":false,"result":"pong","total_cost_usd":0.01,"usage":{"input_tokens":10,"output_tokens":2,"cache_creation_input_tokens":0,"cache_read_input_tokens":5}}'
exit 0
`;

// GOTCHA: exit 0 AND subtype:"success" but is_error:true must be a failure.
const NOT_LOGGED_IN = `#!/bin/sh
printf '%s\\n' '{"type":"system","subtype":"init","session_id":"s1","model":"claude-x"}'
printf '%s\\n' '{"type":"result","subtype":"success","is_error":true,"result":"Not logged in · Please run /login","total_cost_usd":0}'
exit 0
`;

const RATE_LIMITED = `#!/bin/sh
printf '%s\\n' '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"429 rate limit exceeded"}'
exit 1
`;

suite("claude adapter (fake CLI)", () => {
  test("happy: init+text+result -> success, message + started + usage(cost), hook noise skipped", async () => {
    await withFakeClaude(HAPPY, async () => {
      const run = runClaude({ prompt: "ignored", cwd: os.tmpdir() });
      const events: ClaudeEvent[] = [];
      for await (const ev of run) {
        events.push(ev);
      }
      const result = await run.result;
      assert.strictEqual(result.status, "success");
      assert.ok(events.some((e) => e.kind === "started"), "started streamed");
      assert.ok(events.some((e) => e.kind === "message"), "message streamed");
      assert.ok(events.some((e) => e.kind === "unknown"), "hook noise surfaced as unknown");
      assert.strictEqual(result.lastMessage, "pong");
      assert.ok(result.usage && result.usage.costUsd === 0.01, "final usage carries cost");
    });
  });

  test("GOTCHA: exit 0 + subtype success + is_error true -> failed/terminal", async () => {
    await withFakeClaude(NOT_LOGGED_IN, async () => {
      const run = runClaude({ prompt: "ignored", cwd: os.tmpdir() });
      for await (const _ of run) {
        // drain
      }
      const result = await run.result;
      assert.strictEqual(result.status, "failed");
      assert.strictEqual(result.errorClass, "terminal");
      assert.ok((result.reason ?? "").includes("Not logged in"), "reason carries result text");
    });
  });

  test("is_error result with 429 -> failed + errorClass limit", async () => {
    await withFakeClaude(RATE_LIMITED, async () => {
      const run = runClaude({ prompt: "ignored", cwd: os.tmpdir() });
      for await (const _ of run) {
        // drain
      }
      const result = await run.result;
      assert.strictEqual(result.status, "failed");
      assert.strictEqual(result.errorClass, "limit");
    });
  });

  test("passes -p and the prompt before the flags", async () => {
    // Fake echoes a result line embedding argv 1 and 2 so we can assert order.
    const script =
      "#!/bin/sh\n" +
      "printf '{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"result\":\"'\"$1 $2\"'\"}\\n'\n" +
      "exit 0\n";
    await withFakeClaude(script, async () => {
      const run = runClaude({ prompt: "hello", cwd: os.tmpdir() });
      for await (const _ of run) {
        // drain
      }
      const result = await run.result;
      assert.strictEqual(result.lastMessage, "-p hello");
    });
  });
});

const describe = process.env.CLAUDE_E2E ? suite : suite.skip;

describe("claude adapter (real CLI, slow — set CLAUDE_E2E=1)", function () {
  this.timeout(120_000);

  test("happy path: reply pong -> success", async () => {
    const run = runClaude({ prompt: "Reply with exactly the word: pong", cwd: os.tmpdir() });
    const events: ClaudeEvent[] = [];
    for await (const ev of run) {
      events.push(ev);
    }
    const result = await run.result;
    assert.strictEqual(result.status, "success");
    assert.ok((result.lastMessage ?? "").toLowerCase().includes("pong"), "agent said pong");
    assert.ok(events.some((e) => e.kind === "message"), "a message event streamed");
    assert.ok(result.usage, "usage present");
  });

  test("cancel mid-run -> cancelled", async () => {
    const run = runClaude({
      prompt: "Count slowly from 1 to 200, one number per line.",
      cwd: os.tmpdir(),
    });
    const timer = setTimeout(() => run.cancel(), 5_000);
    try {
      for await (const _ of run) {
        // drain
      }
    } finally {
      clearTimeout(timer);
    }
    const result = await run.result;
    assert.strictEqual(result.status, "cancelled");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../adapters/claude/claude-adapter`.

- [ ] **Step 3: Write minimal implementation**

Create `src/adapters/claude/claude-adapter.ts` (async-iterator plumbing copied from `codex-adapter.ts`; the line handler parses JSON once, captures the `result` object for the status decision, and emits each event from the `mapClaudeLine` array):

```ts
import { spawn } from "node:child_process";
import * as readline from "node:readline";
import { classifyError } from "./classify";
import { mapClaudeLine, type ClaudeEvent, type ClaudeResult, type ClaudeUsage } from "./events";

export interface RunOpts {
  prompt: string;
  cwd: string;
  model?: string;
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions"; // default "default"
  allowedTools?: string[];
}

/**
 * Async iterator is single-consumer: create one `for await` loop per run.
 * Concurrent iteration shares one internal event queue and is not supported.
 */
export interface ClaudeRun extends AsyncIterable<ClaudeEvent> {
  cancel(): void;
  result: Promise<ClaudeResult>;
}

export function runClaude(opts: RunOpts): ClaudeRun {
  // Prompt is positional, placed right after -p so the variadic --allowedTools /
  // --add-dir flags below never swallow it. --verbose is required for the full
  // event stream under -p with stream-json.
  const args = ["-p", opts.prompt, "--output-format", "stream-json", "--verbose"];
  if (opts.model) {
    args.push("--model", opts.model);
  }
  args.push("--permission-mode", opts.permissionMode ?? "default");
  if (opts.allowedTools?.length) {
    args.push("--allowedTools", ...opts.allowedTools);
  }
  args.push("--add-dir", opts.cwd);

  // stdin 'ignore' mirrors codex/agy anti-block discipline.
  // No -C flag on claude → set the working directory via the spawn cwd option.
  const child = spawn("claude", args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });

  let stderr = "";
  child.stderr?.on("data", (d) => {
    stderr += d.toString();
  });

  let cancelled = false;
  let usage: ClaudeUsage | undefined;
  let lastMessage: string | undefined;
  let resultObj: any | undefined;   // captured `result` event; drives the status decision

  // Bridge readline 'line' / process 'close' callbacks to an async iterator.
  const queue: ClaudeEvent[] = [];
  let resolveNext: ((r: IteratorResult<ClaudeEvent>) => void) | null = null;
  let finished = false;

  const emit = (ev: ClaudeEvent) => {
    if (ev.kind === "usage") {
      usage = ev;
    }
    if (ev.kind === "message") {
      lastMessage = ev.text;
    }
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r({ value: ev, done: false });
    } else {
      queue.push(ev);
    }
  };

  const finishIter = () => {
    finished = true;
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r({ value: undefined as unknown as ClaudeEvent, done: true });
    }
  };

  const rl = readline.createInterface({ input: child.stdout! });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      return;   // non-JSON line (shouldn't happen with stream-json, but be safe)
    }
    if (obj?.type === "result") {
      resultObj = obj;
    }
    for (const ev of mapClaudeLine(obj)) {
      emit(ev);
    }
  });

  let settled = false;
  const result = new Promise<ClaudeResult>((resolve) => {
    const settle = (exitCode: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      rl.close();
      finishIter();
      const resultText = typeof resultObj?.result === "string" ? resultObj.result : "";
      const finalMessage = lastMessage ?? (resultText || undefined);
      if (cancelled) {
        resolve({ status: "cancelled", reason: "cancelled by caller", usage, lastMessage: finalMessage });
      } else if (exitCode === 0 && resultObj && resultObj.is_error === false) {
        // ponytail: success requires is_error===false, NOT subtype==='success'.
        resolve({ status: "success", usage, lastMessage: finalMessage });
      } else {
        resolve({
          status: "failed",
          reason: resultText || stderr.trim() || `claude exited with code ${exitCode}`,
          errorClass: classifyError(`${resultText}\n${stderr}`),
          usage,
          lastMessage: finalMessage,
        });
      }
    };
    child.on("error", (err) => {
      stderr += String(err.message);
      settle(null);
    });
    child.on("close", (code) => settle(code));
  });

  const iterator: AsyncIterator<ClaudeEvent> = {
    next() {
      if (queue.length) {
        return Promise.resolve({ value: queue.shift()!, done: false });
      }
      if (finished) {
        return Promise.resolve({ value: undefined as unknown as ClaudeEvent, done: true });
      }
      return new Promise((r) => {
        resolveNext = r;
      });
    },
  };

  return {
    cancel() {
      cancelled = true;
      child.kill("SIGTERM");
    },
    result,
    [Symbol.asyncIterator]() {
      return iterator;
    },
  };
}
```

- [ ] **Step 4: Run the fast tests to verify they pass**

Run: `npm test`
Expected: PASS — `claude adapter (fake CLI)` suite green; the real-CLI suite shows as **pending/skipped** (`CLAUDE_E2E` unset).

- [ ] **Step 5: Run the real-CLI proof**

Run: `CLAUDE_E2E=1 npm test`
Expected: PASS — `happy path: reply pong -> success` and `cancel mid-run -> cancelled` green (slow; uses claude quota). Requires `claude` logged in for the default model.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/claude/claude-adapter.ts src/test/claude-adapter.integration.test.ts
git commit -m "feat: runClaude adapter — spawn claude stream-json, typed event stream, terminal result"
```

---

## US-2: Test Claude webview smoke UI

A manual **Test Claude** button and **Claude log** panel in the existing `hello` webview that streams a real `runClaude` run's events as log lines. Proves the adapter inside the extension surface. Vertical slice across the postMessage protocol, the host bridge, the extension handler, and the React view.

### Task 4: Protocol messages + webview bridge

**Files:**
- Modify: `src/webview/protocol.ts`
- Create: `src/adapters/claude/webview-bridge.ts`
- Test: `src/test/claude-webview-bridge.test.ts`

**Interfaces:**
- Consumes: `runClaude`, `ClaudeRun`, `RunOpts` from `./claude-adapter` (Task 3); `ClaudeEvent` from `./events` (Task 1).
- Produces: `WebviewToExtension` gains `{ type: "testClaude" }`; `ExtensionToWebview` gains `{ type: "claudeLog"; level: "info" | "error"; text: string }`; `streamClaudeTestToWebview(webview, cwd, runner?): Promise<void>`.

- [ ] **Step 1: Add the protocol message types**

Modify `src/webview/protocol.ts` to add the two claude message variants (alongside the existing codex/agy ones):

```ts
// Messages shared by the extension host and the webview. Imported by both
// sides so the postMessage contract is checked at compile time.

export type WebviewToExtension =
  | { type: "ready" }
  | { type: "hello"; name: string }
  | { type: "testCodex" }
  | { type: "testAgy" }
  | { type: "testClaude" };

export type ExtensionToWebview =
  | { type: "greeting"; text: string }
  | { type: "codexLog"; level: "info" | "error"; text: string }
  | { type: "agyLog"; level: "info" | "error"; text: string }
  | { type: "claudeLog"; level: "info" | "error"; text: string };
```

- [ ] **Step 2: Write the failing test**

Create `src/test/claude-webview-bridge.test.ts`:

```ts
import * as assert from "assert";
import { streamClaudeTestToWebview } from "../adapters/claude/webview-bridge";
import type { ClaudeEvent, ClaudeResult } from "../adapters/claude/events";
import type { ExtensionToWebview } from "../webview/protocol";

suite("streamClaudeTestToWebview", () => {
  test("posts claude events and final result as webview log messages", async () => {
    const posted: ExtensionToWebview[] = [];
    const events: ClaudeEvent[] = [
      { kind: "started", sessionId: "s1", model: "claude-x" },
      { kind: "thinking", text: "hmm" },
      { kind: "tool_call", name: "Bash", input: { cmd: "ls" } },
      { kind: "message", text: "pong" },
      { kind: "usage", inputTokens: 10, outputTokens: 2, cacheCreationInputTokens: 0, cacheReadInputTokens: 5, costUsd: 0.01 },
    ];
    const result: ClaudeResult = { status: "success", lastMessage: "pong" };

    await streamClaudeTestToWebview(
      {
        postMessage: (msg) => {
          posted.push(msg);
          return true;
        },
      },
      "/tmp",
      () => ({
        cancel() {},
        result: Promise.resolve(result),
        async *[Symbol.asyncIterator]() {
          yield* events;
        },
      })
    );

    assert.deepStrictEqual(posted, [
      { type: "claudeLog", level: "info", text: "Starting Claude test..." },
      { type: "claudeLog", level: "info", text: "started session s1 (claude-x)" },
      { type: "claudeLog", level: "info", text: "thinking: hmm" },
      { type: "claudeLog", level: "info", text: "tool Bash" },
      { type: "claudeLog", level: "info", text: "pong" },
      { type: "claudeLog", level: "info", text: "usage in=10 out=2 cacheW=0 cacheR=5 cost=$0.01" },
      { type: "claudeLog", level: "info", text: "done success" },
    ]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../adapters/claude/webview-bridge`.

- [ ] **Step 4: Write minimal implementation**

Create `src/adapters/claude/webview-bridge.ts` (mirrors `codex/webview-bridge.ts`):

```ts
import { runClaude, type ClaudeRun, type RunOpts } from "./claude-adapter";
import type { ClaudeEvent } from "./events";
import type { ExtensionToWebview } from "../../webview/protocol";

interface LogWebview {
  postMessage(msg: ExtensionToWebview): boolean | PromiseLike<boolean>;
}

type ClaudeRunner = (opts: RunOpts) => ClaudeRun;

async function postLog(webview: LogWebview, level: "info" | "error", text: string): Promise<void> {
  await webview.postMessage({ type: "claudeLog", level, text });
}

function formatEvent(ev: ClaudeEvent): string | null {
  switch (ev.kind) {
    case "started":
      return `started session ${ev.sessionId} (${ev.model})`;
    case "message":
      return ev.text;
    case "thinking":
      return `thinking: ${ev.text}`;
    case "tool_call":
      return `tool ${ev.name}`;
    case "usage": {
      const cost = ev.costUsd === undefined ? "" : ` cost=$${ev.costUsd}`;
      return `usage in=${ev.inputTokens} out=${ev.outputTokens} cacheW=${ev.cacheCreationInputTokens} cacheR=${ev.cacheReadInputTokens}${cost}`;
    }
    case "unknown":
      return null;
  }
}

export async function streamClaudeTestToWebview(
  webview: LogWebview,
  cwd: string,
  runner: ClaudeRunner = runClaude
): Promise<void> {
  await postLog(webview, "info", "Starting Claude test...");

  const run = runner({
    prompt: "Reply with exactly the word: pong",
    cwd,
  });

  try {
    for await (const ev of run) {
      const text = formatEvent(ev);
      if (text) {
        await postLog(webview, "info", text);
      }
    }

    const result = await run.result;
    if (result.status === "success") {
      await postLog(webview, "info", "done success");
    } else {
      await postLog(webview, "error", `done ${result.status}: ${result.reason ?? "unknown error"}`);
    }
  } catch (err) {
    await postLog(webview, "error", err instanceof Error ? err.message : String(err));
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS — `streamClaudeTestToWebview` suite green; all earlier suites still green.

- [ ] **Step 6: Commit**

```bash
git add src/webview/protocol.ts src/adapters/claude/webview-bridge.ts src/test/claude-webview-bridge.test.ts
git commit -m "feat: claude webview bridge + testClaude/claudeLog protocol messages"
```

### Task 5: Wire the Test Claude button into the extension host and React view

**Files:**
- Modify: `src/webview/panel.ts`
- Modify: `src/integration/hello.tsx`

**Interfaces:**
- Consumes: `streamClaudeTestToWebview` from `../adapters/claude/webview-bridge` (Task 4); `testClaude`/`claudeLog` protocol messages (Task 4).
- Produces: no new exports — this is the UI wiring that closes the slice. Manual smoke test.

- [ ] **Step 1: Handle `testClaude` in the extension host**

Modify `src/webview/panel.ts` — add the import alongside the existing bridge imports:

```ts
import { streamAgyTestToWebview } from "../adapters/agy/webview-bridge";
import { streamClaudeTestToWebview } from "../adapters/claude/webview-bridge";
import { streamCodexTestToWebview } from "../adapters/codex/webview-bridge";
```

Inside the `webview.onDidReceiveMessage` callback, after the existing `testAgy` branch:

```ts
      if (msg.type === "testClaude") {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? context.extensionUri.fsPath;
        void streamClaudeTestToWebview(webview, cwd);
      }
```

- [ ] **Step 2: Add the Test Claude button + Claude log panel in the React view**

Modify `src/integration/hello.tsx` — add claude state, handle `claudeLog`, add a button and a log panel. Replace the component body so it carries codex, agy, and claude logs:

```tsx
import { useEffect, useState } from "react";
import { TerminalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { onMessage, postMessage } from "@/lib/vscode";

interface LogLine {
  level: "info" | "error";
  text: string;
}

export function HelloView() {
  const [reply, setReply] = useState("");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);
  const [agyLogs, setAgyLogs] = useState<LogLine[]>([]);
  const [agyRunning, setAgyRunning] = useState(false);
  const [claudeLogs, setClaudeLogs] = useState<LogLine[]>([]);
  const [claudeRunning, setClaudeRunning] = useState(false);

  useEffect(
    () =>
      onMessage((msg) => {
        if (msg.type === "greeting") {
          setReply(msg.text);
        }
        if (msg.type === "codexLog") {
          setLogs((current) => [...current, { level: msg.level, text: msg.text }]);
          if (msg.level === "error" || msg.text.startsWith("done ")) {
            setRunning(false);
          }
        }
        if (msg.type === "agyLog") {
          setAgyLogs((current) => [...current, { level: msg.level, text: msg.text }]);
          if (msg.level === "error" || msg.text.startsWith("done ")) {
            setAgyRunning(false);
          }
        }
        if (msg.type === "claudeLog") {
          setClaudeLogs((current) => [...current, { level: msg.level, text: msg.text }]);
          if (msg.level === "error" || msg.text.startsWith("done ")) {
            setClaudeRunning(false);
          }
        }
      }),
    []
  );

  const testCodex = () => {
    setReply("");
    setLogs([]);
    setRunning(true);
    postMessage({ type: "testCodex" });
  };

  const testAgy = () => {
    setAgyLogs([]);
    setAgyRunning(true);
    postMessage({ type: "testAgy" });
  };

  const testClaude = () => {
    setClaudeLogs([]);
    setClaudeRunning(true);
    postMessage({ type: "testClaude" });
  };

  const renderLog = (lines: LogLine[], emptyHint: string) => (
    <div className="flex min-h-32 flex-col gap-1 whitespace-pre-wrap break-words">
      {lines.length === 0 ? (
        <span className="text-muted-foreground">{emptyHint}</span>
      ) : (
        lines.map((line, index) => (
          <div
            key={`${line.text}-${index}`}
            className={line.level === "error" ? "text-destructive" : "text-foreground"}
          >
            {line.text}
          </div>
        ))
      )}
    </div>
  );

  return (
    <div className="p-4 flex max-w-3xl flex-col gap-4 items-start">
      <h1 className="text-lg font-semibold">Skynet Webview</h1>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => postMessage({ type: "hello", name: "Skynet" })}>
          Say hello to the extension
        </Button>
        <Button onClick={testCodex} disabled={running} variant="secondary">
          <TerminalIcon />
          {running ? "Testing Codex..." : "Test Codex"}
        </Button>
        <Button onClick={testAgy} disabled={agyRunning} variant="secondary">
          <TerminalIcon />
          {agyRunning ? "Testing Antigravity..." : "Test Agy"}
        </Button>
        <Button onClick={testClaude} disabled={claudeRunning} variant="secondary">
          <TerminalIcon />
          {claudeRunning ? "Testing Claude..." : "Test Claude"}
        </Button>
      </div>
      {reply && <p>{reply}</p>}
      <div className="w-full rounded-md border bg-muted/30 p-3 font-mono text-xs">
        <div className="mb-2 font-sans text-sm font-medium">Codex log</div>
        {renderLog(logs, "Click Test Codex to stream logs here.")}
      </div>
      <div className="w-full rounded-md border bg-muted/30 p-3 font-mono text-xs">
        <div className="mb-2 font-sans text-sm font-medium">Agy log</div>
        {renderLog(agyLogs, "Click Test Agy to stream logs here.")}
      </div>
      <div className="w-full rounded-md border bg-muted/30 p-3 font-mono text-xs">
        <div className="mb-2 font-sans text-sm font-medium">Claude log</div>
        {renderLog(claudeLogs, "Click Test Claude to stream logs here.")}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Compile and run the full suite**

Run: `npm test`
Expected: PASS — all suites green (the `pretest` step runs `compile-tests`, `compile`, and `lint`, so a type error or lint failure in the wiring fails here).

- [ ] **Step 4: Manual smoke test**

Run the extension (F5 / Run Extension), open the command `skynet-harness.test.openWebview`, click **Test Claude**.
Expected: the **Claude log** panel streams `Starting Claude test...`, a `started session ...` line, one or more text lines from the agent, a `usage ...` line, then `done success`. The button is disabled while running and re-enables on `done`/error.

- [ ] **Step 5: Commit**

```bash
git add src/webview/panel.ts src/integration/hello.tsx
git commit -m "feat: Test Claude button + Claude log panel in hello webview"
```

---

## Self-Review Notes

- **Spec coverage:** invocation/flags (`-p`, `stream-json`, `--verbose`, `--model`, `--permission-mode`, `--allowedTools`, `--add-dir`, prompt-after-`-p`) → Task 3 (Global Constraints + `runClaude` args); rich `mapClaudeLine` fan-out (init→started, content blocks→message/thinking/tool_call, usage, result→usage+cost, hook noise→unknown) → Task 1; `ClaudeEvent`/`ClaudeResult`/`ClaudeUsage` full rich set → Task 1; success gated on `is_error===false` (subtype-lies gotcha) → Task 3; classify on `result.result`+stderr → Tasks 2–3; `classifyError` verbatim copy + 3rd-consumer extraction-trigger note → Task 2; webview smoke UI (Test Claude button, Claude log, fake-run test) → Tasks 4–5; happy/cancel/classify/mapClaudeLine/bridge proofs → Tasks 1–4; hook-noise-skipping proof → Task 3 happy test asserts an `unknown` event surfaces.
- **Type consistency:** `runClaude`/`RunOpts`/`ClaudeRun`/`ClaudeResult`/`ClaudeEvent`/`ClaudeUsage`/`mapClaudeLine`/`classifyError`/`streamClaudeTestToWebview`/`testClaude`/`claudeLog` used identically across tasks. `mapClaudeLine` returns `ClaudeEvent[]` everywhere (the one divergence from codex/agy's single-or-null mapper — the adapter loops the array).
- **Out of scope (no task, intentional):** shared `AgentAdapter`/`WorkerEvent`, shared `classifyError` extraction, fallback/retry, step-function panel, multi-turn/resume, `--json-schema`, `--input-format stream-json`, images, soul injection.
