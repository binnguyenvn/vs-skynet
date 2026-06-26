# Worker — Epic 1: Codex Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run any task through the Codex CLI and watch clean, normalized streamed output — and cancel it.

**Architecture:** A host-side `src/worker/` module. A pure `AgentAdapter` (Codex) translates a `Worker` into a `codex exec --json` invocation and parses its JSONL event stream into normalized `WorkerEvent`s. A `runWorker` runner spawns the process, pipes its stdout through the adapter parser, streams events to a callback, and returns a cancel handle. The webview gets a minimal Worker view that posts `runTask`/`cancelTask` and renders streamed events. The webview never spawns processes or holds credentials — `panel.ts` (host) owns the runner.

**Tech Stack:** TypeScript, Node `child_process`, VS Code extension API, React 19 + shadcn/ui (webview), Mocha via `@vscode/test-cli` (`suite`/`test`/`assert`).

## Global Constraints

- **Verified Codex facts (codex-cli 0.142.2, confirmed against the installed binary — do NOT trust `docs/research/`):**
  - Invocation: `codex exec --json -s <mode> -C <dir> [-m <model>] --skip-git-repo-check "<task>"`
  - `--json` streams **JSONL**; one JSON object per line. Non-JSON noise lines also appear (e.g. `Reading additional input from stdin...`) — the parser MUST skip unparseable lines.
  - Event envelope is a **thread/turn/item** model: `{"type":"thread.started","thread_id":...}`, `{"type":"turn.started"}`, `{"type":"item.started","item":{...}}`, `{"type":"item.completed","item":{...}}`, `{"type":"turn.completed","usage":{...}}`. `turn.completed` is the terminal marker — there is **no** separate `done` event.
  - Item shapes: `agent_message` = `{id, type:"agent_message", text}`; `command_execution` = `{id, type:"command_execution", command, aggregated_output, exit_code, status}` (emitted as `item.started` then `item.completed`).
  - `-s/--sandbox` ∈ `{read-only, workspace-write, danger-full-access}`.
  - Closing stdin is required: if stdin stays open/piped, Codex blocks on `Reading additional input from stdin...`. Spawn with `stdio: ["ignore", "pipe", "pipe"]`.
- **No soul system in Epic 1** — the task string is passed through as the raw prompt. `Worker.soul` exists in the type but is ignored by the adapter (soul injection arrives in Epic 3).
- **Credentials = passthrough** — Codex uses its own existing `codex login` (`~/.codex/auth.json`). `Credentials` carries optional `env` only; no credential store is built (Epic 6).
- **Type files stay node-free.** `src/worker/types.ts` and `src/worker/adapters/types.ts` must import only types, so `src/webview/protocol.ts` can `import type` from them without pulling `child_process` into the webview bundle.
- Tests compile to `out/**/*.test.js` and run with `npm test`. Test files are colocated `*.test.ts` (pattern: `src/services/model-catalog.test.ts`).
- Type-check/lint gates: `npm run check-types` and `npm run lint` must pass.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/worker/types.ts` *(create)* | Domain model: `Worker`, `Agent`, `Harness`, `Soul`, enums. Node-free. |
| `src/worker/adapters/types.ts` *(create)* | `AgentAdapter` contract, `Invocation`, `Credentials`, `WorkerEvent`, `DecisionAsk`. Node-free. |
| `src/worker/adapters/codex.ts` *(create)* | `codexAdapter`: `buildInvocation` + `parseEvents` (JSONL → `WorkerEvent`). |
| `src/worker/adapters/codex.test.ts` *(create)* | Unit tests for `buildInvocation` + `parseEvents`. |
| `src/worker/runner.ts` *(create)* | `runWorker(worker, task, onEvent, deps?)`: spawn, stream, cancel, error mapping. Injectable `spawnFn`. |
| `src/worker/runner.test.ts` *(create)* | Unit tests (fake spawn) + guarded real-Codex integration test. |
| `src/webview/protocol.ts` *(modify)* | Add `runTask` / `cancelTask` / `taskEvent` messages. |
| `src/webview/panel.ts` *(modify)* | Route `runTask` → `runWorker`; track handles; `cancelTask` → cancel. |
| `src/webview/views/worker.tsx` *(create)* | Minimal Worker UI: sandbox/dir/model/task inputs, Run/Cancel, output pane. |
| `src/webview/index.tsx` *(modify)* | Register `"worker"` view. |
| `src/extension.ts` *(modify)* | `skynet-harness.openWorker` command. |
| `package.json` *(modify)* | Contribute the `openWorker` command. |

---

## Task 1: Domain types + Codex `buildInvocation`

Establishes the type foundation and the pure argv builder — the first independently testable unit.

**Files:**
- Create: `src/worker/types.ts`
- Create: `src/worker/adapters/types.ts`
- Create: `src/worker/adapters/codex.ts`
- Test: `src/worker/adapters/codex.test.ts`

**Interfaces:**
- Produces: `Worker`, `Agent`, `Harness`, `Soul`, `Company`, `Protocol`, `AuthMethod`, `SandboxMode`, `ModelTier`, `SubProtocol` (from `types.ts`); `AgentAdapter`, `Invocation`, `Credentials`, `WorkerEvent`, `DecisionAsk` (from `adapters/types.ts`); `codexAdapter` (from `codex.ts`).
- `codexAdapter.buildInvocation(worker, task, creds): Invocation` where `Invocation = { command: string; args: string[]; env?: Record<string,string>; cwd?: string }`.

- [ ] **Step 1: Write the failing test**

Create `src/worker/adapters/codex.test.ts`:

```ts
import * as assert from "assert";
import { codexAdapter } from "./codex";
import type { Worker } from "../types";

