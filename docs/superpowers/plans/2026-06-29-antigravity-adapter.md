# Antigravity (agy) Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone, concrete TypeScript adapter that runs a task through the antigravity CLI (`agy --print`) and turns its plain-text output into a typed, observable event stream with a clear terminal status, plus a manual webview smoke UI to prove it.

**Architecture:** Mirror the existing codex adapter (`src/adapters/codex/`) file-for-file in a new `src/adapters/agy/` directory: `events.ts` (typed events + line parser), `classify.ts` (error heuristic, copied verbatim from codex), `agy-adapter.ts` (`runAgy` — spawns the child, exposes an async iterator + `result` promise), `webview-bridge.ts` (formats events as log lines). The CLI emits **plain text only**, so the event type carries the full target shape (`started`/`thought`/`tool_call`/`usage`) but only `message` is populated today; the rest are forward-compat stubs for a future Python-SDK sidecar.

**Tech Stack:** TypeScript, Node `child_process`/`readline`, VSCode extension host + React webview, `vscode-test`/mocha test runner (`suite`/`test`, node `assert`).

## Global Constraints

- **Verified ground truth:** `agy 1.0.13`. Non-interactive invocation: `agy --print [--dangerously-skip-permissions] [--sandbox] [--model <m>] --add-dir <cwd> "<prompt>"`. Output is **plain markdown text on stdout**, exit 0 on success. No `--json`, no usage, no thread id, no per-event stream.
- **Headless safety:** `--dangerously-skip-permissions` is mandatory headless (else the agent blocks on approval prompts); `--sandbox` restricts FS. Both default **on** in `RunOpts`.
- **No `-C` flag:** set the child working directory via the spawn `cwd` option and pass `--add-dir <cwd>`.
- **stdin `'ignore'`** on the spawned child (anti-block discipline mirrored from codex).
- **No shared types yet:** the adapter stays concrete and agy-specific. `classifyError` is **copied verbatim** from `src/adapters/codex/classify.ts` (this is the documented extraction trigger, but the extraction is a separate US).
- **Success rule:** agy has no `turn.completed` equivalent, so `success` = clean exit (code 0). `usage` is always `undefined` today.
- **Tests:** live in `src/test/`, compiled by `npm run compile-tests`, run with `npm test` (vscode-test/mocha). The real-CLI integration test is gated behind `process.env.AGY_E2E` so a normal `npm test` does not consume quota.

---

## US-1: Antigravity adapter

A working, tested `runAgy(opts)` that streams typed events from `agy --print` and resolves a terminal `AgyResult`. Usable end-to-end via tests (fake-CLI fast path + real-CLI gated path); no UI required.

### Task 1: Event types + stdout line parser

**Files:**
- Create: `src/adapters/agy/events.ts`
- Test: `src/test/agy-events.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `AgyUsage`, `ErrorClass`, `AgyEvent`, `AgyResult` types; `mapAgyLine(line: string): AgyEvent | null`.

- [ ] **Step 1: Write the failing test**

Create `src/test/agy-events.test.ts`:

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
  test("JSON thread.started -> started", () => {
    assert.deepStrictEqual(
      mapAgyLine('{"type":"thread.started","thread_id":"abc"}'),
      { kind: "started", threadId: "abc" });
  });

  test("JSON tool_call -> tool_call", () => {
    assert.deepStrictEqual(
      mapAgyLine('{"type":"tool_call","name":"run_command","args":{"cmd":"ls"}}'),
      { kind: "tool_call", name: "run_command", args: { cmd: "ls" } });
  });

  test("JSON thought -> thought", () => {
    assert.deepStrictEqual(
      mapAgyLine('{"type":"thought","text":"hmm"}'),
      { kind: "thought", text: "hmm" });
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

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../adapters/agy/events`.

- [ ] **Step 3: Write minimal implementation**

Create `src/adapters/agy/events.ts`:

```ts
export interface AgyUsage {
  inputTokens: number;
  outputTokens: number;
}

export type ErrorClass = "limit" | "transport" | "terminal";

export type AgyEvent =
  | { kind: "started"; threadId: string }              // STUB: --print emits no thread id. TODO (SDK)
  | { kind: "message"; text: string }                   // REAL: a line of stdout
  | { kind: "thought"; text: string }                   // STUB: SDK response.thoughts. TODO
  | { kind: "tool_call"; name: string; args: unknown }  // STUB: SDK response.tool_calls. TODO
  | ({ kind: "usage" } & AgyUsage)                      // STUB: SDK / `/usage`. TODO
  | { kind: "unknown"; raw: unknown };

export interface AgyResult {
  status: "success" | "failed" | "cancelled";
  reason?: string;
  errorClass?: ErrorClass;
  usage?: AgyUsage;        // always undefined today (stub)
  lastMessage?: string;    // accumulated stdout text
}

// Map one agy stdout line to an AgyEvent.
// Today agy prints plain markdown -> every non-blank line becomes a `message`.
// The JSON branch is a forward-compat STUB: if a future agy (or the SDK sidecar)
// emits structured JSONL, these branches light up without a parser rewrite.
export function mapAgyLine(line: string): AgyEvent | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  let obj: any;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return { kind: "message", text: trimmed }; // the only path hit today
  }

  // ponytail: structured branches below are dormant until the SDK upgrade path
  // lands; they exist so that swap is a backend change, not a parser rewrite.
  switch (obj?.type) {
    case "thread.started":
      return { kind: "started", threadId: String(obj.thread_id ?? "") };
    case "tool_call":
      return { kind: "tool_call", name: String(obj.name ?? ""), args: obj.args };
    case "thought":
      return { kind: "thought", text: String(obj.text ?? "") };
    case "usage":
      return { kind: "usage", inputTokens: obj.input_tokens ?? 0, outputTokens: obj.output_tokens ?? 0 };
    default:
      return { kind: "unknown", raw: obj };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — `mapAgyLine` suite green.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/agy/events.ts src/test/agy-events.test.ts
git commit -m "feat: agy adapter event types + stdout line parser"
```

### Task 2: Error classifier

**Files:**
- Create: `src/adapters/agy/classify.ts`
- Test: `src/test/agy-classify.test.ts`

**Interfaces:**
- Consumes: `ErrorClass` from `./events` (Task 1).
- Produces: `classifyError(stderr: string): ErrorClass`.

- [ ] **Step 1: Write the failing test**

Create `src/test/agy-classify.test.ts`:

```ts
import * as assert from "assert";
import { classifyError } from "../adapters/agy/classify";

suite("classifyError (agy)", () => {
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

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../adapters/agy/classify`.

- [ ] **Step 3: Write minimal implementation**

Create `src/adapters/agy/classify.ts` (copied verbatim from `src/adapters/codex/classify.ts`):

```ts
import type { ErrorClass } from "./events";

const LIMIT = /rate.?limit|429|quota|too many requests/i;
const TRANSPORT = /network|econn|etimedout|timeout|socket|dns|enotfound/i;

// ponytail: classify.ts is now duplicated across codex + agy. This is the second
// consumer — the explicit trigger to extract a shared classifier in the
// "Error classification" US. Not extracted here, to keep this adapter standalone.
// ponytail: heuristic stderr patterns are inherited from codex and unverified
// against real agy limit/transport output. Refine on first real capture.
export function classifyError(stderr: string): ErrorClass {
  if (LIMIT.test(stderr)) {
    return "limit";
  }
  if (TRANSPORT.test(stderr)) {
    return "transport";
  }
  return "terminal";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — `classifyError (agy)` suite green.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/agy/classify.ts src/test/agy-classify.test.ts
git commit -m "feat: agy adapter error classifier (copied from codex)"
```

### Task 3: runAgy adapter + fake-CLI and real-CLI proof

