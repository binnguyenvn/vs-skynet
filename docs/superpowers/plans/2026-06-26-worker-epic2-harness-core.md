# Worker — Epic 2: Harness Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Epic 1's raw Codex bridge into a *reliable* Worker: it shows exactly what it's doing (Observability), refuses to claim "done" without passing independent checks (Verification), and can be capped in what it spends and touches (Guardrails).

**Architecture:** Three vertical slices on top of Epic 1's `src/worker/` module, each behind the CLI-agnostic contract. Observability grows the normalized `WorkerEvent` union and the Codex `parseEvents` mapping (reasoning, paired tool-result, file-change, usage), captures the child's stderr, and renders an event-typed timeline. Verification adds an optional list of independent shell checks the runner executes *after* the agent's `done`, gating a `verified` flag. Guardrails make the runner a circuit breaker (step cap + wall-clock cap → `kill()`) and expose the full sandbox + writable-roots controls. Only the Codex adapter is CLI-specific; the contract and runner are reused by Epic 4 (more CLIs) and Epic 5 (HTTP loop).

**Tech Stack:** TypeScript, Node `child_process`, VS Code extension API, React 19 + shadcn/ui (webview), Mocha via `@vscode/test-cli` (`suite`/`test`/`assert`).

## Global Constraints

- **Verified Codex facts (codex-cli 0.142.3, confirmed against the installed binary on this machine — do NOT trust `docs/research/`):**
  - Invocation today: `codex exec --json -s <mode> -C <dir> [-m <model>] --skip-git-repo-check "<task>"`.
  - `codex exec --help` confirms these flags exist: `-s/--sandbox`, `-C/--cd`, `--add-dir <DIR>` (repeatable, adds an extra writable root), `-m/--model`, `--json`, `--skip-git-repo-check`.
  - `--json` streams **JSONL**, one JSON object per line; non-JSON noise lines also appear (e.g. `Reading additional input from stdin...`) and MUST be skipped.
  - Envelope is a **thread/turn/item** model: `{"type":"thread.started","thread_id":...}`, `{"type":"turn.started"}`, `{"type":"item.started","item":{...}}`, `{"type":"item.completed","item":{...}}`, `{"type":"turn.completed","usage":{...}}`. `turn.completed` is the terminal marker — there is **no** separate `done` event.
  - Item shapes (Codex `exec_events`): `agent_message` = `{id, type:"agent_message", text}`; `reasoning` = `{id, type:"reasoning", text}`; `command_execution` = `{id, type:"command_execution", command, aggregated_output, exit_code, status}` (emitted as `item.started` then `item.completed`); `file_change` = `{id, type:"file_change", changes:[{path, kind}]}`; `usage` on `turn.completed` = `{input_tokens, cached_input_tokens, output_tokens, ...}`.
  - **Errors arrive two ways** (verified live this session): a bare `{"type":"error","message":...}` (e.g. transient `Reconnecting... 2/5 (request timed out)`) **and** an `item.completed` whose `item.type` is `"error"` carrying `{id, message, type}`. Both map to an `error` `WorkerEvent`.
  - Codex reports token usage **only at `turn.completed`** (the end) — a mid-run token budget is NOT enforceable from the stream and is explicitly deferred to Epic 5.
  - **`reasoning` items are emitted only with `-c model_reasoning_summary=auto`** (verified live during Task 1). Without it GPT-5.x encrypts reasoning and `--json` shows nothing. `buildInvocation` passes this flag (Task 2). GPT-5.x additionally needed `-c model_supports_reasoning_summaries=true` at capture time, but forcing that capability across all models is unsafe and is left out (known limitation).
  - `-s/--sandbox` ∈ `{read-only, workspace-write, danger-full-access}`. Network is off by default in the sandbox.
  - Spawn with `stdio: ["ignore", "pipe", "pipe"]` — an open stdin makes Codex block on `Reading additional input from stdin...`.
- **No auto-repair / re-prompt in Epic 2.** The verification gate makes the truth *visible* (`verified: false`); acting on a failed check (re-prompting) is a loop the Orchestrator owns (Epic 3+).
- **No soul system in Epic 2** — task string is still passed through raw (soul injection is Epic 3).
- **CLI-agnostic contract.** Every `WorkerEvent` addition and every `Harness` field is defined in the node-free type files; only `codex.ts` maps Codex-specific shapes. Nothing Codex-specific leaks into `runner.ts` or `protocol.ts`.
- **Type files stay node-free.** `src/worker/types.ts` and `src/worker/adapters/types.ts` import only types, so `src/webview/protocol.ts` can `import type` from them without pulling `child_process` into the webview bundle.
- **Tests** are colocated `*.test.ts`, compile to `out/**/*.test.js`, run with `npm test` (Mocha `suite`/`test`/`assert`). Webview React components have **no** unit-test harness in this repo (Epic 1 set the precedent: `worker.tsx` is type-checked + manually smoked, not unit-tested) — webview tasks end with `npm run check-types` + `npm run lint` + a manual smoke checklist.
- **Gates:** `npm run check-types` and `npm run lint` must pass before every commit.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/worker/adapters/types.ts` *(modify)* | Grow `WorkerEvent` union: `reasoning`, `tool-result`, `file-change`, `usage`, `verification`; add `id` to `tool-call`, `verified` to `done`; add optional `ts` to every event. |
| `src/worker/types.ts` *(modify)* | Grow `Harness`: `writableRoots?`, `verification?`, `maxSteps?`, `timeoutMs?`. |
| `src/worker/adapters/fixtures/epic2-stream.jsonl` *(create)* | Real captured Codex JSONL ground truth (reasoning + failing command + file edit). |
| `src/worker/adapters/codex.ts` *(modify)* | Richer `parseEvents` mapping (reasoning, tool-result paired by id, file-change, usage, item-level error); `buildInvocation` adds `--add-dir` per writable root. |
| `src/worker/adapters/codex.test.ts` *(modify)* | New parser cases + `--add-dir` argv case. |
| `src/worker/runner.ts` *(modify)* | Stamp `ts`; drain child stderr → `log`; circuit breaker (`maxSteps`, `timeoutMs` → `kill`); post-`done` verification gate via injectable `verifyFn`. |
| `src/worker/runner.test.ts` *(modify)* | Update existing assertions for `ts`; add stderr, step-cap, timeout, verification cases. |
| `src/webview/views/worker.tsx` *(modify)* | Event-typed timeline; verification command inputs + badges; caps + writable-dirs inputs. |

`src/webview/protocol.ts` needs **no change** — it already carries `Worker` (so new `Harness` fields flow through `runTask`) and `WorkerEvent` (so new events flow through `taskEvent`).

---

## US-1: Observability — the timeline shows the real run

**What it does:** When you run a task, the Worker surfaces everything Codex actually does — its reasoning, each command and its exit code/output, every file it changed, token usage, and any diagnostics on stderr — instead of Epic 1's bland flattened log. The webview renders this as a typed timeline.

**Why it's a vertical slice:** It threads the new event types from the Codex stream (data) through the parser and runner (logic) to the timeline (UI). Runnable on its own: run a task, watch the rich timeline.

---

### Task 1: Capture richer Codex ground-truth fixture

**Files:**
- Create: `src/worker/adapters/fixtures/epic2-stream.jsonl`

**Interfaces:**
- Produces: a committed real JSONL stream containing at least one `reasoning` item, one `command_execution` with a **non-zero** `exit_code`, and one `file_change` item — the ground truth Task 2's mappings are copied from. (Spec §11: verify against reality, never memory.)

- [ ] **Step 1: Capture a real stream into the fixture file**

Run a Codex task in a throwaway dir that reasons, runs a failing command, and edits a file. Redirect stdin from `/dev/null` (else Codex blocks on stdin):

```bash
mkdir -p src/worker/adapters/fixtures
TMP="$(mktemp -d)"; ( cd "$TMP" && git init -q )
codex exec --json -s workspace-write -C "$TMP" --skip-git-repo-check \
  "First reason briefly about the steps. Then run the shell command: ls /nonexistent-xyz (it will fail with a non-zero exit code). Then create a file hello.txt containing the word hi. Then stop." \
  </dev/null > src/worker/adapters/fixtures/epic2-stream.jsonl