function sampleWorker(overrides: Partial<Worker["agent"]> = {}): Worker {
  return {
    id: "w1",
    agent: {
      company: "openai",
      protocol: "cli",
      subProtocol: { authMethod: "oauth2Pkce" },
      ...overrides,
    },
    harness: { sandbox: "read-only", workingDir: "/tmp/repo" },
    soul: { role: "developer", identity: "", responsibilities: [] },
  };
}

suite("codexAdapter.buildInvocation", () => {
  test("builds codex exec argv with sandbox and working dir", () => {
    const inv = codexAdapter.buildInvocation(sampleWorker(), "do the thing", {});
    assert.strictEqual(inv.command, "codex");
    assert.deepStrictEqual(inv.args, [
      "exec",
      "--json",
      "-s",
      "read-only",
      "-C",
      "/tmp/repo",
      "--skip-git-repo-check",
      "do the thing",
    ]);
    assert.strictEqual(inv.cwd, "/tmp/repo");
  });

  test("includes -m only when a model is set", () => {
    const withModel = codexAdapter.buildInvocation(sampleWorker({ model: "gpt-5" }), "t", {});
    assert.ok(withModel.args.includes("-m"));
    assert.strictEqual(withModel.args[withModel.args.indexOf("-m") + 1], "gpt-5");

    const noModel = codexAdapter.buildInvocation(sampleWorker(), "t", {});
    assert.ok(!noModel.args.includes("-m"));
  });

  test("passes credential env through to the invocation", () => {
    const inv = codexAdapter.buildInvocation(sampleWorker(), "t", { env: { CODEX_HOME: "/x" } });
    assert.deepStrictEqual(inv.env, { CODEX_HOME: "/x" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile-tests && npm test`
Expected: FAIL — `Cannot find module './codex'` (and `../types`).

- [ ] **Step 3: Write the type files and minimal `codex.ts`**

Create `src/worker/types.ts`:

```ts
// Domain model for a Worker = Agent + Harness + Soul. Node-free so the webview
// can import these types without pulling in child_process.

export type Company = "openai" | "anthropic" | "google" | "openrouter" | "nvidia";
export type Protocol = "cli" | "http";
export type AuthMethod = "apiKey" | "oauth2Pkce" | "oauth2" | "deviceCode";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type ModelTier = "fast" | "balanced" | "deep";

export interface SubProtocol {
  authMethod: AuthMethod;
  endpointUrl?: string; // http only; cli resolves its own endpoint
}

export interface Agent {
  company: Company;
  protocol: Protocol;
  subProtocol: SubProtocol;
  model?: string; // omit → CLI uses its configured default (no -m)
  tier?: ModelTier;
  credentialRef?: string; // opaque handle; Epic 1 uses the CLI's existing login
}

export interface Harness {
  sandbox: SandboxMode;
  workingDir: string;
  // ponytail: Epic 1 only needs sandbox + workingDir. tools/observability/
  // verification facets are added in Epic 2 when they have real shapes.
}

export interface Soul {
  role: string;
  identity: string;
  responsibilities: string[];
  methodology?: string;
  requiredTier?: ModelTier;
  // ponytail: present for type stability; Epic 1 ignores soul (no injection yet — Epic 3).
}

export interface Worker {
  id: string;
  agent: Agent;
  harness: Harness;
  soul: Soul;
}
```

Create `src/worker/adapters/types.ts`:

```ts
import type { AuthMethod, Company, Protocol, Worker } from "../types";

// Resolved at run time, never serialized into Worker config. Epic 1: passthrough —
// Codex uses its own `codex login` (~/.codex/auth.json), so env is usually empty.
export interface Credentials {
  env?: Record<string, string>;
}

export interface Invocation {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface DecisionAsk {
  question: string;
  options?: { label: string; detail?: string }[];
  context?: string;
}

export type WorkerEvent =
  | { type: "started" }
  | { type: "agent-message"; text: string }
  | { type: "tool-call"; name: string; detail?: string }
  | { type: "log"; level: "info" | "warn" | "error"; text: string }
  | { type: "decision-request"; questions: DecisionAsk[] }
  | { type: "done"; lastMessage?: string }
  | { type: "error"; message: string; transport?: boolean }; // transport=true → fallback-eligible (Epic 6)

export interface AgentAdapter {
  readonly company: Company;
  readonly protocol: Protocol;
  allowedAuthMethods(): AuthMethod[];
  buildInvocation(worker: Worker, task: string, creds: Credentials): Invocation;
  parseEvents(raw: AsyncIterable<Buffer>): AsyncIterable<WorkerEvent>;
}
```

Create `src/worker/adapters/codex.ts` (parseEvents stubbed for now — Task 2 fills it):

```ts
import type { AuthMethod, Worker } from "../types";
import type { AgentAdapter, Credentials, Invocation, WorkerEvent } from "./types";

export const codexAdapter: AgentAdapter = {
  company: "openai",
  protocol: "cli",

  allowedAuthMethods(): AuthMethod[] {
    return ["oauth2Pkce", "apiKey"];
  },

  buildInvocation(worker: Worker, task: string, creds: Credentials): Invocation {
    const { agent, harness } = worker;
    const args = [
      "exec",
      "--json",
      "-s",
      harness.sandbox,
      "-C",
      harness.workingDir,
      "--skip-git-repo-check",
    ];
    if (agent.model) {
      args.push("-m", agent.model);
    }
    args.push(task);
    return { command: "codex", args, cwd: harness.workingDir, env: creds.env };
  },

  parseEvents(raw: AsyncIterable<Buffer>): AsyncIterable<WorkerEvent> {
    return parseCodexEvents(raw);
  },
};

// Filled in Task 2.
async function* parseCodexEvents(_raw: AsyncIterable<Buffer>): AsyncIterable<WorkerEvent> {
  // placeholder body replaced in Task 2
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run compile-tests && npm test`
Expected: PASS (3 tests in `codexAdapter.buildInvocation`).

- [ ] **Step 5: Commit**

```bash
git add src/worker/types.ts src/worker/adapters/types.ts src/worker/adapters/codex.ts src/worker/adapters/codex.test.ts
git commit -m "feat(worker): Codex adapter types + buildInvocation"
```

---

## Task 2: Codex `parseEvents` — JSONL → normalized `WorkerEvent`

The core logic: line-buffered JSONL parsing across chunk boundaries, skipping noise, mapping Codex thread/turn/item events to normalized `WorkerEvent`s.

**Files:**
- Modify: `src/worker/adapters/codex.ts`
- Test: `src/worker/adapters/codex.test.ts`

**Interfaces:**
- Consumes: `codexAdapter`, `WorkerEvent` (Task 1).
- Produces: `codexAdapter.parseEvents(raw: AsyncIterable<Buffer>): AsyncIterable<WorkerEvent>` — emits `started` (once, on `thread.started`), `tool-call` (on `command_execution` `item.started`), `agent-message` (on `agent_message` `item.completed`), `log` (unknown item types), `done` (on `turn.completed`, carrying the last agent message), `error` (on `error`/`turn.failed`).

- [ ] **Step 1: Write the failing tests**

Append to `src/worker/adapters/codex.test.ts`:

```ts
import type { WorkerEvent } from "./types";

async function* streamOf(...chunks: string[]): AsyncIterable<Buffer> {
  for (const c of chunks) {
    yield Buffer.from(c, "utf8");
  }
}

async function collect(raw: AsyncIterable<WorkerEvent>): Promise<WorkerEvent[]> {
  const out: WorkerEvent[] = [];
  for await (const e of raw) {
    out.push(e);
  }
  return out;
}

suite("codexAdapter.parseEvents", () => {
  test("maps a simple agent-message turn to started/agent-message/done", async () => {
    const lines = [
      '{"type":"thread.started","thread_id":"t1"}\n',
      '{"type":"turn.started"}\n',
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"PONG"}}\n',
      '{"type":"turn.completed","usage":{"input_tokens":1}}\n',
    ];
    const events = await collect(codexAdapter.parseEvents(streamOf(...lines)));
    assert.deepStrictEqual(events, [
      { type: "started" },
      { type: "agent-message", text: "PONG" },
      { type: "done", lastMessage: "PONG" },
    ]);
  });

  test("maps command_execution item.started to a tool-call", async () => {
    const line =
      '{"type":"item.started","item":{"id":"item_0","type":"command_execution","command":"/bin/zsh -lc \'cat note.txt\'","status":"in_progress"}}\n';
    const events = await collect(codexAdapter.parseEvents(streamOf(line)));
    assert.deepStrictEqual(events, [
      { type: "tool-call", name: "shell", detail: "/bin/zsh -lc 'cat note.txt'" },
    ]);
  });

  test("skips non-JSON noise lines", async () => {
    const lines = [
      "Reading additional input from stdin...\n",
      '{"type":"thread.started","thread_id":"t1"}\n',
    ];
    const events = await collect(codexAdapter.parseEvents(streamOf(...lines)));
    assert.deepStrictEqual(events, [{ type: "started" }]);
  });

  test("reassembles a JSON object split across chunks", async () => {
    const events = await collect(
      codexAdapter.parseEvents(
        streamOf('{"type":"item.completed","item":{"type":"agent', '_message","text":"hi"}}\n'),
      ),
    );
    assert.deepStrictEqual(events, [{ type: "agent-message", text: "hi" }]);
  });

  test("parses a final line that has no trailing newline", async () => {
    const events = await collect(
      codexAdapter.parseEvents(streamOf('{"type":"turn.completed","usage":{}}')),
    );
    assert.deepStrictEqual(events, [{ type: "done", lastMessage: undefined }]);
  });

  test("surfaces unknown item types as a log", async () => {
    const events = await collect(
      codexAdapter.parseEvents(
        streamOf('{"type":"item.completed","item":{"type":"reasoning","text":"…"}}\n'),
      ),
    );
    assert.deepStrictEqual(events, [{ type: "log", level: "info", text: "reasoning" }]);
  });

  test("maps an error event with the transport flag unset", async () => {
    const events = await collect(
      codexAdapter.parseEvents(streamOf('{"type":"error","message":"boom"}\n')),
    );
    assert.deepStrictEqual(events, [{ type: "error", message: "boom", transport: false }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run compile-tests && npm test`
Expected: FAIL — `parseEvents` placeholder yields nothing; assertions on emitted events fail.

- [ ] **Step 3: Implement the parser**

In `src/worker/adapters/codex.ts`, replace the placeholder `parseCodexEvents` with:

```ts
interface CodexItem {
  id?: string;
  type?: string;
  text?: string;
  command?: string;
  [k: string]: unknown;
}
interface CodexEvent {
  type?: string;
  item?: CodexItem;
  message?: string;
  error?: { message?: string };
  [k: string]: unknown;
}

interface ParseState {
  started: boolean;
  lastMessage?: string;
}

async function* parseCodexEvents(raw: AsyncIterable<Buffer>): AsyncIterable<WorkerEvent> {
  const state: ParseState = { started: false };
  let buffer = "";
  for await (const chunk of raw) {
    buffer += chunk.toString("utf8");
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const event = parseLine(buffer.slice(0, nl), state);
      buffer = buffer.slice(nl + 1);
      if (event) {
        yield event;
      }
    }
  }
  const tail = parseLine(buffer, state);
  if (tail) {
    yield tail;
  }
}

function parseLine(line: string, state: ParseState): WorkerEvent | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  let obj: CodexEvent;
  try {
    obj = JSON.parse(trimmed) as CodexEvent;
  } catch {
    return null; // noise line (e.g. "Reading additional input from stdin...")
  }
  return mapCodexEvent(obj, state);
}

function mapCodexEvent(obj: CodexEvent, state: ParseState): WorkerEvent | null {
  switch (obj.type) {
    case "thread.started":
      if (state.started) {
        return null;
      }
      state.started = true;
      return { type: "started" };
    case "item.started": {
      const item = obj.item;
      if (item?.type === "command_execution") {
        return {
          type: "tool-call",
          name: "shell",
          detail: typeof item.command === "string" ? item.command : undefined,
        };
      }
      return null;
    }
    case "item.completed": {
      const item = obj.item;
      if (item?.type === "agent_message" && typeof item.text === "string") {
        state.lastMessage = item.text;
        return { type: "agent-message", text: item.text };
      }
      if (item?.type === "command_execution") {
        return null; // already surfaced on item.started
      }
      if (item?.type) {
        // ponytail: unknown item types surfaced as a log; full observability is Epic 2.
        return { type: "log", level: "info", text: item.type };
      }
      return null;
    }
    case "turn.completed":
      return { type: "done", lastMessage: state.lastMessage };
    case "error":
    case "turn.failed":
      return { type: "error", message: errorMessage(obj), transport: false };
    default:
      return null; // turn.started and any other envelope we don't surface
  }
}

function errorMessage(obj: CodexEvent): string {
  return obj.error?.message ?? obj.message ?? "unknown codex error";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run compile-tests && npm test`
Expected: PASS (all `codexAdapter.buildInvocation` and `codexAdapter.parseEvents` tests).

- [ ] **Step 5: Commit**

```bash
git add src/worker/adapters/codex.ts src/worker/adapters/codex.test.ts
git commit -m "feat(worker): parse Codex JSONL into normalized WorkerEvents"
```

---

## Task 3: `runWorker` — spawn, stream, cancel, error mapping

Wires the adapter to a real (or injected) process: spawn, pipe stdout through `parseEvents`, stream to a callback, expose cancel, map spawn/exit failures to `error` events.

**Files:**
- Create: `src/worker/runner.ts`
- Test: `src/worker/runner.test.ts`

**Interfaces:**
- Consumes: `codexAdapter` (Task 1–2), `Worker`, `WorkerEvent`, `Invocation`, `Credentials`, `AgentAdapter`.
- Produces:
  - `runWorker(worker: Worker, task: string, onEvent: (e: WorkerEvent) => void, deps?: RunDeps): RunHandle`
  - `RunHandle = { cancel(): void; done: Promise<void> }`
  - `SpawnedProcess = { stdout: AsyncIterable<Buffer>; kill(): void; exit: Promise<{ code: number | null; error?: Error }> }`
  - `SpawnFn = (inv: Invocation) => SpawnedProcess`
  - `RunDeps = { spawnFn?: SpawnFn; adapter?: AgentAdapter; credentials?: Credentials }`

- [ ] **Step 1: Write the failing tests**

Create `src/worker/runner.test.ts`:

```ts
import * as assert from "assert";
import { spawnSync } from "child_process";
import { runWorker, type SpawnedProcess } from "./runner";
import type { Worker } from "./types";
import type { WorkerEvent } from "./adapters/types";

function worker(): Worker {
  return {
    id: "w1",
    agent: { company: "openai", protocol: "cli", subProtocol: { authMethod: "oauth2Pkce" } },
    harness: { sandbox: "read-only", workingDir: process.cwd() },
    soul: { role: "developer", identity: "", responsibilities: [] },
  };
}

async function* streamOf(...chunks: string[]): AsyncIterable<Buffer> {
  for (const c of chunks) {
    yield Buffer.from(c, "utf8");
  }
}

function fakeProcess(lines: string[], exit: { code: number | null; error?: Error }) {
  let killed = false;
  const proc: SpawnedProcess = {
    stdout: streamOf(...lines),
    kill: () => {
      killed = true;
    },
    exit: Promise.resolve(exit),
  };
  return { proc, wasKilled: () => killed };
}

suite("runWorker", () => {
  test("streams normalized events from the process stdout", async () => {
    const events: WorkerEvent[] = [];
    const { proc } = fakeProcess(
      [
        '{"type":"thread.started","thread_id":"t1"}\n',
        '{"type":"item.completed","item":{"type":"agent_message","text":"PONG"}}\n',
        '{"type":"turn.completed","usage":{}}\n',
      ],
      { code: 0 },
    );
    const handle = runWorker(worker(), "say pong", (e) => events.push(e), { spawnFn: () => proc });
    await handle.done;
    assert.deepStrictEqual(events, [
      { type: "started" },
      { type: "agent-message", text: "PONG" },
      { type: "done", lastMessage: "PONG" },
    ]);
  });

  test("cancel() kills the process", async () => {
    const { proc, wasKilled } = fakeProcess([], { code: null });
    const handle = runWorker(worker(), "t", () => {}, { spawnFn: () => proc });
    handle.cancel();
    await handle.done;
    assert.strictEqual(wasKilled(), true);
  });

  test("emits a transport error when the spawn throws (e.g. codex not found)", async () => {
    const events: WorkerEvent[] = [];
    const handle = runWorker(worker(), "t", (e) => events.push(e), {
      spawnFn: () => {
        const err = new Error("spawn codex ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      },
    });
    await handle.done;
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, "error");
    assert.strictEqual((events[0] as { transport?: boolean }).transport, true);
  });

  test("emits an error on a non-zero exit code", async () => {
    const events: WorkerEvent[] = [];
    const { proc } = fakeProcess([], { code: 2 });
    const handle = runWorker(worker(), "t", (e) => events.push(e), { spawnFn: () => proc });
    await handle.done;
    assert.deepStrictEqual(events, [
      { type: "error", message: "codex exited with code 2", transport: false },
    ]);
  });

  test("real codex: runs a trivial task end to end", async function () {
    const available = spawnSync("codex", ["--version"]).status === 0;
    if (!available) {
      this.skip();
    }
    this.timeout(120_000);
    const events: WorkerEvent[] = [];
    const handle = runWorker(
      worker(),
      "Reply with exactly the word PONG and nothing else. Do not run any commands.",
      (e) => events.push(e),
    );
    await handle.done;
    assert.ok(
      events.some((e) => e.type === "agent-message"),
      "expected at least one agent-message event",
    );
    assert.ok(
      events.some((e) => e.type === "done"),
      "expected a done event",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run compile-tests && npm test`
Expected: FAIL — `Cannot find module './runner'`.

- [ ] **Step 3: Implement the runner**

Create `src/worker/runner.ts`:

```ts
import { spawn } from "child_process";
import type { Worker } from "./types";
import { codexAdapter } from "./adapters/codex";
import type { AgentAdapter, Credentials, Invocation, WorkerEvent } from "./adapters/types";

export interface RunHandle {
  cancel(): void;
  done: Promise<void>;
}

export interface SpawnedProcess {
  stdout: AsyncIterable<Buffer>;
  kill(): void;
  exit: Promise<{ code: number | null; error?: Error }>;
}

export type SpawnFn = (inv: Invocation) => SpawnedProcess;

export interface RunDeps {
  spawnFn?: SpawnFn;
  adapter?: AgentAdapter;
  credentials?: Credentials;
}

export function runWorker(
  worker: Worker,
  task: string,
  onEvent: (e: WorkerEvent) => void,
  deps: RunDeps = {},
): RunHandle {
  const adapter = deps.adapter ?? codexAdapter;
  const spawnFn = deps.spawnFn ?? defaultSpawn;
  const creds = deps.credentials ?? {};
  const invocation = adapter.buildInvocation(worker, task, creds);

  let proc: SpawnedProcess;
  try {
    proc = spawnFn(invocation);
  } catch (err) {
    onEvent({ type: "error", message: errString(err), transport: isTransport(err) });
    return { cancel: () => {}, done: Promise.resolve() };
  }

  const done = (async () => {
    try {
      for await (const event of adapter.parseEvents(proc.stdout)) {
        onEvent(event);
      }
      const exit = await proc.exit;
      if (exit.error) {
        onEvent({ type: "error", message: errString(exit.error), transport: isTransport(exit.error) });
      } else if (exit.code !== null && exit.code !== 0) {
        onEvent({ type: "error", message: `codex exited with code ${exit.code}`, transport: false });
      }
    } catch (err) {
      onEvent({ type: "error", message: errString(err), transport: isTransport(err) });
    }
  })();

  return { cancel: () => proc.kill(), done };
}

function defaultSpawn(inv: Invocation): SpawnedProcess {
  // stdin "ignore" (=/dev/null) is required: an open stdin makes Codex block on
  // "Reading additional input from stdin...".
  const child = spawn(inv.command, inv.args, {
    cwd: inv.cwd,
    env: inv.env ? { ...process.env, ...inv.env } : process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exit = new Promise<{ code: number | null; error?: Error }>((resolve) => {
    child.on("error", (error) => resolve({ code: null, error }));
    child.on("close", (code) => resolve({ code }));
  });
  // ponytail: stderr is ignored in Epic 1; the verified failure signal is the exit
  // code. Capturing stderr lands with Observability (Epic 2).
  return {
    stdout: child.stdout!,
    kill: () => {
      child.kill();
    },
    exit,
  };
}

function isTransport(err: unknown): boolean {
  // ponytail: spawn/connection failures are fallback-eligible. Finer classification
  // (429/auth from codex stderr) lands with the AgentPool (Epic 6).
  const code = (err as NodeJS.ErrnoException)?.code;
  return code === "ENOENT" || code === "ECONNREFUSED" || code === "ETIMEDOUT";
}

function errString(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run compile-tests && npm test`
Expected: PASS — 4 unit tests pass; the real-codex test passes if `codex` is installed (it is on this machine: codex-cli 0.142.2), otherwise it is skipped.

- [ ] **Step 5: Commit**

```bash
git add src/worker/runner.ts src/worker/runner.test.ts
git commit -m "feat(worker): runWorker spawns Codex, streams events, cancels"
```

---

## Task 4: Protocol + panel host wiring

Connects the runner to the webview message channel. Verified by type-check (the protocol contract is compile-time) and a manual smoke run.

**Files:**
- Modify: `src/webview/protocol.ts`
- Modify: `src/webview/panel.ts`

**Interfaces:**
- Consumes: `runWorker`, `RunHandle` (Task 3); `Worker` (Task 1); `WorkerEvent` (Task 1).
- Produces (protocol additions):
  - `WebviewToExtension += { type: "runTask"; worker: Worker; task: string } | { type: "cancelTask"; workerId: string }`
  - `ExtensionToWebview += { type: "taskEvent"; workerId: string; event: WorkerEvent }`

- [ ] **Step 1: Extend the protocol**

Replace `src/webview/protocol.ts` with:

```ts
// Messages shared by the extension host and the webview. Imported by both
// sides so the postMessage contract is checked at compile time.
//
// NOTE: only `import type` from worker/* here — these files must not pull
// child_process into the webview bundle.
import type { Worker } from "../worker/types";
import type { WorkerEvent } from "../worker/adapters/types";

export type WebviewToExtension =
  | { type: "ready" }
  | { type: "hello"; name: string }
  | { type: "runTask"; worker: Worker; task: string }
  | { type: "cancelTask"; workerId: string };

export type ExtensionToWebview =
  | { type: "greeting"; text: string }
  | { type: "taskEvent"; workerId: string; event: WorkerEvent };
```

- [ ] **Step 2: Route the new messages in panel.ts**

Replace `src/webview/panel.ts` with:

```ts
import * as vscode from "vscode";
import { buildWebviewHtml, nonce } from "./html";
import type { WebviewToExtension } from "./protocol";
import { runWorker, type RunHandle } from "../worker/runner";

export function openWebview(
  context: vscode.ExtensionContext,
  viewId: string
): vscode.WebviewPanel {
  const distWebview = vscode.Uri.joinPath(context.extensionUri, "dist", "webview");
  const panel = vscode.window.createWebviewPanel(
    "skynet." + viewId,
    "Skynet",
    vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [distWebview] }
  );

  const webview = panel.webview;
  const scriptUri = webview
    .asWebviewUri(vscode.Uri.joinPath(distWebview, "main.js"))
    .toString();
  const styleUri = webview
    .asWebviewUri(vscode.Uri.joinPath(distWebview, "main.css"))
    .toString();

  webview.html = buildWebviewHtml({
    scriptUri,
    styleUri,
    cspSource: webview.cspSource,
    nonce: nonce(),
    viewId,
  });

  const runs = new Map<string, RunHandle>();

  webview.onDidReceiveMessage(
    (msg: WebviewToExtension) => {
      if (msg.type === "hello") {
        vscode.window.showInformationMessage(`Webview says hello: ${msg.name}`);
        webview.postMessage({ type: "greeting", text: `Hello back, ${msg.name}!` });
      } else if (msg.type === "runTask") {
        const workerId = msg.worker.id;
        runs.get(workerId)?.cancel();
        const handle = runWorker(msg.worker, msg.task, (event) => {
          webview.postMessage({ type: "taskEvent", workerId, event });
        });
        runs.set(workerId, handle);
        handle.done.finally(() => {
          if (runs.get(workerId) === handle) {
            runs.delete(workerId);
          }
        });
      } else if (msg.type === "cancelTask") {
        runs.get(msg.workerId)?.cancel();
      }
    },
    undefined,
    context.subscriptions
  );

  panel.onDidDispose(
    () => {
      for (const handle of runs.values()) {
        handle.cancel();
      }
      runs.clear();
    },
    undefined,
    context.subscriptions
  );

  return panel;
}
```

- [ ] **Step 3: Verify type-check and lint pass**

Run: `npm run check-types && npm run lint`
Expected: no errors. (Confirms the webview bundle's `import type` from `worker/*` resolves and the panel wiring type-checks.)

- [ ] **Step 4: Commit**

```bash
git add src/webview/protocol.ts src/webview/panel.ts
git commit -m "feat(worker): wire runTask/cancelTask/taskEvent through the panel"
```

---

## Task 5: Worker view + registration

The minimal webview UI and its command/registration. Verified by type-check, lint, and an end-to-end manual smoke run against real Codex.

**Files:**
- Create: `src/webview/views/worker.tsx`
- Modify: `src/webview/index.tsx`
- Modify: `src/extension.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `onMessage`, `postMessage` (`@/lib/vscode`); `Worker`, `SandboxMode` (`../../worker/types`, type-only); `WorkerEvent` (`../../worker/adapters/types`, type-only); protocol messages `runTask`/`cancelTask`/`taskEvent` (Task 4).
- Produces: `WorkerView` React component; `"worker"` view id; `skynet-harness.openWorker` command.

- [ ] **Step 1: Create the Worker view**

Create `src/webview/views/worker.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { onMessage, postMessage } from "@/lib/vscode";
import type { SandboxMode, Worker } from "../../worker/types";
import type { WorkerEvent } from "../../worker/adapters/types";

const WORKER_ID = "worker-1";

const SANDBOXES: SandboxMode[] = ["read-only", "workspace-write", "danger-full-access"];

export function WorkerView() {
  const [sandbox, setSandbox] = useState<SandboxMode>("read-only");
  const [workingDir, setWorkingDir] = useState("");
  const [model, setModel] = useState("");
  const [task, setTask] = useState("");
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<string[]>([]);

  useEffect(
    () =>
      onMessage((msg) => {
        if (msg.type === "taskEvent" && msg.workerId === WORKER_ID) {
          setLines((prev) => [...prev, formatEvent(msg.event)]);
          if (msg.event.type === "done" || msg.event.type === "error") {
            setRunning(false);
          }
        }
      }),
    []
  );

  function run() {
    const worker: Worker = {
      id: WORKER_ID,
      agent: {
        company: "openai",
        protocol: "cli",
        subProtocol: { authMethod: "oauth2Pkce" },
        model: model.trim() || undefined,
      },
      harness: { sandbox, workingDir: workingDir.trim() },
      // ponytail: Epic 1 has no soul behavior; a placeholder keeps the type valid.
      soul: { role: "developer", identity: "", responsibilities: [] },
    };
    setLines([]);
    setRunning(true);
    postMessage({ type: "runTask", worker, task });
  }

  function cancel() {
    postMessage({ type: "cancelTask", workerId: WORKER_ID });
    setRunning(false);
  }

  return (
    <div className="p-4 flex flex-col gap-4 max-w-2xl mx-auto">
      <h1 className="text-lg font-semibold">Worker — Codex</h1>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Sandbox</Label>
          <Select value={sandbox} onValueChange={(v) => setSandbox(v as SandboxMode)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SANDBOXES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="worker-model">Model (optional)</Label>
          <Input
            id="worker-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="default"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="worker-dir">Working directory</Label>
        <Input
          id="worker-dir"
          value={workingDir}
          onChange={(e) => setWorkingDir(e.target.value)}
          placeholder="/absolute/path"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="worker-task">Task</Label>
        <Textarea
          id="worker-task"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          rows={3}
          placeholder="Describe the task…"
        />
      </div>

      <div className="flex gap-2">
        <Button onClick={run} disabled={running || !task.trim() || !workingDir.trim()}>
          Run
        </Button>
        <Button variant="outline" onClick={cancel} disabled={!running}>
          Cancel
        </Button>
      </div>

      <ScrollArea className="h-72 rounded-md border bg-card p-3">
        <pre className="text-xs whitespace-pre-wrap">
          {lines.length ? lines.join("\n") : "Output will stream here."}
        </pre>
      </ScrollArea>
    </div>
  );
}

function formatEvent(e: WorkerEvent): string {
  switch (e.type) {
    case "started":
      return "▶ started";
    case "agent-message":
      return e.text;
    case "tool-call":
      return `⚙ ${e.name}${e.detail ? ": " + e.detail : ""}`;
    case "log":
      return `· ${e.text}`;
    case "decision-request":
      return `? ${e.questions.map((q) => q.question).join(" | ")}`;
    case "done":
      return "✔ done";
    case "error":
      return `✖ error: ${e.message}`;
    default:
      return "";
  }
}
```

- [ ] **Step 2: Register the view**

Replace `src/webview/index.tsx` with:

```tsx
import { createRoot } from "react-dom/client";
import { HelloView } from "@/views/hello";
import { GalleryView } from "@/views/gallery";
import { WorkerView } from "@/views/worker";

declare global {
  interface Window {
    __INITIAL_STATE__: { viewId: string };
  }
}

function App({ viewId }: { viewId: string }) {
  switch (viewId) {
    case "hello":
      return <HelloView />;
    case "gallery":
      return <GalleryView />;
    case "worker":
      return <WorkerView />;
    default:
      return <div className="p-4">Unknown view: {viewId}</div>;
  }
}

const { viewId } = window.__INITIAL_STATE__;
createRoot(document.getElementById("root")!).render(<App viewId={viewId} />);
```

- [ ] **Step 3: Add the command**

In `src/extension.ts`, after the `openGallery` registration (and before `context.subscriptions.push(openPanel, openGallery);`), add the worker command and include it in the push:

```ts
	const openGallery = vscode.commands.registerCommand("skynet-harness.openGallery", () => {
		openWebview(context, "gallery");
	});
	const openWorker = vscode.commands.registerCommand("skynet-harness.openWorker", () => {
		openWebview(context, "worker");
	});
	context.subscriptions.push(openPanel, openGallery, openWorker);
```

In `package.json`, add to `contributes.commands`:

```json
    {
      "command": "skynet-harness.openWorker",
      "title": "Skynet: Open Worker"
    }
```

- [ ] **Step 4: Verify build, type-check, and lint**

Run: `npm run compile`
Expected: PASS — `check-types`, `lint`, esbuild bundle, and CSS build all succeed. (Confirms the type-only `../../worker/*` imports are elided from the webview bundle and nothing pulls `child_process` into the browser.)

- [ ] **Step 5: Manual smoke test (real end-to-end)**

1. Press `F5` to launch the Extension Development Host.
2. Run command **"Skynet: Open Worker"** (Cmd+Shift+P).
3. Set **Working directory** to an absolute path (e.g. a scratch dir), leave Sandbox `read-only`, Model empty.
4. Task: `Reply with exactly the word PONG and nothing else. Do not run any commands.`
5. Click **Run**.
6. Expected in the output pane: `▶ started`, then an agent message containing `PONG`, then `✔ done`.
7. Re-run with a longer task (e.g. `List the files here and summarize.`) and click **Cancel** mid-run — output stops and the Run button re-enables.

- [ ] **Step 6: Commit**

```bash
git add src/webview/views/worker.tsx src/webview/index.tsx src/extension.ts package.json
git commit -m "feat(worker): Worker view + openWorker command"
```

---

## Self-Review

**Spec coverage (Epic 1 deliverable — §12):**
- "Spawn `codex exec --json`, parse JSONL → normalized `WorkerEvent`s" → Tasks 1–3 ✅
- "stream, cancel" → Task 3 (`runWorker` + `RunHandle.cancel`) ✅
- "transport-error handling" → Task 3 (`isTransport`, spawn/exit error mapping) ✅
- "Task passed through as the prompt — no soul system" → adapter appends `task` verbatim; `Soul` ignored ✅
- "minimal harness (sandbox + workingDir only)" → `Harness` trimmed to those two fields ✅
- Rides along: `types.ts` (T1), `AgentAdapter` interface + Codex adapter (T1–2), `WorkerEvent` (T1), runner (T3), protocol messages (T4), credential passthrough (`Credentials.env`, T1/T3), minimal `worker.tsx` (T5) ✅
- Verified Codex facts (§8) baked into Global Constraints + Task 1 argv and Task 2 event mapping ✅

**Placeholder scan:** The only intentional placeholder is the `parseCodexEvents` stub in Task 1, explicitly replaced in Task 2 — flagged at both ends. No `TBD`/`TODO`/"handle edge cases". ✅

**Type consistency:** `WorkerEvent`, `Worker`, `Invocation`, `Credentials`, `AgentAdapter`, `SpawnedProcess`, `SpawnFn`, `RunHandle`, `RunDeps` are defined once and referenced with the same names/shapes across tasks. `codexAdapter.parseEvents` signature matches the `AgentAdapter` contract. ✅

**Out of scope (correctly deferred):** observability/stderr capture, verification gate, soul injection, multi-account credentials, AgentPool/tier fallback, persistence — all later epics.