**Files:**
- Create: `src/adapters/agy/agy-adapter.ts`
- Test: `src/test/agy-adapter.integration.test.ts`

**Interfaces:**
- Consumes: `mapAgyLine`, `AgyEvent`, `AgyResult` from `./events` (Task 1); `classifyError` from `./classify` (Task 2).
- Produces: `RunOpts { prompt: string; cwd: string; model?: string; sandbox?: boolean; skipPermissions?: boolean }`; `AgyRun extends AsyncIterable<AgyEvent> { cancel(): void; result: Promise<AgyResult> }`; `runAgy(opts: RunOpts): AgyRun`.

- [ ] **Step 1: Write the failing test**

Create `src/test/agy-adapter.integration.test.ts`. The fast tests use a fake `agy` script on `PATH` (no quota); the real-CLI tests are gated behind `AGY_E2E`:

```ts
import * as assert from "assert";
import * as fs from "node:fs/promises";
import * as os from "os";
import * as path from "node:path";
import { runAgy } from "../adapters/agy/agy-adapter";
import type { AgyEvent } from "../adapters/agy/events";

async function withFakeAgy(script: string, fn: () => Promise<void>): Promise<void> {
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), "fake-agy-"));
  const agyPath = path.join(binDir, "agy");
  await fs.writeFile(agyPath, script);
  await fs.chmod(agyPath, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${oldPath ?? ""}`;
  try {
    await fn();
  } finally {
    process.env.PATH = oldPath;
    await fs.rm(binDir, { recursive: true, force: true });
  }
}

suite("agy adapter (fake CLI)", () => {
  test("exit 0 with text -> success, message streamed, lastMessage accumulated", async () => {
    await withFakeAgy("#!/bin/sh\nprintf '%s\\n' 'pong'\nexit 0\n", async () => {
      const run = runAgy({ prompt: "ignored", cwd: os.tmpdir() });
      const events: AgyEvent[] = [];
      for await (const ev of run) {
        events.push(ev);
      }
      const result = await run.result;
      assert.strictEqual(result.status, "success");
      assert.ok(events.some((e) => e.kind === "message"), "a message event streamed");
      assert.ok((result.lastMessage ?? "").includes("pong"), "lastMessage has pong");
      assert.strictEqual(result.usage, undefined, "no usage from --print");
    });
  });

  test("exit 1 with rate-limit stderr -> failed + errorClass limit", async () => {
    await withFakeAgy("#!/bin/sh\necho '429 rate limit' 1>&2\nexit 1\n", async () => {
      const run = runAgy({ prompt: "ignored", cwd: os.tmpdir() });
      for await (const _ of run) {
        // drain
      }
      const result = await run.result;
      assert.strictEqual(result.status, "failed");
      assert.strictEqual(result.errorClass, "limit");
    });
  });
});

const describe = process.env.AGY_E2E ? suite : suite.skip;