rm -rf "$TMP"
```

- [ ] **Step 2: Verify the fixture exercises the three new item types**

Run (this is the task's runnable check):

```bash
node -e 'const fs=require("fs");const t=t=>fs.readFileSync("src/worker/adapters/fixtures/epic2-stream.jsonl","utf8").split("\n").filter(Boolean).map(JSON.parse).some(o=>o.item&&o.item.type===t);for(const k of ["reasoning","command_execution","file_change"]){if(!t(k)){console.error("MISSING item type:",k);process.exit(1)}}console.log("fixture OK: has reasoning, command_execution, file_change")'
```

Expected: `fixture OK: has reasoning, command_execution, file_change`. If any type is missing (e.g. the model didn't reason out loud, or refused the command), re-run Step 1 with a sharper prompt until all three appear. **Do not hand-edit the fixture** — it must be real Codex output.

- [ ] **Step 3: Note the exact field names you'll map in Task 2**

Inspect the real item shapes so Task 2 uses the actual keys, not these notes:

```bash
node -e 'const fs=require("fs");fs.readFileSync("src/worker/adapters/fixtures/epic2-stream.jsonl","utf8").split("\n").filter(Boolean).map(JSON.parse).filter(o=>o.item).forEach(o=>console.log(o.type,"|",o.item.type,"|",Object.keys(o.item).join(",")))'
```

Expected: lines confirming `command_execution` carries `command, aggregated_output, exit_code, status`; `file_change` carries `changes`; `reasoning` carries `text`; `turn.completed` carries `usage`. If a field name differs from the Global Constraints, the **captured fixture wins** — update Task 2's code to the real name.

- [ ] **Step 4: Commit**

```bash
git add src/worker/adapters/fixtures/epic2-stream.jsonl
git commit -m "test(worker): capture richer Codex ground-truth fixture for Epic 2"
```

---

### Task 2: Expand `WorkerEvent` + Codex `parseEvents`

**Files:**
- Modify: `src/worker/adapters/types.ts`
- Modify: `src/worker/adapters/codex.ts`
- Test: `src/worker/adapters/codex.test.ts`

**Interfaces:**
- Consumes: the Epic 1 envelope facts + Task 1 fixture.
- Produces: the grown `WorkerEvent` union (below) and a `parseEvents` that emits `reasoning`, `tool-result` (paired with `tool-call` by item `id`), `file-change` (one per change), and `usage`. `parseEvents` stays **pure** (no clock, no `ts`); the runner stamps `ts` in Task 3. Also: `buildInvocation` gains `-c model_reasoning_summary=auto` so Codex actually emits the `reasoning` items this task learns to parse (Step 5).

- [ ] **Step 1: Write the failing tests**

Add to `src/worker/adapters/codex.test.ts` (inside the existing `suite("codexAdapter.parseEvents", ...)`), using lines copied from the Task 1 fixture:

```ts
test("maps a reasoning item to a reasoning event", async () => {
  const events = await collect(
    codexAdapter.parseEvents(
      streamOf('{"type":"item.completed","item":{"id":"item_0","type":"reasoning","text":"I will list the file."}}\n'),
    ),
  );
  assert.deepStrictEqual(events, [{ type: "reasoning", text: "I will list the file." }]);
});

test("pairs command_execution start/completion into tool-call + tool-result by id", async () => {
  const lines = [
    '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"ls /nope","status":"in_progress"}}\n',
    '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"ls /nope","aggregated_output":"ls: /nope: No such file or directory\\n","exit_code":1,"status":"completed"}}\n',
  ];
  const events = await collect(codexAdapter.parseEvents(streamOf(...lines)));
  assert.deepStrictEqual(events, [
    { type: "tool-call", id: "item_1", name: "shell", detail: "ls /nope" },
    { type: "tool-result", id: "item_1", exitCode: 1, ok: false, output: "ls: /nope: No such file or directory" },
  ]);
});

test("maps a file_change item to one file-change event per change", async () => {
  const line =
    '{"type":"item.completed","item":{"id":"item_2","type":"file_change","changes":[{"path":"hello.txt","kind":"add"}]}}\n';
  const events = await collect(codexAdapter.parseEvents(streamOf(line)));
  assert.deepStrictEqual(events, [{ type: "file-change", path: "hello.txt", kind: "add" }]);
});

test("emits a usage event then done at turn.completed", async () => {
  const line =
    '{"type":"turn.completed","usage":{"input_tokens":120,"cached_input_tokens":40,"output_tokens":30}}\n';
  const events = await collect(codexAdapter.parseEvents(streamOf(line)));
  assert.deepStrictEqual(events, [
    { type: "usage", inputTokens: 120, cachedInputTokens: 40, outputTokens: 30 },
    { type: "done", lastMessage: undefined },
  ]);
});