describe("agy adapter (real CLI, slow — set AGY_E2E=1)", function () {
  this.timeout(120_000);

  test("happy path: reply pong -> success", async () => {
    const run = runAgy({ prompt: "Reply with exactly the word: pong", cwd: os.tmpdir() });
    const events: AgyEvent[] = [];
    for await (const ev of run) {
      events.push(ev);
    }
    const result = await run.result;
    assert.strictEqual(result.status, "success");
    assert.ok((result.lastMessage ?? "").toLowerCase().includes("pong"), "agent said pong");
    assert.ok(events.some((e) => e.kind === "message"), "a message event streamed");
  });

  test("cancel mid-run -> cancelled", async () => {
    const run = runAgy({
      prompt: "Count slowly from 1 to 200, one number per line.",
      cwd: os.tmpdir(),
    });
    for await (const ev of run) {
      if (ev.kind === "message") {
        run.cancel();
      }
    }
    const result = await run.result;
    assert.strictEqual(result.status, "cancelled");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../adapters/agy/agy-adapter`.

- [ ] **Step 3: Write minimal implementation**

Create `src/adapters/agy/agy-adapter.ts` (async-iterator plumbing copied from `codex-adapter.ts`; success = exit 0; `lastMessage` accumulates message text):

```ts
import { spawn } from "node:child_process";
import * as readline from "node:readline";
import { classifyError } from "./classify";
import { mapAgyLine, type AgyEvent, type AgyResult } from "./events";

export interface RunOpts {
  prompt: string;
  cwd: string;
  model?: string;
  sandbox?: boolean;          // default true
  skipPermissions?: boolean;  // default true
}

/**
 * Async iterator is single-consumer: create one `for await` loop per run.
 * Concurrent iteration shares one internal event queue and is not supported.
 */
export interface AgyRun extends AsyncIterable<AgyEvent> {
  cancel(): void;
  result: Promise<AgyResult>;
}

export function runAgy(opts: RunOpts): AgyRun {
  const args = ["--print"];
  if (opts.skipPermissions ?? true) {
    args.push("--dangerously-skip-permissions");
  }
  if (opts.sandbox ?? true) {
    args.push("--sandbox");
  }
  if (opts.model) {
    args.push("--model", opts.model);
  }
  args.push("--add-dir", opts.cwd);
  args.push(opts.prompt);

  // stdin 'ignore' mirrors codex's anti-block discipline (correct for headless agy).
  // No -C flag on agy → set the working directory via the spawn cwd option.
  const child = spawn("agy", args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });

  let stderr = "";
  child.stderr?.on("data", (d) => {
    stderr += d.toString();
  });

  let cancelled = false;
  const messages: string[] = [];

  // Bridge readline 'line' / process 'close' callbacks to an async iterator.
  const queue: AgyEvent[] = [];
  let resolveNext: ((r: IteratorResult<AgyEvent>) => void) | null = null;
  let finished = false;

  const emit = (ev: AgyEvent) => {
    if (ev.kind === "message") {
      messages.push(ev.text);
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
      r({ value: undefined as unknown as AgyEvent, done: true });
    }
  };

  const rl = readline.createInterface({ input: child.stdout! });
  rl.on("line", (line) => {
    const ev = mapAgyLine(line);
    if (ev) {
      emit(ev);
    }
  });

  let settled = false;
  const result = new Promise<AgyResult>((resolve) => {
    const settle = (exitCode: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      rl.close();
      finishIter();
      const lastMessage = messages.length ? messages.join("\n") : undefined;
      if (cancelled) {
        resolve({ status: "cancelled", reason: "cancelled by caller", lastMessage });
      } else if (exitCode === 0) {
        // ponytail: agy has no turn.completed marker, so success = clean exit (0).
        resolve({ status: "success", lastMessage });
      } else {
        resolve({
          status: "failed",
          reason: stderr.trim() || `agy exited with code ${exitCode}`,
          errorClass: classifyError(stderr),
          lastMessage,
        });
      }
    };
    child.on("error", (err) => {
      stderr += String(err.message);
      settle(null);
    });
    child.on("close", (code) => settle(code));
  });

  const iterator: AsyncIterator<AgyEvent> = {
    next() {
      if (queue.length) {
        return Promise.resolve({ value: queue.shift()!, done: false });
      }
      if (finished) {
        return Promise.resolve({ value: undefined as unknown as AgyEvent, done: true });
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
Expected: PASS — `agy adapter (fake CLI)` suite green; the real-CLI suite shows as **pending/skipped** (`AGY_E2E` unset).

- [ ] **Step 5: Run the real-CLI proof**

Run: `AGY_E2E=1 npm test`
Expected: PASS — `happy path: reply pong -> success` and `cancel mid-run -> cancelled` green (slow; uses agy quota). Requires `agy` logged in (`agy` was verified authenticated as of 2026-06-29).

- [ ] **Step 6: Commit**

```bash
git add src/adapters/agy/agy-adapter.ts src/test/agy-adapter.integration.test.ts
git commit -m "feat: runAgy adapter — spawn agy --print, typed event stream, terminal result"
```

---

## US-2: Test Agy webview smoke UI

A manual **Test Agy** button and **Agy log** panel in the existing `hello` webview that streams a real `runAgy` run's events as log lines. Proves the adapter inside the extension surface. Vertical slice across the postMessage protocol, the host bridge, the extension handler, and the React view.

### Task 4: Protocol messages + webview bridge

**Files:**
- Modify: `src/webview/protocol.ts`
- Create: `src/adapters/agy/webview-bridge.ts`
- Test: `src/test/agy-webview-bridge.test.ts`

**Interfaces:**
- Consumes: `runAgy`, `AgyRun`, `RunOpts` from `./agy-adapter` (Task 3); `AgyEvent` from `./events` (Task 1).
- Produces: `WebviewToExtension` gains `{ type: "testAgy" }`; `ExtensionToWebview` gains `{ type: "agyLog"; level: "info" | "error"; text: string }`; `streamAgyTestToWebview(webview, cwd, runner?): Promise<void>`.

- [ ] **Step 1: Add the protocol message types**

Modify `src/webview/protocol.ts` to add the two agy message variants:

```ts
// Messages shared by the extension host and the webview. Imported by both
// sides so the postMessage contract is checked at compile time.

export type WebviewToExtension =
  | { type: "ready" }
  | { type: "hello"; name: string }
  | { type: "testCodex" }
  | { type: "testAgy" };

export type ExtensionToWebview =
  | { type: "greeting"; text: string }
  | { type: "codexLog"; level: "info" | "error"; text: string }
  | { type: "agyLog"; level: "info" | "error"; text: string };
```

- [ ] **Step 2: Write the failing test**

Create `src/test/agy-webview-bridge.test.ts`:

```ts
import * as assert from "assert";
import { streamAgyTestToWebview } from "../adapters/agy/webview-bridge";
import type { AgyEvent, AgyResult } from "../adapters/agy/events";
import type { ExtensionToWebview } from "../webview/protocol";

suite("streamAgyTestToWebview", () => {
  test("posts agy events and final result as webview log messages", async () => {
    const posted: ExtensionToWebview[] = [];
    const events: AgyEvent[] = [
      { kind: "started", threadId: "abc" },
      { kind: "message", text: "pong" },
      { kind: "tool_call", name: "run_command", args: { cmd: "ls" } },
    ];
    const result: AgyResult = { status: "success", lastMessage: "pong" };

    await streamAgyTestToWebview(
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
      { type: "agyLog", level: "info", text: "Starting Antigravity test..." },
      { type: "agyLog", level: "info", text: "started thread abc" },
      { type: "agyLog", level: "info", text: "pong" },
      { type: "agyLog", level: "info", text: "tool run_command" },
      { type: "agyLog", level: "info", text: "done success" },
    ]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../adapters/agy/webview-bridge`.

- [ ] **Step 4: Write minimal implementation**

Create `src/adapters/agy/webview-bridge.ts` (mirrors `codex/webview-bridge.ts`):

```ts
import { runAgy, type AgyRun, type RunOpts } from "./agy-adapter";
import type { AgyEvent } from "./events";
import type { ExtensionToWebview } from "../../webview/protocol";

interface LogWebview {
  postMessage(msg: ExtensionToWebview): boolean | PromiseLike<boolean>;
}

type AgyRunner = (opts: RunOpts) => AgyRun;

async function postLog(webview: LogWebview, level: "info" | "error", text: string): Promise<void> {
  await webview.postMessage({ type: "agyLog", level, text });
}

function formatEvent(ev: AgyEvent): string | null {
  switch (ev.kind) {
    case "started":
      return `started thread ${ev.threadId}`;
    case "message":
      return ev.text;
    case "thought":
      return `thinking: ${ev.text}`;
    case "tool_call":
      return `tool ${ev.name}`;
    case "usage":
      return `usage input=${ev.inputTokens} output=${ev.outputTokens}`;
    case "unknown":
      return null;
  }
}

export async function streamAgyTestToWebview(
  webview: LogWebview,
  cwd: string,
  runner: AgyRunner = runAgy
): Promise<void> {
  await postLog(webview, "info", "Starting Antigravity test...");

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
Expected: PASS — `streamAgyTestToWebview` suite green; all earlier suites still green.

- [ ] **Step 6: Commit**

```bash
git add src/webview/protocol.ts src/adapters/agy/webview-bridge.ts src/test/agy-webview-bridge.test.ts
git commit -m "feat: agy webview bridge + testAgy/agyLog protocol messages"
```

### Task 5: Wire the Test Agy button into the extension host and React view

**Files:**
- Modify: `src/webview/panel.ts`
- Modify: `src/integration/hello.tsx`

**Interfaces:**
- Consumes: `streamAgyTestToWebview` from `../adapters/agy/webview-bridge` (Task 4); `testAgy`/`agyLog` protocol messages (Task 4).
- Produces: no new exports — this is the UI wiring that closes the slice. Manual smoke test.

- [ ] **Step 1: Handle `testAgy` in the extension host**

Modify `src/webview/panel.ts` — add the import and a handler branch alongside the existing `testCodex` branch:

```ts
import { streamCodexTestToWebview } from "../adapters/codex/webview-bridge";
import { streamAgyTestToWebview } from "../adapters/agy/webview-bridge";
```

Inside the `webview.onDidReceiveMessage` callback, after the existing `testCodex` branch:

```ts
      if (msg.type === "testAgy") {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? context.extensionUri.fsPath;
        void streamAgyTestToWebview(webview, cwd);
      }
```

- [ ] **Step 2: Add the Test Agy button + Agy log panel in the React view**

Modify `src/integration/hello.tsx` — add agy state, handle `agyLog`, add a button and a log panel. Replace the component body so it carries both codex and agy logs:

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
    </div>
  );
}
```

- [ ] **Step 3: Compile and run the full suite**

Run: `npm test`
Expected: PASS — all suites green (the `pretest` step runs `compile-tests`, `compile`, and `lint`, so a type error or lint failure in the wiring fails here).

- [ ] **Step 4: Manual smoke test**

Run the extension (F5 / Run Extension), open the command `skynet-harness.test.openWebview`, click **Test Agy**.
Expected: the **Agy log** panel streams `Starting Antigravity test...`, one or more text lines from the agent, then `done success`. The button is disabled while running and re-enables on `done`/error.

- [ ] **Step 5: Commit**

```bash
git add src/webview/panel.ts src/integration/hello.tsx
git commit -m "feat: Test Agy button + Agy log panel in hello webview"
```

---

## Self-Review Notes

- **Spec coverage:** invocation/flags → Task 3 (Global Constraints + `runAgy` args); plain-text `mapAgyLine` + dormant JSON stubs → Task 1; `AgyEvent`/`AgyResult` full target shape → Task 1; success=exit 0 + classify on failure → Task 3; `classifyError` verbatim copy + extraction-trigger note → Task 2; webview smoke UI (Test Agy button, Agy log, fake-run test) → Tasks 4–5; happy/cancel/classify/mapAgyLine/bridge proofs → Tasks 1–4; SDK sidecar upgrade path → documented in spec, intentionally out of scope (no task).
- **Type consistency:** `runAgy`/`RunOpts`/`AgyRun`/`AgyResult`/`AgyEvent`/`AgyUsage`/`mapAgyLine`/`classifyError`/`streamAgyTestToWebview`/`testAgy`/`agyLog` are used identically across tasks.
- **Stub honesty:** `usage`/`started`/`thought`/`tool_call` are typed and parser-mapped but never emitted by `--print`; tests exercise the parser branches (Task 1) and the bridge formatting (Task 4) so the SDK swap is verified before it ships.