test("maps an item.completed error to an error event", async () => {
  const line =
    '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Falling back from WebSockets to HTTPS transport."}}\n';
  const events = await collect(codexAdapter.parseEvents(streamOf(line)));
  assert.deepStrictEqual(events, [
    { type: "error", message: "Falling back from WebSockets to HTTPS transport.", transport: false },
  ]);
});
```

Also update the existing **"surfaces unknown item types as a log"** test — `reasoning` is no longer the unknown example. Replace its input item type with a genuinely unmapped one:

```ts
test("surfaces unknown item types as a log", async () => {
  const events = await collect(
    codexAdapter.parseEvents(
      streamOf('{"type":"item.completed","item":{"type":"web_search","query":"x"}}\n'),
    ),
  );
  assert.deepStrictEqual(events, [{ type: "log", level: "info", text: "web_search" }]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: the new `parseEvents` cases FAIL (e.g. reasoning still maps to `log`, command completion returns `null`, no `usage` event).

- [ ] **Step 3: Grow the `WorkerEvent` union**

In `src/worker/adapters/types.ts`, replace the `WorkerEvent` type with (additions marked `// +`):

```ts
export type WorkerEvent = (
  | { type: "started" }
  | { type: "agent-message"; text: string }
  | { type: "reasoning"; text: string } // +
  | { type: "tool-call"; id?: string; name: string; detail?: string } // + id
  | { type: "tool-result"; id?: string; exitCode?: number; ok: boolean; output?: string } // +
  | { type: "file-change"; path: string; kind: string } // +
  | { type: "usage"; inputTokens?: number; outputTokens?: number; cachedInputTokens?: number } // +
  | { type: "log"; level: "info" | "warn" | "error"; text: string }
  | { type: "verification"; command: string; ok: boolean; output?: string } // + (US-2)
  | { type: "decision-request"; questions: DecisionAsk[] }
  | { type: "done"; lastMessage?: string; verified?: boolean } // + verified (US-2)
  | { type: "error"; message: string; transport?: boolean } // transport=true -> fallback-eligible (Epic 6)
) & { ts?: number }; // + every event optionally carries a runner-stamped emit timestamp
```

- [ ] **Step 4: Rewrite the Codex item mapping**

In `src/worker/adapters/codex.ts`, change `mapCodexEvent` to allow multiple events per envelope and add the new item mappings. Replace the `CodexItem` interface and `mapCodexEvent` with:

```ts
interface CodexItem {
  id?: string;
  type?: string;
  text?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number;
  message?: string;
  changes?: { path?: string; kind?: string }[];
  [k: string]: unknown;
}

interface CodexUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
}

const MAX_OUTPUT = 4000; // ponytail: cap tool/command output so one event can't be a megabyte

function truncate(s: string): string {
  return s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + "\n…(truncated)" : s;
}

function mapCodexEvent(obj: CodexEvent, state: ParseState): WorkerEvent | WorkerEvent[] | null {
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
          id: item.id,
          name: "shell",
          detail: typeof item.command === "string" ? item.command : undefined,
        };
      }
      return null;
    }
    case "item.completed": {
      const item = obj.item;
      if (!item?.type) {
        return null;
      }
      if (item.type === "agent_message" && typeof item.text === "string") {
        state.lastMessage = item.text;
        return { type: "agent-message", text: item.text };
      }
      if (item.type === "reasoning" && typeof item.text === "string") {
        return { type: "reasoning", text: item.text };
      }
      if (item.type === "command_execution") {
        return {
          type: "tool-result",
          id: item.id,
          exitCode: item.exit_code,
          ok: item.exit_code === 0,
          output: typeof item.aggregated_output === "string" ? truncate(item.aggregated_output.trim()) : undefined,
        };
      }
      if (item.type === "file_change" && Array.isArray(item.changes)) {
        return item.changes
          .filter((c) => typeof c.path === "string")
          .map((c) => ({ type: "file-change", path: c.path as string, kind: c.kind ?? "modify" }));
      }
      if (item.type === "error") {
        return { type: "error", message: item.message ?? "unknown codex error", transport: false };
      }
      // ponytail: still unmapped (e.g. mcp_tool_call, web_search) — surfaced as a log. Map when a
      // fixture proves their real shapes (Epic 4 touches MCP); the field names aren't verified yet.
      return { type: "log", level: "info", text: item.type };
    }
    case "turn.completed": {
      const usage = obj.usage as CodexUsage | undefined;
      const done: WorkerEvent = { type: "done", lastMessage: state.lastMessage };
      if (!usage) {
        return done;
      }
      return [
        {
          type: "usage",
          inputTokens: usage.input_tokens,
          cachedInputTokens: usage.cached_input_tokens,
          outputTokens: usage.output_tokens,
        },
        done,
      ];
    }
    case "error":
    case "turn.failed":
      return { type: "error", message: errorMessage(obj), transport: false };
    default:
      return null;
  }
}
```

Add `usage?: unknown;` to the `CodexEvent` interface. Then update the generator and `parseLine` to flatten arrays. Change `parseCodexEvents` and `parseLine`:

```ts
async function* parseCodexEvents(raw: AsyncIterable<Buffer>): AsyncIterable<WorkerEvent> {
  const state: ParseState = { started: false };
  let buffer = "";
  for await (const chunk of raw) {
    buffer += chunk.toString("utf8");
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      yield* parseLine(buffer.slice(0, nl), state);
      buffer = buffer.slice(nl + 1);
    }
  }
  yield* parseLine(buffer, state);
}

function* parseLine(line: string, state: ParseState): Generator<WorkerEvent> {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  let obj: CodexEvent;
  try {
    obj = JSON.parse(trimmed) as CodexEvent;
  } catch {
    return; // noise line (e.g. "Reading additional input from stdin...")
  }
  const mapped = mapCodexEvent(obj, state);
  if (Array.isArray(mapped)) {
    yield* mapped;
  } else if (mapped) {
    yield mapped;
  }
}
```

- [ ] **Step 5: Make Codex actually emit `reasoning` at runtime**

**Verified during Task 1 (codex-cli 0.142.3, live):** Codex (GPT-5.x) suppresses `reasoning` items from `--json` output unless invoked with `-c model_reasoning_summary=auto`. Without it, the reasoning event added above never fires in production — the timeline's reasoning rows stay empty. So `buildInvocation` must request reasoning summaries. Add the failing test in `src/worker/adapters/codex.test.ts` (in the `buildInvocation` suite):

```ts
test("requests reasoning summaries so reasoning items are emitted", () => {
  const inv = codexAdapter.buildInvocation(sampleWorker(), "t", {});
  const i = inv.args.indexOf("-c");
  assert.ok(i >= 0 && inv.args[i + 1] === "model_reasoning_summary=auto", "expected -c model_reasoning_summary=auto");
});
```

Then, in `src/worker/adapters/codex.ts` `buildInvocation`, add the flag to the base `args` array (right after `--skip-git-repo-check`):

```ts
"--skip-git-repo-check",
"-c",
"model_reasoning_summary=auto",
```

> ponytail: only the non-forcing `auto` is set — Codex decides per model, so non-reasoning models are unaffected. GPT-5.x *also* needed `-c model_supports_reasoning_summaries=true` to surface reasoning when capturing the fixture; forcing that capability across all models is risky (it asserts support a model may not have), so it's deliberately left out and flagged as a known limitation for the final review. The existing `buildInvocation` argv test must be updated to include the two new array entries.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: all `parseEvents` and `buildInvocation` tests PASS (new + existing — remember to update the existing "builds codex exec argv" assertion to include `-c model_reasoning_summary=auto`).

- [ ] **Step 7: Commit**

```bash
git add src/worker/adapters/types.ts src/worker/adapters/codex.ts src/worker/adapters/codex.test.ts
git commit -m "feat(worker): observability events — reasoning, tool-result, file-change, usage"
```

---

### Task 3: Runner — stamp `ts`, capture child stderr

**Files:**
- Modify: `src/worker/runner.ts`
- Test: `src/worker/runner.test.ts`

**Interfaces:**
- Consumes: `WorkerEvent` (with optional `ts`), `SpawnedProcess` from Epic 1.
- Produces: `SpawnedProcess` gains optional `stderr: AsyncIterable<Buffer>`; `RunDeps` gains `now?: () => number`. Every event reaching `onEvent` carries `ts`. Child stderr lines surface as `{ type: "log", level: "error", text }` (the benign `Reading additional input from stdin...` line is filtered).

- [ ] **Step 1: Write the failing tests**

In `src/worker/runner.test.ts`, update `fakeProcess` to accept optional stderr lines and update the existing assertions to include `ts`. Replace `fakeProcess`:

```ts
function fakeProcess(
  lines: string[],
  exit: { code: number | null; error?: Error },
  stderrLines: string[] = [],
) {
  let killed = false;
  const proc: SpawnedProcess = {
    stdout: streamOf(...lines),
    stderr: streamOf(...stderrLines),
    kill: () => {
      killed = true;
    },
    exit: Promise.resolve(exit),
  };
  return { proc, wasKilled: () => killed };
}

const NOW = 1000; // fixed clock for deterministic ts in tests
```

Update the existing **"streams normalized events"** test to pass the clock and expect `ts`:

```ts
const handle = runWorker(worker(), "say pong", (e) => events.push(e), {
  spawnFn: () => proc,
  now: () => NOW,
});
await handle.done;
assert.deepStrictEqual(events, [
  { type: "started", ts: NOW },
  { type: "agent-message", text: "PONG", ts: NOW },
  { type: "done", lastMessage: "PONG", ts: NOW },
]);
```

Update the existing **"emits an error on a non-zero exit code"** test the same way (add `now: () => NOW`, expect `{ type: "error", message: "codex exited with code 2", transport: false, ts: NOW }`). The two `transport`-flag tests assert on `events[0].type`/`.transport` only, so they need no `ts` change.

Add a new stderr test:

```ts
test("surfaces child stderr as error log events", async () => {
  const events: WorkerEvent[] = [];
  const { proc } = fakeProcess(
    ['{"type":"turn.completed","usage":{}}\n'],
    { code: 0 },
    ["thread 'main' panicked at boom\n", "Reading additional input from stdin...\n"],
  );
  const handle = runWorker(worker(), "t", (e) => events.push(e), { spawnFn: () => proc, now: () => NOW });
  await handle.done;
  assert.ok(
    events.some((e) => e.type === "log" && e.level === "error" && e.text === "thread 'main' panicked at boom"),
    "expected the panic line as an error log",
  );
  assert.ok(
    !events.some((e) => e.type === "log" && e.text.includes("Reading additional input")),
    "the benign stdin notice must be filtered",
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — events lack `ts`, and no stderr log events are emitted.

- [ ] **Step 3: Add the clock + stderr drain to the runner**

In `src/worker/runner.ts`, add `stderr` to `SpawnedProcess` and `now` to `RunDeps`:

```ts
export interface SpawnedProcess {
  stdout: AsyncIterable<Buffer>;
  stderr?: AsyncIterable<Buffer>;
  kill(): void;
  exit: Promise<{ code: number | null; error?: Error }>;
}

export interface RunDeps {
  spawnFn?: SpawnFn;
  adapter?: AgentAdapter;
  credentials?: Credentials;
  now?: () => number;
}
```

Rewrite the body of `runWorker` (the `done` IIFE) to stamp `ts` through a single `emit` choke point and drain stderr concurrently:

```ts
const now = deps.now ?? Date.now;
const emit = (e: WorkerEvent) => onEvent({ ...e, ts: now() });

const done = (async () => {
  const stderrDone = drainStderr(proc.stderr, emit);
  try {
    for await (const event of adapter.parseEvents(proc.stdout)) {
      emit(event);
    }
    const exit = await proc.exit;
    if (exit.error) {
      emit({ type: "error", message: errString(exit.error), transport: isTransport(exit.error) });
    } else if (exit.code !== null && exit.code !== 0) {
      emit({ type: "error", message: `codex exited with code ${exit.code}`, transport: false });
    }
  } catch (err) {
    emit({ type: "error", message: errString(err), transport: isTransport(err) });
  } finally {
    await stderrDone;
  }
})();

return { cancel: () => proc.kill(), done };
```

Add the drain helper at the bottom of the file:

```ts
async function drainStderr(
  stderr: AsyncIterable<Buffer> | undefined,
  emit: (e: WorkerEvent) => void,
): Promise<void> {
  if (!stderr) {
    return;
  }
  let buffer = "";
  for await (const chunk of stderr) {
    buffer += chunk.toString("utf8");
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      emitStderrLine(buffer.slice(0, nl), emit);
      buffer = buffer.slice(nl + 1);
    }
  }
  emitStderrLine(buffer, emit);
}

function emitStderrLine(line: string, emit: (e: WorkerEvent) => void): void {
  const text = line.trim();
  // ponytail: this notice is benign (stdin is /dev/null) and just noise — drop it.
  if (!text || text.startsWith("Reading additional input from stdin")) {
    return;
  }
  emit({ type: "log", level: "error", text });
}
```

In `defaultSpawn`, expose stderr (replace the `ponytail: stderr is ignored` comment and the return):

```ts
return {
  stdout: child.stdout!,
  stderr: child.stderr ?? undefined,
  kill: () => {
    child.kill();
  },
  exit,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all runner tests (updated + new).

- [ ] **Step 5: Commit**

```bash
git add src/worker/runner.ts src/worker/runner.test.ts
git commit -m "feat(worker): runner stamps event ts and surfaces child stderr"
```

---

### Task 4: Webview — event-typed timeline

**Files:**
- Modify: `src/webview/views/worker.tsx`

**Interfaces:**
- Consumes: the grown `WorkerEvent` (with `ts`).
- Produces: a timeline rendered from `WorkerEvent[]` state (replacing the flat `string[]`), with type-specific rows: reasoning (muted), tool-call (`▶ shell: <cmd>`), tool-result (`✓/✗ exit N` + output), file-change (`✎ <kind> <path>`), usage footer, errors, agent message.

- [ ] **Step 1: Switch state from formatted strings to events**

In `src/webview/views/worker.tsx`, replace the `lines` state and its `setLines` usages:

```tsx
const [events, setEvents] = useState<WorkerEvent[]>([]);
```

In the `onMessage` effect, push the raw event:

```tsx
if (msg.type === "taskEvent" && msg.workerId === WORKER_ID) {
  setEvents((prev) => [...prev, msg.event]);
  if (msg.event.type === "done" || msg.event.type === "error") {
    setRunning(false);
  }
}
```

In `run()`, reset with `setEvents([]);` instead of `setLines([]);`.

- [ ] **Step 2: Replace the output pane with a timeline renderer**

Replace the `<ScrollArea>` output block and the `formatEvent` function with a typed renderer. Output pane:

```tsx
<ScrollArea className="h-72 rounded-md border bg-card p-3">
  {events.length ? (
    <div className="flex flex-col gap-1 text-xs">
      {events.map((e, i) => (
        <EventRow key={i} event={e} />
      ))}
    </div>
  ) : (
    <p className="text-xs text-muted-foreground">Output will stream here.</p>
  )}
</ScrollArea>
```

Add the `EventRow` component (replaces `formatEvent`):

```tsx
function EventRow({ event: e }: { event: WorkerEvent }) {
  switch (e.type) {
    case "started":
      return <div className="text-muted-foreground">● started</div>;
    case "reasoning":
      return <div className="text-muted-foreground italic whitespace-pre-wrap">{e.text}</div>;
    case "agent-message":
      return <div className="whitespace-pre-wrap">{e.text}</div>;
    case "tool-call":
      return <div className="font-mono">▶ {e.name}{e.detail ? `: ${e.detail}` : ""}</div>;
    case "tool-result":
      return (
        <div className="font-mono">
          <span className={e.ok ? "text-green-500" : "text-red-500"}>{e.ok ? "✓" : "✗"}</span>{" "}
          exit {e.exitCode ?? "?"}
          {e.output ? <pre className="whitespace-pre-wrap opacity-80">{e.output}</pre> : null}
        </div>
      );
    case "file-change":
      return <div className="font-mono">✎ {e.kind} {e.path}</div>;
    case "usage":
      return (
        <div className="text-muted-foreground">
          tokens — in {e.inputTokens ?? 0} (cached {e.cachedInputTokens ?? 0}) · out {e.outputTokens ?? 0}
        </div>
      );
    case "log":
      return <div className={e.level === "error" ? "text-red-500" : "text-muted-foreground"}>{e.text}</div>;
    case "decision-request":
      return <div>question: {e.questions.map((q) => q.question).join(" | ")}</div>;
    case "done":
      return <div className="text-green-500">● done</div>;
    case "error":
      return <div className="text-red-500">error: {e.message}</div>;
  }
}
```

- [ ] **Step 3: Type-check, lint, and build**

Run: `npm run check-types && npm run lint && node esbuild.js`
Expected: no errors. (The `switch` is exhaustive over `WorkerEvent["type"]`; if a case is missing, `check-types` flags it.)

- [ ] **Step 4: Manual smoke test**

Launch the extension (F5 / Run Extension), open the Worker view, set a `workspace-write` working dir, and run: *"Briefly reason, then run `ls` and create a file note.txt with hi."* Confirm the timeline shows: started → reasoning (muted) → `▶ shell: ls` → `✓ exit 0` → `✎ add note.txt` → token footer → done.

- [ ] **Step 5: Commit**

```bash
git add src/webview/views/worker.tsx
git commit -m "feat(webview): event-typed Worker timeline"
```

---

## US-2: Verification gate — no "done" without proof

**What it does:** You give the Worker a list of shell checks (e.g. `npm test`, `npm run lint`). After the agent says it's finished, the runner runs each check itself in the working dir and reports whether they passed — the final result is marked *verified* only if every check passes. The agent's own word is never trusted.

**Why it's a vertical slice:** It adds the `verification` harness field (data), the post-`done` execution + `verified` flag (logic), and the verify-command inputs + pass/fail badges (UI). Runnable on its own: add a check that fails, watch the run come back **not verified**.

---

### Task 5: `Harness.verification` + runner post-`done` verification gate

**Files:**
- Modify: `src/worker/types.ts`
- Modify: `src/worker/runner.ts`
- Test: `src/worker/runner.test.ts`

**Interfaces:**
- Consumes: the runner's `emit` + terminal `done` from Task 3.
- Produces: `Harness.verification?: { command: string; label?: string }[]`; `RunDeps.verifyFn?: (command: string, cwd: string) => Promise<{ ok: boolean; output?: string }>` (default runs the command via `child_process.exec`). After a clean `done`, the runner runs each check in `harness.workingDir`, emits a `verification` event per check, and emits `done` with `verified` = (all checks passed). With no checks configured, `done` carries **no** `verified` key (unchanged Epic 1 shape).

- [ ] **Step 1: Write the failing tests**

Add to `src/worker/runner.test.ts`:

```ts
test("runs verification checks after done and sets verified", async () => {
  const events: WorkerEvent[] = [];
  const ran: { command: string; cwd: string }[] = [];
  const w = worker();
  w.harness.verification = [{ command: "npm test" }, { command: "npm run lint" }];
  const { proc } = fakeProcess(
    ['{"type":"item.completed","item":{"type":"agent_message","text":"all set"}}\n', '{"type":"turn.completed","usage":{}}\n'],
    { code: 0 },
  );
  const handle = runWorker(w, "t", (e) => events.push(e), {
    spawnFn: () => proc,
    now: () => NOW,
    verifyFn: async (command, cwd) => {
      ran.push({ command, cwd });
      return { ok: command === "npm test", output: command + " output" };
    },
  });
  await handle.done;
  assert.deepStrictEqual(ran, [
    { command: "npm test", cwd: w.harness.workingDir },
    { command: "npm run lint", cwd: w.harness.workingDir },
  ]);
  const verifications = events.filter((e) => e.type === "verification");
  assert.deepStrictEqual(
    verifications.map((e) => (e as { command: string; ok: boolean }).ok),
    [true, false],
  );
  const doneEvent = events.find((e) => e.type === "done") as { verified?: boolean };
  assert.strictEqual(doneEvent.verified, false);
});

test("done carries no verified key when no checks are configured", async () => {
  const events: WorkerEvent[] = [];
  const { proc } = fakeProcess(['{"type":"turn.completed","usage":{}}\n'], { code: 0 });
  const handle = runWorker(worker(), "t", (e) => events.push(e), { spawnFn: () => proc, now: () => NOW });
  await handle.done;
  assert.deepStrictEqual(events, [{ type: "done", lastMessage: undefined, ts: NOW }]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `verifyFn` is not a known dep; no `verification` events; `done` has no `verified`.

- [ ] **Step 3: Add the `verification` field to `Harness`**

In `src/worker/types.ts`, grow `Harness`:

```ts
export interface Harness {
  sandbox: SandboxMode;
  workingDir: string;
  verification?: { command: string; label?: string }[]; // independent checks run AFTER the agent's done (Epic 2)
  // ponytail: writableRoots/maxSteps/timeoutMs added in US-3 of this epic.
}
```

- [ ] **Step 4: Add the verification gate to the runner**

In `src/worker/runner.ts`, add `verifyFn` to `RunDeps` and a `VerifyFn` type:

```ts
export type VerifyFn = (command: string, cwd: string) => Promise<{ ok: boolean; output?: string }>;

export interface RunDeps {
  spawnFn?: SpawnFn;
  adapter?: AgentAdapter;
  credentials?: Credentials;
  now?: () => number;
  verifyFn?: VerifyFn;
}
```

The runner must withhold the parser's `done`, run the checks, then emit the final `done`. Update the `done` IIFE: hold a `pendingDone`, forward all other events, and after the exit checks pass, run verification. Replace the streaming loop + exit handling:

```ts
const verifyFn = deps.verifyFn ?? defaultVerify;
let pendingDone: Extract<WorkerEvent, { type: "done" }> | null = null;

const stderrDone = drainStderr(proc.stderr, emit);
try {
  for await (const event of adapter.parseEvents(proc.stdout)) {
    if (event.type === "done") {
      pendingDone = event;
      continue;
    }
    emit(event);
  }
  const exit = await proc.exit;
  if (exit.error) {
    emit({ type: "error", message: errString(exit.error), transport: isTransport(exit.error) });
  } else if (exit.code !== null && exit.code !== 0) {
    emit({ type: "error", message: `codex exited with code ${exit.code}`, transport: false });
  } else if (pendingDone) {
    const checks = worker.harness.verification ?? [];
    if (checks.length === 0) {
      emit(pendingDone);
    } else {
      let verified = true;
      for (const check of checks) {
        const r = await verifyFn(check.command, worker.harness.workingDir);
        emit({ type: "verification", command: check.command, ok: r.ok, output: r.output });
        if (!r.ok) {
          verified = false;
        }
      }
      emit({ ...pendingDone, verified });
    }
  }
} catch (err) {
  emit({ type: "error", message: errString(err), transport: isTransport(err) });
} finally {
  await stderrDone;
}
```

> Note: this also fixes an Epic 1 quirk — a non-zero exit now yields *only* an `error` (the `done` is withheld), instead of both `done` and `error`.

Add the default verifier and the `exec` import at the top:

```ts
import { spawn, exec } from "child_process";
```

```ts
const VERIFY_TIMEOUT_MS = 120_000;

function defaultVerify(command: string, cwd: string): Promise<{ ok: boolean; output?: string }> {
  return new Promise((resolve) => {
    exec(command, { cwd, timeout: VERIFY_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const output = `${stdout}${stderr}`.trim();
      resolve({ ok: !err, output: output || undefined });
    });
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — verification cases pass; the no-checks `done` shape is unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/worker/types.ts src/worker/runner.ts src/worker/runner.test.ts
git commit -m "feat(worker): post-done verification gate (verify[] -> verified)"
```

---

### Task 6: Webview — verification inputs + badges

**Files:**
- Modify: `src/webview/views/worker.tsx`

**Interfaces:**
- Consumes: `Harness.verification`, the `verification` event, and `done.verified`.
- Produces: an editable list of verify commands wired into `worker.harness.verification`, plus rendering of `verification` events (✓/✗ per command) and a verified summary on `done`.

- [ ] **Step 1: Add verify-command state and inputs**

In `worker.tsx`, add state:

```tsx
const [verifyCommands, setVerifyCommands] = useState<string[]>([]);
```

Add an inputs block (after the Task textarea, before the Run/Cancel row):

```tsx
<div className="flex flex-col gap-1.5">
  <Label>Verification checks (run after the agent finishes)</Label>
  {verifyCommands.map((cmd, i) => (
    <div key={i} className="flex gap-2">
      <Input
        value={cmd}
        onChange={(e) =>
          setVerifyCommands((prev) => prev.map((c, j) => (j === i ? e.target.value : c)))
        }
        placeholder="npm test"
      />
      <Button variant="outline" onClick={() => setVerifyCommands((prev) => prev.filter((_, j) => j !== i))}>
        Remove
      </Button>
    </div>
  ))}
  <Button variant="outline" onClick={() => setVerifyCommands((prev) => [...prev, ""])}>
    Add check
  </Button>
</div>
```

- [ ] **Step 2: Wire the checks into the run payload**

In `run()`, set `harness.verification` from the non-empty commands:

```tsx
harness: {
  sandbox,
  workingDir: workingDir.trim(),
  verification: verifyCommands.map((c) => c.trim()).filter(Boolean).map((command) => ({ command })),
},
```

- [ ] **Step 3: Render verification events + verified summary**

In `EventRow`, the `verification` case is already covered if you added it; ensure it renders:

```tsx
case "verification":
  return (
    <div className="font-mono">
      <span className={e.ok ? "text-green-500" : "text-red-500"}>{e.ok ? "✓" : "✗"}</span> verify: {e.command}
      {e.output ? <pre className="whitespace-pre-wrap opacity-80">{e.output}</pre> : null}
    </div>
  );
```

And update the `done` case to show the verified verdict:

```tsx
case "done":
  return (
    <div className={e.verified === false ? "text-red-500" : "text-green-500"}>
      ● done{e.verified === undefined ? "" : e.verified ? " — verified ✓" : " — NOT verified ✗"}
    </div>
  );
```

- [ ] **Step 4: Type-check, lint, build**

Run: `npm run check-types && npm run lint && node esbuild.js`
Expected: no errors.

- [ ] **Step 5: Manual smoke test**

Run a trivial task with two checks: one that passes (`true`) and one that fails (`false`). Confirm the timeline shows `✓ verify: true`, `✗ verify: false`, and `● done — NOT verified ✗`.

- [ ] **Step 6: Commit**

```bash
git add src/webview/views/worker.tsx
git commit -m "feat(webview): verification command inputs and verified badges"
```

---

## US-3: Guardrails — cap what it can spend and touch

**What it does:** You can cap how many tool calls and how long a run may go; the runner kills the process and tells you *why* when a cap is breached. You also control the sandbox mode and any extra writable directories the agent is allowed to touch.

**Why it's a vertical slice:** It adds the cap + writable-root harness fields (data), the runner circuit breaker + the `--add-dir` argv mapping (logic), and the cap/dir inputs (UI). Runnable on its own: set `maxSteps: 1`, watch a multi-command task get killed with "step cap (1) exceeded".

---

### Task 7: `Harness.maxSteps`/`timeoutMs` + runner circuit breaker

**Files:**
- Modify: `src/worker/types.ts`
- Modify: `src/worker/runner.ts`
- Test: `src/worker/runner.test.ts`

**Interfaces:**
- Consumes: the runner loop + `tool-call` events.
- Produces: `Harness.maxSteps?: number` and `Harness.timeoutMs?: number`. The runner counts `tool-call` events; exceeding `maxSteps` triggers `proc.kill()` and an `error` `"step cap (N) exceeded"`. A `timeoutMs` wall-clock timer triggers `proc.kill()` and an `error` `"timeout (Nms) exceeded"`. When a cap fires, no `done`/verification runs.

- [ ] **Step 1: Write the failing tests**

`fakeProcess` from Task 3 returns a static stdout stream, so `kill()` doesn't stop it — that's fine: the breaker's job is to *emit the error and stop forwarding*. Add to `src/worker/runner.test.ts`:

```ts
test("kills and errors when the step cap is exceeded", async () => {
  const events: WorkerEvent[] = [];
  const w = worker();
  w.harness.maxSteps = 1;
  const { proc, wasKilled } = fakeProcess(
    [
      '{"type":"item.started","item":{"id":"a","type":"command_execution","command":"echo 1"}}\n',
      '{"type":"item.started","item":{"id":"b","type":"command_execution","command":"echo 2"}}\n',
      '{"type":"turn.completed","usage":{}}\n',
    ],
    { code: null },
  );
  const handle = runWorker(w, "t", (e) => events.push(e), { spawnFn: () => proc, now: () => NOW });
  await handle.done;
  assert.strictEqual(wasKilled(), true);
  const err = events.find((e) => e.type === "error") as { message: string } | undefined;
  assert.strictEqual(err?.message, "step cap (1) exceeded");
  assert.ok(!events.some((e) => e.type === "done"), "no done after a cap kill");
});

test("kills and errors when the wall-clock timeout fires", async () => {
  const events: WorkerEvent[] = [];
  const w = worker();
  w.harness.timeoutMs = 5;
  // a stdout that never ends until killed
  async function* hang(): AsyncIterable<Buffer> {
    await new Promise((r) => setTimeout(r, 1000));
    yield Buffer.from('{"type":"turn.completed","usage":{}}\n');
  }
  let killed = false;
  const proc: SpawnedProcess = {
    stdout: hang(),
    kill: () => {
      killed = true;
    },
    exit: new Promise((resolve) => setTimeout(() => resolve({ code: null }), 20)),
  };
  const handle = runWorker(w, "t", (e) => events.push(e), { spawnFn: () => proc, now: () => NOW });
  await handle.done;
  assert.strictEqual(killed, true);
  const err = events.find((e) => e.type === "error") as { message: string } | undefined;
  assert.strictEqual(err?.message, "timeout (5ms) exceeded");
});
```

> The timeout test needs the loop to actually stop on kill. Since the fake `kill()` only flips a flag, drive loop termination off `proc.exit`: race the parser loop against `exit`. The implementation below does that via an `aborted` flag the timer/cap set, checked each iteration, plus resolving when `exit` settles. For the hang test, `exit` resolves at 20ms (after the 5ms timer fires `kill`), ending the run.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `maxSteps`/`timeoutMs` are not on `Harness`; no caps enforced.

- [ ] **Step 3: Add the cap fields to `Harness`**

In `src/worker/types.ts`:

```ts
export interface Harness {
  sandbox: SandboxMode;
  workingDir: string;
  writableRoots?: string[]; // extra --add-dir writable roots (Epic 2)
  verification?: { command: string; label?: string }[];
  maxSteps?: number; // circuit breaker: max tool-call events before kill (Epic 2)
  timeoutMs?: number; // circuit breaker: wall-clock kill (Epic 2)
}
```

- [ ] **Step 4: Add the circuit breaker to the runner**

In `runWorker`, before the stream loop, set up the abort flag, the timer, and a step counter. The loop checks `aborted` each iteration; the wall-clock timer and the step cap both set `aborted` + a `stopReason`, call `proc.kill()`, and the loop exits. Insert at the top of the `done` IIFE (before `stderrDone`):

```ts
const harness = worker.harness;
let toolCalls = 0;
let stopReason: "steps" | "timeout" | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
if (harness.timeoutMs && harness.timeoutMs > 0) {
  timer = setTimeout(() => {
    if (stopReason === null) {
      stopReason = "timeout";
      proc.kill();
    }
  }, harness.timeoutMs);
}
```

In the stream loop, count tool calls and break on the cap; and stop early if a timeout already fired. Replace the `for await` body's head:

```ts
for await (const event of adapter.parseEvents(proc.stdout)) {
  if (stopReason === "timeout") {
    break;
  }
  if (event.type === "tool-call") {
    toolCalls++;
    if (harness.maxSteps && toolCalls > harness.maxSteps) {
      stopReason = "steps";
      emit(event);
      proc.kill();
      break;
    }
  }
  if (event.type === "done") {
    pendingDone = event;
    continue;
  }
  emit(event);
}
```

After the loop, handle the stop reasons *before* the exit/verification block (they take precedence), and clear the timer in `finally`:

```ts
await proc.exit;
if (stopReason === "steps") {
  emit({ type: "error", message: `step cap (${harness.maxSteps}) exceeded`, transport: false });
} else if (stopReason === "timeout") {
  emit({ type: "error", message: `timeout (${harness.timeoutMs}ms) exceeded`, transport: false });
} else if (/* the existing exit.error / non-zero / pendingDone chain */) {
  // unchanged from Task 5 — but read `exit` from the awaited value above
}
```

To keep one `await proc.exit`, capture it: `const exit = await proc.exit;` then the chain uses `exit`. Add `if (timer) { clearTimeout(timer); }` in the `finally` block alongside `await stderrDone`.

> ponytail: the breaker counts `tool-call` events and races the parser against `proc.exit` — good enough for the CLI bridge. A token-based mid-run budget isn't possible (Codex reports usage only at the end); that lands in Epic 5's HTTP loop where we own each request.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — step-cap and timeout cases pass; all earlier runner tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/worker/types.ts src/worker/runner.ts src/worker/runner.test.ts
git commit -m "feat(worker): runner circuit breaker — maxSteps and timeoutMs"
```

---

### Task 8: Webview + adapter — caps and writable-roots controls

**Files:**
- Modify: `src/worker/adapters/codex.ts`
- Test: `src/worker/adapters/codex.test.ts`
- Modify: `src/webview/views/worker.tsx`

**Interfaces:**
- Consumes: `Harness.writableRoots`, `maxSteps`, `timeoutMs`.
- Produces: `buildInvocation` appends `--add-dir <root>` for each `harness.writableRoots` entry; the webview exposes step/timeout/writable-dir inputs wired into the harness.

- [ ] **Step 1: Write the failing adapter test**

Add to `src/worker/adapters/codex.test.ts` (in the `buildInvocation` suite). First extend the `sampleWorker` helper to allow harness overrides, or build inline:

```ts
test("appends --add-dir for each writable root", () => {
  const w = sampleWorker();
  w.harness.writableRoots = ["/extra/one", "/extra/two"];
  const inv = codexAdapter.buildInvocation(w, "t", {});
  const flags = inv.args.filter((_, i) => inv.args[i - 1] === "--add-dir");
  assert.deepStrictEqual(flags, ["/extra/one", "/extra/two"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — no `--add-dir` in argv.

- [ ] **Step 3: Add `--add-dir` to `buildInvocation`**

In `src/worker/adapters/codex.ts`, after the base `args` array and before the `-m` block:

```ts
for (const root of harness.writableRoots ?? []) {
  args.push("--add-dir", root);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Add caps + writable-dir inputs to the webview**

In `worker.tsx`, add state:

```tsx
const [maxSteps, setMaxSteps] = useState("");
const [timeoutSec, setTimeoutSec] = useState("");
const [writableDirs, setWritableDirs] = useState("");
```

Add an inputs block (a 3-column grid near the sandbox controls):

```tsx
<div className="grid grid-cols-3 gap-3">
  <div className="flex flex-col gap-1.5">
    <Label htmlFor="worker-maxsteps">Max steps</Label>
    <Input id="worker-maxsteps" value={maxSteps} onChange={(e) => setMaxSteps(e.target.value)} placeholder="∞" />
  </div>
  <div className="flex flex-col gap-1.5">
    <Label htmlFor="worker-timeout">Timeout (s)</Label>
    <Input id="worker-timeout" value={timeoutSec} onChange={(e) => setTimeoutSec(e.target.value)} placeholder="∞" />
  </div>
  <div className="flex flex-col gap-1.5">
    <Label htmlFor="worker-writable">Extra writable dirs (comma-sep)</Label>
    <Input id="worker-writable" value={writableDirs} onChange={(e) => setWritableDirs(e.target.value)} placeholder="/path/a,/path/b" />
  </div>
</div>
```

- [ ] **Step 6: Wire the caps into the run payload**

In `run()`, extend the `harness` object (parse numbers, drop blanks):

```tsx
harness: {
  sandbox,
  workingDir: workingDir.trim(),
  verification: verifyCommands.map((c) => c.trim()).filter(Boolean).map((command) => ({ command })),
  writableRoots: writableDirs.split(",").map((d) => d.trim()).filter(Boolean),
  maxSteps: maxSteps.trim() ? Number(maxSteps) : undefined,
  timeoutMs: timeoutSec.trim() ? Number(timeoutSec) * 1000 : undefined,
},
```

- [ ] **Step 7: Type-check, lint, build**

Run: `npm run check-types && npm run lint && node esbuild.js`
Expected: no errors.

- [ ] **Step 8: Manual smoke test**

Set Max steps = 1 and run a task that needs two commands (e.g. *"run `ls` then run `pwd`"*). Confirm the run is killed and the timeline shows `error: step cap (1) exceeded`. Then clear it, set Timeout = 3, run a long task, and confirm `error: timeout (3000ms) exceeded`.

- [ ] **Step 9: Commit**

```bash
git add src/worker/adapters/codex.ts src/worker/adapters/codex.test.ts src/webview/views/worker.tsx
git commit -m "feat(worker): writable-roots (--add-dir) and webview cap controls"
```

---

## Out of scope (correctly deferred)

- **Auto-repair / re-prompt on failed verification** — Epic 2 makes `verified: false` visible; acting on it is the Orchestrator's loop (Epic 3+).
- **Soul injection** (Epic 3).
- **Mid-run token budget** — Codex reports usage only at `turn.completed`; a real token cap belongs to Epic 5's HTTP loop where we own each request. Epic 2 surfaces final usage only.
- **Approval-as-code** — stays Codex execpolicy `.rules` config + `--ask-for-approval never`, not runtime code (deny-lists are the durable headless guarantee).
- **`mcp_tool_call` / `web_search` rich mapping** — left as the `log` fallback until a fixture proves their real shapes (Epic 4 touches MCP).
- **Multi-account / tier fallback** (Epic 6).

## Self-Review

- **Spec §5 coverage:** Observability (§5 row) → US-1; Verification (§5 row + §11 discipline) → US-2; Guardrails (§5 row: sandbox, `--add-dir`, caps) → US-3. Agent loop / tool dispatch / memory stay the CLI's (configured, not built) — correct for the CLI protocol.
- **Spec §12 Epic 2 deliverable** ("shows what it's doing + refuses to claim done without passing checks") → US-1 timeline + US-2 verified gate. ✓
- **CLI-agnostic contract:** all `WorkerEvent`/`Harness` additions are in the node-free type files; only `codex.ts` is Codex-specific. ✓
- **Type consistency:** `verifyFn`/`VerifyFn`, `pendingDone`, `stopReason`, `Harness.{verification,writableRoots,maxSteps,timeoutMs}`, `WorkerEvent` members are used with identical names/shapes across Tasks 2–8. The runner's `emit`/`ts` choke point (Task 3) is reused by Tasks 5 and 7.
- **No placeholders:** every code step shows real code; every test shows real assertions; the one prose-described block (Task 7 Step 4 exit chain) explicitly says "unchanged from Task 5" and shows how to thread the awaited `exit`.
```
