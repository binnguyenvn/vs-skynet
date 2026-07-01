# Interactive Codex Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second, interactive run mode to the codex adapter that drives `codex` as a live TUI inside a VSCode terminal — multi-turn steering with pause/resume in one session — proven against a real `codex` install, alongside the existing one-shot `runCodex`.

**Architecture:** A CLI-agnostic core under `src/adapters/interactive/` (mailbox, doorbell, instruction-file bootstrap, crash detection, session harvesting, and the `InteractiveSession` state machine) driven entirely through files and a `TerminalTransport` interface, so the core is testable without a real CLI. `src/adapters/codex/interactive-profile.ts` supplies the one CLI-specific seam (`codexInteractive: InteractiveCliProfile`) — launch argv, env, instruction file, submit key, and a rollout-JSONL parser. `codexAdapter.runInteractive()` wires the two together.

**Tech Stack:** TypeScript (Node16 modules, strict), VSCode extension API (`vscode.window.createTerminal`), Node `child_process`/`fs/promises`/`events`, mocha/`@vscode/test-cli` test runner, `assert`.

## Global Constraints

- This is **additive only**: `runCodex` / `codexAdapter.run` (`src/adapters/codex/codex-adapter.ts`) are unchanged. Interactive mode is a new sibling.
- Verified against `codex-cli 0.142.4` and the launch argv proven by `src/test/terminal-probe.test.ts` (`TERMINAL_PROBE=1`, run 2026-07-01): `codex -C <cwd> [-m <model>] -s <sandbox> -a never -c disable_paste_burst=true -c 'tui.keymap.composer.submit="tab"' -c 'tui.keymap.composer.queue="ctrl-q"'`, submit key `"\t"`.
- Default timeouts: `turnTimeoutMs` 300000 (5 min), `readyTimeoutMs` 30000 (30s, turn-1 only, retries the doorbell once on expiry).
- Crash detection (`ps -Ao pid,ppid,comm` descendant walk) is **macOS/Linux only** in v1; Windows is out of scope (matches the spec).
- The mailbox reader is a **poll loop**, not `vscode.FileSystemWatcher` — see `docs/superpowers/specs/2026-06-30-interactive-codex-design.md` for why (groomed 2026-07-01).
- Protocol bootstrap **never overwrites** a target repo's real instruction file (`AGENTS.md` for codex); it appends a marker-delimited block and strips it back out on `dispose()`.
- Tests reuse the existing runner: `*.test.ts` under `src/test/`, compiled to `out/` by `npm run compile-tests`, run with `npm test`.
- The real-CLI integration test is gated behind `process.env.CODEX_INTERACTIVE_E2E` so `npm test` does not burn quota by default (mirrors the existing `CODEX_E2E` convention in `src/test/codex-adapter.integration.test.ts`).
- Relative imports omit the `.js` extension (matches existing `src/test/*.test.ts`).
- Spec: [`docs/superpowers/specs/2026-06-30-interactive-codex-design.md`](../specs/2026-06-30-interactive-codex-design.md) (read first — this plan implements it as groomed 2026-07-01).

---

## US-1: Interactive Codex Mode

A developer can call `codexAdapter.runInteractive({cwd, workerId})`, get back an `InteractiveSession`, `send()` turns that pause or complete, watch a sparse `WorkerEvent` stream, read a harvested `sessionId`/usage from codex's own rollout JSONL, and `dispose()` cleanly — proven by deterministic unit tests (fake terminal transport) plus an opt-in real-CLI integration test that mirrors the already-passing `terminal-probe.test.ts` scenario through the production code path.

### Task 1: Shared interactive types + shell quoting

**Files:**
- Create: `src/adapters/interactive/types.ts`
- Create: `src/adapters/interactive/shell.ts`
- Test: `src/test/interactive-shell.test.ts`

**Interfaces:**
- Consumes: `ErrorClass`, `WorkerEvent`, `WorkerUsage` from `../types` (`src/adapters/types.ts`).
- Produces:
  - `interface InteractiveOpts { cwd: string; workerId: string; model?: string; configDir?: string; sandbox?: "read-only"|"workspace-write"|"danger-full-access"; turnTimeoutMs?: number; readyTimeoutMs?: number }`
  - `type TurnResult = { status: "paused"; summary: string } | { status: "done"; summary: string; usage?: WorkerUsage; filesTouched?: string[] } | { status: "error"; reason: string; errorClass?: ErrorClass } | { status: "timeout" } | { status: "crashed" }`
  - `interface InteractiveSession extends AsyncIterable<WorkerEvent> { send(prompt: string): Promise<TurnResult>; readonly sessionId: Promise<string | undefined>; dispose(): Promise<void> }`
  - `interface HarvestResult { sessionId?: string; usage?: WorkerUsage; rateLimits?: unknown }`
  - `interface InteractiveCliProfile { id: "codex"|"claude"|"agy"; launchArgv(opts: InteractiveOpts): string[]; configEnv(configDir?: string): Record<string,string>; instructionFile: string; submitSequence: string; sessionDir(configDir?: string): string; harvest(sessionFileText: string): HarvestResult; sessionInfoPrompt?(outboxPath: string): string }`
  - `interface TerminalTransport { show(preserveFocus: boolean): void; sendText(text: string, addNewLine: boolean): void; sendSequence(sequence: string): Promise<void>; processId(): Promise<number | undefined>; onDidClose(listener: (exitCode: number|undefined) => void): {dispose():void}; dispose(): void }`
  - `interface TerminalFactory { create(opts: {name: string; cwd: string; env: Record<string,string>}): TerminalTransport }`
  - `function shellQuote(value: string): string`
  - `function buildLaunchCommand(binary: string, argv: string[]): string`

- [ ] **Step 1: Create the types file (no test — pure declarations)**

Create `src/adapters/interactive/types.ts`:

```ts
import type { ErrorClass, WorkerEvent, WorkerUsage } from "../types";

export interface InteractiveOpts {
  cwd: string;
  workerId: string;
  model?: string;
  configDir?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  turnTimeoutMs?: number;
  readyTimeoutMs?: number;
}

export type TurnResult =
  | { status: "paused"; summary: string }
  | { status: "done"; summary: string; usage?: WorkerUsage; filesTouched?: string[] }
  | { status: "error"; reason: string; errorClass?: ErrorClass }
  | { status: "timeout" }
  | { status: "crashed" };

export interface InteractiveSession extends AsyncIterable<WorkerEvent> {
  send(prompt: string): Promise<TurnResult>;
  readonly sessionId: Promise<string | undefined>;
  dispose(): Promise<void>;
}

export interface HarvestResult {
  sessionId?: string;
  usage?: WorkerUsage;
  rateLimits?: unknown;
}

export interface InteractiveCliProfile {
  id: "codex" | "claude" | "agy";
  launchArgv(opts: InteractiveOpts): string[];
  configEnv(configDir?: string): Record<string, string>;
  instructionFile: string;
  submitSequence: string;
  sessionDir(configDir?: string): string;
  harvest(sessionFileText: string): HarvestResult;
  sessionInfoPrompt?(outboxPath: string): string;
}

export interface TerminalTransport {
  show(preserveFocus: boolean): void;
  sendText(text: string, addNewLine: boolean): void;
  sendSequence(sequence: string): Promise<void>;
  processId(): Promise<number | undefined>;
  onDidClose(listener: (exitCode: number | undefined) => void): { dispose(): void };
  dispose(): void;
}

export interface TerminalFactory {
  create(opts: { name: string; cwd: string; env: Record<string, string> }): TerminalTransport;
}
```

- [ ] **Step 2: Write the failing test for `shell.ts`**

Create `src/test/interactive-shell.test.ts`:

```ts
import * as assert from "assert";
import { buildLaunchCommand, shellQuote } from "../adapters/interactive/shell";

suite("shellQuote", () => {
  test("wraps a plain value in single quotes", () => {
    assert.strictEqual(shellQuote("workspace-write"), "'workspace-write'");
  });

  test("escapes embedded single quotes", () => {
    assert.strictEqual(shellQuote("it's"), "'it'\\''s'");
  });

  test("wraps a path with spaces", () => {
    assert.strictEqual(shellQuote("/tmp/with space"), "'/tmp/with space'");
  });
});

suite("buildLaunchCommand", () => {
  test("joins the binary name with each quoted argv token", () => {
    assert.strictEqual(
      buildLaunchCommand("codex", ["-C", "/tmp/proj", "-s", "workspace-write"]),
      "codex '-C' '/tmp/proj' '-s' 'workspace-write'"
    );
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run compile-tests`
Expected: FAIL — `Cannot find module '../adapters/interactive/shell'`.

- [ ] **Step 4: Write minimal implementation**

Create `src/adapters/interactive/shell.ts`:

```ts
// Uniformly single-quotes every argv token before joining. A quoted flag
// (e.g. '-C') behaves identically to an unquoted one in a POSIX shell, so
// this skips per-token special-character detection — proven by
// terminal-probe.test.ts's launch commands, which quote the same way.
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildLaunchCommand(binary: string, argv: string[]): string {
  return [binary, ...argv.map(shellQuote)].join(" ");
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all `shellQuote`/`buildLaunchCommand` cases green.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/interactive/types.ts src/adapters/interactive/shell.ts src/test/interactive-shell.test.ts
git commit -m "feat: interactive mode shared types + shell quoting"
```

---

### Task 2: Mailbox

**Files:**
- Create: `src/adapters/interactive/fs-helpers.ts`
- Create: `src/adapters/interactive/mailbox.ts`
- Test: `src/test/interactive-mailbox.test.ts`

**Interfaces:**
- Consumes: nothing beyond Node stdlib.
- Produces:
  - `function readFileIfExists(filePath: string): Promise<string>` (returns `""` on `ENOENT`, rethrows otherwise) — shared with Task 4's `instruction-file.ts` so the two call sites don't diverge.
  - `class Mailbox { readonly relativeDir: string; readonly dir: string; constructor(cwd: string, workerId: string); ensureDirs(): Promise<void>; ensureGitignored(cwd: string): Promise<void>; writeInbox(turn: number, text: string): Promise<void>; tryReadOutbox(turn: number): Promise<unknown>; dispose(): Promise<void> }`
  - `relativeDir` is `.skynet/<workerId>` (forward-slash, used inside ping text and the instruction-file protocol, independent of host path separator).
  - `tryReadOutbox` is a **single non-blocking attempt**: returns `undefined` if the file doesn't exist yet or isn't valid JSON yet (mid-write); throws on any other error. The retry/poll loop lives in `InteractiveSession` (Task 9), not here.

- [ ] **Step 1: Write the failing test**

Create `src/test/interactive-mailbox.test.ts`:

```ts
import * as assert from "assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Mailbox } from "../adapters/interactive/mailbox";

async function mkTmpRepo(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "mailbox-test-"));
}

suite("Mailbox", () => {
  test("writeInbox writes the exact turn file under inbox/", async () => {
    const cwd = await mkTmpRepo();
    const mailbox = new Mailbox(cwd, "w1");
    await mailbox.ensureDirs();
    await mailbox.writeInbox(1, "do the thing");
    const written = await fs.readFile(path.join(cwd, ".skynet", "w1", "inbox", "turn-1.md"), "utf8");
    assert.strictEqual(written, "do the thing");
  });

  test("tryReadOutbox returns undefined when the file does not exist yet", async () => {
    const cwd = await mkTmpRepo();
    const mailbox = new Mailbox(cwd, "w2");
    await mailbox.ensureDirs();
    assert.strictEqual(await mailbox.tryReadOutbox(1), undefined);
  });

  test("tryReadOutbox returns undefined on a half-written (invalid JSON) file, then the parsed value once valid", async () => {
    const cwd = await mkTmpRepo();
    const mailbox = new Mailbox(cwd, "w3");
    await mailbox.ensureDirs();
    const outboxFile = path.join(cwd, ".skynet", "w3", "outbox", "turn-1.json");

    await fs.writeFile(outboxFile, '{"status":"paus'); // mid-write
    assert.strictEqual(await mailbox.tryReadOutbox(1), undefined);

    await fs.writeFile(outboxFile, '{"status":"paused","summary":"ok"}');
    assert.deepStrictEqual(await mailbox.tryReadOutbox(1), { status: "paused", summary: "ok" });
  });

  test("ensureGitignored creates .gitignore with .skynet/ when absent, appends when present, no-ops when already listed", async () => {
    const cwd = await mkTmpRepo();
    const mailbox = new Mailbox(cwd, "w4");

    await mailbox.ensureGitignored(cwd);
    assert.strictEqual(await fs.readFile(path.join(cwd, ".gitignore"), "utf8"), ".skynet/\n");

    await fs.writeFile(path.join(cwd, ".gitignore"), "node_modules/\n");
    await mailbox.ensureGitignored(cwd);
    assert.strictEqual(await fs.readFile(path.join(cwd, ".gitignore"), "utf8"), "node_modules/\n.skynet/\n");

    await mailbox.ensureGitignored(cwd);
    assert.strictEqual(await fs.readFile(path.join(cwd, ".gitignore"), "utf8"), "node_modules/\n.skynet/\n");
  });

  test("dispose removes the worker's mailbox dir", async () => {
    const cwd = await mkTmpRepo();
    const mailbox = new Mailbox(cwd, "w5");
    await mailbox.ensureDirs();
    await mailbox.dispose();
    await assert.rejects(fs.access(mailbox.dir));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile-tests`
Expected: FAIL — `Cannot find module '../adapters/interactive/mailbox'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/adapters/interactive/fs-helpers.ts`:

```ts
import * as fs from "node:fs/promises";

export async function readFileIfExists(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw err;
  }
}
```

Create `src/adapters/interactive/mailbox.ts`:

```ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { readFileIfExists } from "./fs-helpers";

export class Mailbox {
  readonly relativeDir: string;
  readonly dir: string;

  constructor(cwd: string, workerId: string) {
    this.relativeDir = `.skynet/${workerId}`;
    this.dir = path.join(cwd, ".skynet", workerId);
  }

  async ensureDirs(): Promise<void> {
    await fs.mkdir(path.join(this.dir, "inbox"), { recursive: true });
    await fs.mkdir(path.join(this.dir, "outbox"), { recursive: true });
  }

  async ensureGitignored(cwd: string): Promise<void> {
    const gitignorePath = path.join(cwd, ".gitignore");
    const existing = await readFileIfExists(gitignorePath);
    if (existing.split("\n").some((line) => line.trim() === ".skynet/")) {
      return;
    }
    const withNewline = existing.length && !existing.endsWith("\n") ? `${existing}\n` : existing;
    await fs.writeFile(gitignorePath, `${withNewline}.skynet/\n`);
  }

  async writeInbox(turn: number, text: string): Promise<void> {
    await fs.writeFile(path.join(this.dir, "inbox", `turn-${turn}.md`), text);
  }

  async tryReadOutbox(turn: number): Promise<unknown> {
    const file = path.join(this.dir, "outbox", `turn-${turn}.json`);
    try {
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && !(err instanceof SyntaxError)) {
        throw err;
      }
      return undefined;
    }
  }

  async dispose(): Promise<void> {
    await fs.rm(this.dir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all `Mailbox` cases green.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/interactive/fs-helpers.ts src/adapters/interactive/mailbox.ts src/test/interactive-mailbox.test.ts
git commit -m "feat: interactive mode mailbox (inbox/outbox, gitignore, dispose)"
```

---

### Task 3: FakeTerminalTransport test double + Doorbell

**Files:**
- Create: `src/test/helpers/fake-terminal-transport.ts`
- Create: `src/adapters/interactive/doorbell.ts`
- Test: `src/test/interactive-doorbell.test.ts`

**Interfaces:**
- Consumes: `TerminalTransport` from `../adapters/interactive/types` (Task 1).
- Produces:
  - `class FakeTerminalTransport implements TerminalTransport` with a public `calls: {method: "show"|"sendText"|"sendSequence"|"dispose"; args: unknown[]}[]` log and `simulateClose(exitCode?: number): void`.
  - `function ring(transport: TerminalTransport, pingLine: string, submitSequence: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `src/test/helpers/fake-terminal-transport.ts` (test double, not a `.test.ts` — not run as its own suite):

```ts
import type { TerminalTransport } from "../../adapters/interactive/types";

export interface RecordedCall {
  method: "show" | "sendText" | "sendSequence" | "dispose";
  args: unknown[];
}

export class FakeTerminalTransport implements TerminalTransport {
  readonly calls: RecordedCall[] = [];
  pid: number | undefined = 4242;
  private readonly closeListeners: Array<(exitCode: number | undefined) => void> = [];

  show(preserveFocus: boolean): void {
    this.calls.push({ method: "show", args: [preserveFocus] });
  }

  sendText(text: string, addNewLine: boolean): void {
    this.calls.push({ method: "sendText", args: [text, addNewLine] });
  }

  async sendSequence(sequence: string): Promise<void> {
    this.calls.push({ method: "sendSequence", args: [sequence] });
  }

  async processId(): Promise<number | undefined> {
    return this.pid;
  }

  onDidClose(listener: (exitCode: number | undefined) => void): { dispose(): void } {
    this.closeListeners.push(listener);
    return {
      dispose: () => {
        const index = this.closeListeners.indexOf(listener);
        if (index !== -1) {
          this.closeListeners.splice(index, 1);
        }
      },
    };
  }

  dispose(): void {
    this.calls.push({ method: "dispose", args: [] });
  }

  simulateClose(exitCode?: number): void {
    this.closeListeners.forEach((listener) => listener(exitCode));
  }
}
```

Create `src/test/interactive-doorbell.test.ts`:

```ts
import * as assert from "assert";
import { ring } from "../adapters/interactive/doorbell";
import { FakeTerminalTransport } from "./helpers/fake-terminal-transport";

suite("ring (doorbell)", () => {
  test("shows the terminal, sends the ping as plain text, then sends the submit sequence — in that order", async () => {
    const transport = new FakeTerminalTransport();
    await ring(transport, "Read .skynet/w1/inbox/turn-1.md and follow it.", "\t");
    assert.deepStrictEqual(transport.calls, [
      { method: "show", args: [false] },
      { method: "sendText", args: ["Read .skynet/w1/inbox/turn-1.md and follow it.", false] },
      { method: "sendSequence", args: ["\t"] },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile-tests`
Expected: FAIL — `Cannot find module '../adapters/interactive/doorbell'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/adapters/interactive/doorbell.ts`:

```ts
import type { TerminalTransport } from "./types";

export async function ring(
  transport: TerminalTransport,
  pingLine: string,
  submitSequence: string
): Promise<void> {
  transport.show(false);
  transport.sendText(pingLine, false);
  await transport.sendSequence(submitSequence);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — `ring (doorbell)` suite green.

- [ ] **Step 5: Commit**

```bash
git add src/test/helpers/fake-terminal-transport.ts src/adapters/interactive/doorbell.ts src/test/interactive-doorbell.test.ts
git commit -m "feat: interactive mode doorbell + fake terminal transport test double"
```

---

### Task 4: Instruction-file bootstrap/teardown (marker-delimited, non-destructive)

**Files:**
- Create: `src/adapters/interactive/instruction-file.ts`
- Test: `src/test/interactive-instruction-file.test.ts`

**Interfaces:**
- Consumes: `readFileIfExists` from `./fs-helpers` (Task 2).
- Produces:
  - `function bootstrapInstructionFile(cwd: string, fileName: string, mailboxRelativeDir: string): Promise<void>`
  - `function teardownInstructionFile(cwd: string, fileName: string): Promise<void>`

This is the fix for the safety gap found during grooming: a target repo's real `AGENTS.md`/`CLAUDE.md` carries real instructions the CLI reads on every launch, ours or not. Bootstrap must **append**, never overwrite; teardown must restore the file to its pre-session content.

Note: `stripBlock` calls `.trim()`, so teardown normalizes to a single trailing newline rather than byte-for-byte restoring original trailing whitespace — acceptable for v1, called out here so it isn't mistaken for a bug later.

- [ ] **Step 1: Write the failing test**

Create `src/test/interactive-instruction-file.test.ts`:

```ts
import * as assert from "assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { bootstrapInstructionFile, teardownInstructionFile } from "../adapters/interactive/instruction-file";

async function mkTmpRepo(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "instruction-file-test-"));
}

suite("instruction file bootstrap/teardown", () => {
  test("bootstrap on a nonexistent file creates it with only the marker block; teardown removes the file entirely", async () => {
    const cwd = await mkTmpRepo();
    await bootstrapInstructionFile(cwd, "AGENTS.md", ".skynet/w1");
    const created = await fs.readFile(path.join(cwd, "AGENTS.md"), "utf8");
    assert.ok(created.includes("<!-- skynet-interactive:BEGIN -->"));
    assert.ok(created.includes(".skynet/w1/inbox/turn-N.md"));

    await teardownInstructionFile(cwd, "AGENTS.md");
    await assert.rejects(fs.access(path.join(cwd, "AGENTS.md")));
  });

  test("bootstrap on a file with real content appends the block after it; teardown restores the original content exactly", async () => {
    const cwd = await mkTmpRepo();
    const original = "# Project instructions\n\nAlways run tests before committing.\n";
    await fs.writeFile(path.join(cwd, "AGENTS.md"), original);

    await bootstrapInstructionFile(cwd, "AGENTS.md", ".skynet/w2");
    const withBlock = await fs.readFile(path.join(cwd, "AGENTS.md"), "utf8");
    assert.ok(withBlock.startsWith(original.trim()));
    assert.ok(withBlock.includes("<!-- skynet-interactive:BEGIN -->"));

    await teardownInstructionFile(cwd, "AGENTS.md");
    assert.strictEqual(await fs.readFile(path.join(cwd, "AGENTS.md"), "utf8"), `${original.trim()}\n`);
  });

  test("bootstrap is idempotent: calling it twice does not duplicate the block", async () => {
    const cwd = await mkTmpRepo();
    await bootstrapInstructionFile(cwd, "AGENTS.md", ".skynet/w3");
    await bootstrapInstructionFile(cwd, "AGENTS.md", ".skynet/w3");
    const content = await fs.readFile(path.join(cwd, "AGENTS.md"), "utf8");
    assert.strictEqual(content.split("<!-- skynet-interactive:BEGIN -->").length - 1, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile-tests`
Expected: FAIL — `Cannot find module '../adapters/interactive/instruction-file'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/adapters/interactive/instruction-file.ts`:

```ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { readFileIfExists } from "./fs-helpers";

const BEGIN = "<!-- skynet-interactive:BEGIN -->";
const END = "<!-- skynet-interactive:END -->";

export async function bootstrapInstructionFile(
  cwd: string,
  fileName: string,
  mailboxRelativeDir: string
): Promise<void> {
  const filePath = path.join(cwd, fileName);
  const stripped = stripBlock(await readFileIfExists(filePath));
  const block = `${BEGIN}\n${protocolText(mailboxRelativeDir)}\n${END}`;
  const next = stripped.length ? `${stripped}\n\n${block}\n` : `${block}\n`;
  await fs.writeFile(filePath, next);
}

export async function teardownInstructionFile(cwd: string, fileName: string): Promise<void> {
  const filePath = path.join(cwd, fileName);
  const existing = await readFileIfExists(filePath);
  if (!existing) {
    return;
  }
  const stripped = stripBlock(existing);
  if (stripped.length) {
    await fs.writeFile(filePath, `${stripped}\n`);
  } else {
    await fs.rm(filePath, { force: true });
  }
}

function protocolText(mailboxRelativeDir: string): string {
  return [
    `For each ${mailboxRelativeDir}/inbox/turn-N.md I give you: do the work it asks, then write`,
    `${mailboxRelativeDir}/outbox/turn-N.json before you stop, matching the same N:`,
    `- Pausing / need the next instruction -> {"status":"paused","summary":"<what you did>"}`,
    `- Whole task complete -> {"status":"done","summary":"...","filesTouched":["..."]}`,
    `- Unrecoverable error -> {"status":"error","reason":"..."}`,
    "",
    "Never delete inbox files. Write the outbox file in a single operation as the",
    "last action of a turn (write turn-N.json.tmp, then rename to turn-N.json)",
    "so the orchestrator rarely sees a half-written file.",
  ].join("\n");
}

function stripBlock(text: string): string {
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start === -1 || end === -1) {
    return text.trim();
  }
  return (text.slice(0, start) + text.slice(end + END.length)).replace(/\n{3,}/g, "\n\n").trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all three instruction-file cases green.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/interactive/instruction-file.ts src/test/interactive-instruction-file.test.ts
git commit -m "feat: non-destructive instruction-file bootstrap/teardown"
```

---

### Task 5: Crash detection (process-descendant walk)

**Files:**
- Create: `src/adapters/interactive/process-watch.ts`
- Test: `src/test/interactive-process-watch.test.ts`

**Interfaces:**
- Consumes: nothing beyond Node stdlib.
- Produces: `function hasLiveDescendant(pid: number, matchName: string): Promise<boolean>`

macOS/Linux only (`ps -Ao`) — matches the spec's v1 scope.

- [ ] **Step 1: Write the failing test**

Create `src/test/interactive-process-watch.test.ts`:

```ts
import * as assert from "assert";
import { spawn, type ChildProcess } from "node:child_process";
import { hasLiveDescendant } from "../adapters/interactive/process-watch";

suite("hasLiveDescendant", () => {
  test("finds a live descendant by command name, then stops finding it once it exits", async function () {
    this.timeout(10_000);
    const child: ChildProcess = spawn("sleep", ["5"]);
    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.strictEqual(await hasLiveDescendant(process.pid, "sleep"), true);

    child.kill();
    await new Promise((resolve) => setTimeout(resolve, 500));

    assert.strictEqual(await hasLiveDescendant(process.pid, "sleep"), false);
  });

  test("returns false for a pid with no descendants at all", async () => {
    assert.strictEqual(await hasLiveDescendant(process.pid, "definitely-not-a-real-process-name"), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile-tests`
Expected: FAIL — `Cannot find module '../adapters/interactive/process-watch'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/adapters/interactive/process-watch.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface ProcessRow {
  pid: number;
  ppid: number;
  comm: string;
}

// ponytail: macOS/Linux only (`ps -Ao`). Windows child-PID polling is out of
// scope for v1 — matches the interactive-codex spec's sad-path section.
export async function hasLiveDescendant(pid: number, matchName: string): Promise<boolean> {
  const { stdout } = await execFileAsync("ps", ["-Ao", "pid,ppid,comm"]);
  const rows = stdout.trim().split("\n").slice(1).map(parseRow).filter(isRow);

  const queue = [pid];
  const seen = new Set<number>();
  while (queue.length) {
    const current = queue.shift()!;
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    for (const row of rows) {
      if (row.ppid !== current) {
        continue;
      }
      if (row.comm.includes(matchName)) {
        return true;
      }
      queue.push(row.pid);
    }
  }
  return false;
}

function parseRow(line: string): ProcessRow | undefined {
  const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
  if (!match) {
    return undefined;
  }
  return { pid: Number(match[1]), ppid: Number(match[2]), comm: match[3] };
}

function isRow(row: ProcessRow | undefined): row is ProcessRow {
  return row !== undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — both `hasLiveDescendant` cases green.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/interactive/process-watch.ts src/test/interactive-process-watch.test.ts
git commit -m "feat: interactive mode crash detection via process-descendant walk"
```

---

### Task 6: Codex rollout parser

**Files:**
- Create: `src/adapters/codex/interactive-profile.ts`
- Test: `src/test/codex-rollout-parser.test.ts`

**Interfaces:**
- Consumes: `HarvestResult` from `../interactive/types` (Task 1), `WorkerUsage` from `../types`.
- Produces: `function parseCodexRollout(text: string): HarvestResult`

Fixture data below is **real**, captured from `~/.agents/codex-plus/sessions/2026/06/30/rollout-2026-06-30T23-18-46-*.jsonl` — the actual rollout file written by the `terminal-probe.test.ts` run on 2026-07-01 (verified against `codex-cli 0.142.4`), trimmed of the (very long) `base_instructions.text` field the parser never reads.

- [ ] **Step 1: Write the failing test**

Create `src/test/codex-rollout-parser.test.ts`:

```ts
import * as assert from "assert";
import { parseCodexRollout } from "../adapters/codex/interactive-profile";

// Captured from a real codex-cli 0.142.4 rollout file (terminal-probe.test.ts run, 2026-07-01),
// trimmed of the base_instructions.text field (not read by the parser).
const SESSION_META_LINE = JSON.stringify({
  timestamp: "2026-06-30T16:19:33.980Z",
  type: "session_meta",
  payload: {
    session_id: "019f1953-71c9-7c41-b8fb-c841283efe1e",
    id: "019f1953-71c9-7c41-b8fb-c841283efe1e",
    timestamp: "2026-06-30T16:18:46.914Z",
    cwd: "/Users/binn/Projects/extension-factory/skynet-harness/active",
    originator: "codex-tui",
    cli_version: "0.142.4",
    source: "cli",
    thread_source: "user",
    model_provider: "openai",
    git: {
      commit_hash: "c74a64686456c733e15eae26615b57265e009c17",
      branch: "feat/interactive-codex",
      repository_url: "https://github.com/binnguyenvn/vs-skynet.git",
    },
  },
});

const TOKEN_COUNT_LINE = JSON.stringify({
  timestamp: "2026-06-30T16:19:37.748Z",
  type: "event_msg",
  payload: {
    type: "token_count",
    info: {
      total_token_usage: {
        input_tokens: 16660,
        cached_input_tokens: 9088,
        output_tokens: 69,
        reasoning_output_tokens: 53,
        total_tokens: 16729,
      },
      last_token_usage: {
        input_tokens: 16660,
        cached_input_tokens: 9088,
        output_tokens: 69,
        reasoning_output_tokens: 53,
        total_tokens: 16729,
      },
      model_context_window: 258400,
    },
    rate_limits: {
      limit_id: "codex",
      limit_name: null,
      primary: { used_percent: 28.0, window_minutes: 300, resets_at: 1782842455 },
      secondary: { used_percent: 30.0, window_minutes: 10080, resets_at: 1783393060 },
      credits: null,
      individual_limit: null,
      plan_type: "plus",
      rate_limit_reached_type: null,
    },
  },
});

const LATER_TOKEN_COUNT_LINE = JSON.stringify({
  timestamp: "2026-06-30T16:25:00.000Z",
  type: "event_msg",
  payload: {
    type: "token_count",
    info: {
      total_token_usage: {
        input_tokens: 20000,
        cached_input_tokens: 9088,
        output_tokens: 120,
        reasoning_output_tokens: 60,
        total_tokens: 20180,
      },
      last_token_usage: {
        input_tokens: 3340,
        cached_input_tokens: 0,
        output_tokens: 51,
        reasoning_output_tokens: 7,
        total_tokens: 3391,
      },
      model_context_window: 258400,
    },
    rate_limits: {
      limit_id: "codex",
      limit_name: null,
      primary: { used_percent: 29.0, window_minutes: 300, resets_at: 1782842455 },
      secondary: { used_percent: 30.0, window_minutes: 10080, resets_at: 1783393060 },
      credits: null,
      individual_limit: null,
      plan_type: "plus",
      rate_limit_reached_type: null,
    },
  },
});

suite("parseCodexRollout", () => {
  test("extracts sessionId, cumulative usage, and rate limits from a real captured rollout", () => {
    const result = parseCodexRollout([SESSION_META_LINE, TOKEN_COUNT_LINE].join("\n"));
    assert.strictEqual(result.sessionId, "019f1953-71c9-7c41-b8fb-c841283efe1e");
    assert.deepStrictEqual(result.usage, {
      inputTokens: 16660,
      outputTokens: 69,
      cachedInputTokens: 9088,
      reasoningTokens: 53,
    });
    assert.ok(result.rateLimits);
  });

  test("keeps the latest cumulative usage when multiple token_count lines are present", () => {
    const result = parseCodexRollout([SESSION_META_LINE, TOKEN_COUNT_LINE, LATER_TOKEN_COUNT_LINE].join("\n"));
    assert.strictEqual(result.usage?.inputTokens, 20000);
    assert.strictEqual(result.usage?.outputTokens, 120);
  });

  test("ignores blank lines and non-JSON noise", () => {
    const result = parseCodexRollout(["", "  ", "not json", SESSION_META_LINE].join("\n"));
    assert.strictEqual(result.sessionId, "019f1953-71c9-7c41-b8fb-c841283efe1e");
  });

  test("returns an empty result for text with no recognized lines", () => {
    assert.deepStrictEqual(parseCodexRollout(""), { sessionId: undefined, usage: undefined, rateLimits: undefined });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile-tests`
Expected: FAIL — `Cannot find module '../adapters/codex/interactive-profile'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/adapters/codex/interactive-profile.ts`:

```ts
import type { HarvestResult } from "../interactive/types";
import type { WorkerUsage } from "../types";

interface RolloutLine {
  type?: string;
  payload?: {
    id?: unknown;
    type?: string;
    info?: { total_token_usage?: Record<string, unknown> };
    rate_limits?: unknown;
  };
}

export function parseCodexRollout(text: string): HarvestResult {
  let sessionId: string | undefined;
  let usage: WorkerUsage | undefined;
  let rateLimits: unknown;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let entry: RolloutLine;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (entry.type === "session_meta" && entry.payload?.id) {
      sessionId = String(entry.payload.id);
    } else if (entry.type === "event_msg" && entry.payload?.type === "token_count") {
      const total = entry.payload.info?.total_token_usage;
      if (total) {
        usage = {
          inputTokens: Number(total.input_tokens ?? 0),
          outputTokens: Number(total.output_tokens ?? 0),
          cachedInputTokens: total.cached_input_tokens !== undefined ? Number(total.cached_input_tokens) : undefined,
          reasoningTokens:
            total.reasoning_output_tokens !== undefined ? Number(total.reasoning_output_tokens) : undefined,
        };
      }
      if (entry.payload.rate_limits) {
        rateLimits = entry.payload.rate_limits;
      }
    }
  }

  return { sessionId, usage, rateLimits };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all four `parseCodexRollout` cases green.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/codex/interactive-profile.ts src/test/codex-rollout-parser.test.ts
git commit -m "feat: codex rollout JSONL parser (sessionId + usage + rate limits)"
```

---

### Task 7: Session harvester (newest-rollout-file lookup)

**Files:**
- Create: `src/adapters/interactive/session-harvester.ts`
- Test: `src/test/interactive-session-harvester.test.ts`

**Interfaces:**
- Consumes: `InteractiveCliProfile`, `HarvestResult` from `./types` (Task 1).
- Produces: `function harvestSession(profile: InteractiveCliProfile, configDir: string | undefined): Promise<HarvestResult>`

Generic recursive newest-file finder (works for codex's `sessions/YYYY/MM/DD/rollout-*.jsonl` nesting without hardcoding depth), then delegates parsing to `profile.harvest(text)`.

- [ ] **Step 1: Write the failing test**

Create `src/test/interactive-session-harvester.test.ts`:

```ts
import * as assert from "assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { harvestSession } from "../adapters/interactive/session-harvester";
import type { InteractiveCliProfile } from "../adapters/interactive/types";

async function mkTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "session-harvester-test-"));
}

function fakeProfile(sessionDir: string, harvest: (text: string) => { sessionId?: string }): InteractiveCliProfile {
  return {
    id: "codex",
    launchArgv: () => [],
    configEnv: () => ({}),
    instructionFile: "AGENTS.md",
    submitSequence: "\t",
    sessionDir: () => sessionDir,
    harvest,
  };
}

suite("harvestSession", () => {
  test("returns {} when the session dir does not exist", async () => {
    const result = await harvestSession(fakeProfile("/nonexistent/does/not/exist", () => ({})), undefined);
    assert.deepStrictEqual(result, {});
  });

  test("finds the newest file across nested subdirectories and hands its content to profile.harvest", async () => {
    const root = await mkTmpDir();
    const nestedDir = path.join(root, "2026", "06", "30");
    await fs.mkdir(nestedDir, { recursive: true });

    const older = path.join(nestedDir, "rollout-old.jsonl");
    const newer = path.join(nestedDir, "rollout-new.jsonl");
    await fs.writeFile(older, "old-content");
    await fs.writeFile(newer, "new-content");

    const oldTime = new Date(Date.now() - 60_000);
    const newTime = new Date();
    await fs.utimes(older, oldTime, oldTime);
    await fs.utimes(newer, newTime, newTime);

    const seenText: string[] = [];
    const result = await harvestSession(
      fakeProfile(root, (text) => {
        seenText.push(text);
        return { sessionId: "found-it" };
      }),
      undefined
    );

    assert.deepStrictEqual(seenText, ["new-content"]);
    assert.deepStrictEqual(result, { sessionId: "found-it" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile-tests`
Expected: FAIL — `Cannot find module '../adapters/interactive/session-harvester'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/adapters/interactive/session-harvester.ts`:

```ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { HarvestResult, InteractiveCliProfile } from "./types";

export async function harvestSession(
  profile: InteractiveCliProfile,
  configDir: string | undefined
): Promise<HarvestResult> {
  const newest = await newestFileRecursive(profile.sessionDir(configDir));
  if (!newest) {
    return {};
  }
  return profile.harvest(await fs.readFile(newest, "utf8"));
}

async function newestFileRecursive(dir: string): Promise<string | undefined> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }

  let newest: { file: string; mtimeMs: number } | undefined;
  const consider = async (file: string) => {
    const stat = await fs.stat(file);
    if (!newest || stat.mtimeMs > newest.mtimeMs) {
      newest = { file, mtimeMs: stat.mtimeMs };
    }
  };

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const candidate = await newestFileRecursive(full);
      if (candidate) {
        await consider(candidate);
      }
    } else if (entry.isFile()) {
      await consider(full);
    }
  }
  return newest?.file;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — both `harvestSession` cases green.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/interactive/session-harvester.ts src/test/interactive-session-harvester.test.ts
git commit -m "feat: recursive newest-session-file harvester"
```

---

### Task 8: VscodeTerminalTransport (real terminal wrapper)

**Files:**
- Create: `src/adapters/interactive/vscode-terminal-transport.ts`
- Test: `src/test/interactive-vscode-terminal-transport.test.ts`

**Interfaces:**
- Consumes: `TerminalTransport`, `TerminalFactory` from `./types` (Task 1).
- Produces: `class VscodeTerminalTransport implements TerminalTransport`, `class VscodeTerminalFactory implements TerminalFactory`

Thin wrapper over the real `vscode` API — this is the only file in the core that touches `vscode` directly (besides the extension host running the test). No CLI process is needed to test it; it exercises a real terminal shell.

- [ ] **Step 1: Write the failing test**

Create `src/test/interactive-vscode-terminal-transport.test.ts`:

```ts
import * as assert from "assert";
import { VscodeTerminalFactory } from "../adapters/interactive/vscode-terminal-transport";

suite("VscodeTerminalTransport", () => {
  test("creates a real terminal, resolves a process id, and disposes cleanly", async function () {
    this.timeout(10_000);
    const factory = new VscodeTerminalFactory();
    const transport = factory.create({ name: "interactive-transport-test", cwd: process.cwd(), env: {} });
    try {
      const pid = await transport.processId();
      assert.strictEqual(typeof pid, "number");
    } finally {
      transport.dispose();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile-tests`
Expected: FAIL — `Cannot find module '../adapters/interactive/vscode-terminal-transport'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/adapters/interactive/vscode-terminal-transport.ts`:

```ts
import * as vscode from "vscode";
import type { TerminalFactory, TerminalTransport } from "./types";

export class VscodeTerminalTransport implements TerminalTransport {
  private readonly closeListeners: Array<(exitCode: number | undefined) => void> = [];
  private readonly closeSub: vscode.Disposable;

  constructor(private readonly terminal: vscode.Terminal) {
    this.closeSub = vscode.window.onDidCloseTerminal((closed) => {
      if (closed === this.terminal) {
        this.closeListeners.forEach((listener) => listener(closed.exitStatus?.code));
      }
    });
  }

  show(preserveFocus: boolean): void {
    this.terminal.show(preserveFocus);
  }

  sendText(text: string, addNewLine: boolean): void {
    this.terminal.sendText(text, addNewLine);
  }

  async sendSequence(sequence: string): Promise<void> {
    await vscode.commands.executeCommand("workbench.action.terminal.sendSequence", { text: sequence });
  }

  async processId(): Promise<number | undefined> {
    return this.terminal.processId;
  }

  onDidClose(listener: (exitCode: number | undefined) => void): { dispose(): void } {
    this.closeListeners.push(listener);
    return {
      dispose: () => {
        const index = this.closeListeners.indexOf(listener);
        if (index !== -1) {
          this.closeListeners.splice(index, 1);
        }
      },
    };
  }

  dispose(): void {
    this.closeSub.dispose();
    this.terminal.dispose();
  }
}

export class VscodeTerminalFactory implements TerminalFactory {
  create(opts: { name: string; cwd: string; env: Record<string, string> }): TerminalTransport {
    const terminal = vscode.window.createTerminal({ name: opts.name, cwd: opts.cwd, env: opts.env });
    return new VscodeTerminalTransport(terminal);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — `VscodeTerminalTransport` suite green.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/interactive/vscode-terminal-transport.ts src/test/interactive-vscode-terminal-transport.test.ts
git commit -m "feat: real vscode.Terminal wrapper implementing TerminalTransport"
```

---

### Task 9: InteractiveSession state machine + startInteractive

**Files:**
- Create: `src/adapters/interactive/interactive-session.ts`
- Test: `src/test/interactive-session.test.ts`

**Interfaces:**
- Consumes: `Mailbox` (Task 2), `ring` (Task 3), `bootstrapInstructionFile`/`teardownInstructionFile` (Task 4), `harvestSession` (Task 7), `buildLaunchCommand` (Task 1), `classifyError` from `../classify` (existing), all types from `./types` (Task 1). `hasLiveDescendant` (Task 5) and `VscodeTerminalFactory` (Task 8) are consumed only via dynamic `import()` inside the default-dependency helpers below — no static import, so this module never has a hard load-time dependency on `vscode` or `process-watch`.
- Produces:
  - `interface StartInteractiveDeps { terminalFactory: TerminalFactory; checkAlive: (pid: number, matchName: string) => Promise<boolean>; crashPollMs: number; launchDelayMs: number; mailboxPollMs: number }`
  - `function startInteractive(profile: InteractiveCliProfile, opts: InteractiveOpts, deps?: Partial<StartInteractiveDeps>): Promise<InteractiveSession>`

This is the core orchestrator: turn cycle, readiness retry, timeout, crash detection, session-id/usage harvesting, and the sparse `WorkerEvent` iterator — all driven through the injected `TerminalTransport`/`checkAlive` so it is testable without a real CLI, per the spec's proof-of-function gate.

- [ ] **Step 1: Write the failing test**

Create `src/test/interactive-session.test.ts`:

```ts
import * as assert from "assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { startInteractive } from "../adapters/interactive/interactive-session";
import type { InteractiveCliProfile } from "../adapters/interactive/types";
import { FakeTerminalTransport } from "./helpers/fake-terminal-transport";

function fakeProfile(overrides: Partial<InteractiveCliProfile> = {}): InteractiveCliProfile {
  return {
    id: "codex",
    launchArgv: () => ["--fake"],
    configEnv: () => ({}),
    instructionFile: "FAKE_AGENTS.md",
    submitSequence: "\t",
    sessionDir: (dir) => dir ?? "/nonexistent",
    harvest: () => ({}),
    ...overrides,
  };
}

async function mkTmpRepo(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "interactive-session-test-"));
}

function writeOutboxSoon(cwd: string, workerId: string, turn: number, data: unknown, delayMs = 20): void {
  setTimeout(() => {
    void fs.writeFile(path.join(cwd, ".skynet", workerId, "outbox", `turn-${turn}.json`), JSON.stringify(data));
  }, delayMs);
}

suite("InteractiveSession", () => {
  test("turn cycle: paused then done, with harvested usage and sessionId surfaced on the events iterator", async () => {
    const cwd = await mkTmpRepo();
    const transport = new FakeTerminalTransport();
    const profile = fakeProfile({
      sessionDir: () => cwd, // pretend the CLI's transcript lives in cwd for this fake
      harvest: () => ({ sessionId: "sess-1", usage: { inputTokens: 10, outputTokens: 5 } }),
    });
    const session = await startInteractive(
      profile,
      { cwd, workerId: "w1", readyTimeoutMs: 2_000, turnTimeoutMs: 2_000 },
      { terminalFactory: { create: () => transport }, launchDelayMs: 0, mailboxPollMs: 20 }
    );

    writeOutboxSoon(cwd, "w1", 1, { status: "paused", summary: "step 1 complete" });
    const first = await session.send("turn 1");
    assert.deepStrictEqual(first, { status: "paused", summary: "step 1 complete" });

    writeOutboxSoon(cwd, "w1", 2, { status: "done", summary: "all done", filesTouched: ["a.txt"] });
    const second = await session.send("turn 2");
    assert.strictEqual(second.status, "done");
    assert.deepStrictEqual((second as { filesTouched?: string[] }).filesTouched, ["a.txt"]);
    assert.deepStrictEqual((second as { usage?: unknown }).usage, { inputTokens: 10, outputTokens: 5 });

    assert.strictEqual(await session.sessionId, "sess-1");

    const events: unknown[] = [];
    for await (const event of session) {
      events.push(event);
    }
    assert.deepStrictEqual(events, [
      { kind: "started", sessionId: "sess-1" },
      { kind: "usage", inputTokens: 10, outputTokens: 5 },
      { kind: "message", text: "step 1 complete" },
      { kind: "usage", inputTokens: 10, outputTokens: 5 },
      { kind: "message", text: "all done" },
    ]);

    await session.dispose();
  });

  test("send() rejects once the session has completed", async () => {
    const cwd = await mkTmpRepo();
    const transport = new FakeTerminalTransport();
    const session = await startInteractive(
      fakeProfile(),
      { cwd, workerId: "w2", readyTimeoutMs: 2_000, turnTimeoutMs: 2_000 },
      { terminalFactory: { create: () => transport }, launchDelayMs: 0, mailboxPollMs: 20 }
    );
    writeOutboxSoon(cwd, "w2", 1, { status: "done", summary: "done" });
    await session.send("turn 1");
    await assert.rejects(session.send("turn 2"), /already completed/);
    await session.dispose();
  });

  test("times out when no outbox ever appears, retrying the readiness ping once on turn 1", async () => {
    const cwd = await mkTmpRepo();
    const transport = new FakeTerminalTransport();
    const session = await startInteractive(
      fakeProfile(),
      { cwd, workerId: "w3", readyTimeoutMs: 150, turnTimeoutMs: 150 },
      { terminalFactory: { create: () => transport }, launchDelayMs: 0, mailboxPollMs: 20 }
    );
    const result = await session.send("turn 1");
    assert.deepStrictEqual(result, { status: "timeout" });
    assert.strictEqual(transport.calls.filter((c) => c.method === "sendSequence").length, 2, "one retry ping");
    await session.dispose();
  });

  test("reports crashed when the terminal closes mid-turn", async () => {
    const cwd = await mkTmpRepo();
    const transport = new FakeTerminalTransport();
    const session = await startInteractive(
      fakeProfile(),
      { cwd, workerId: "w4", readyTimeoutMs: 2_000, turnTimeoutMs: 2_000 },
      { terminalFactory: { create: () => transport }, launchDelayMs: 0, mailboxPollMs: 20 }
    );
    setTimeout(() => transport.simulateClose(1), 50);
    const result = await session.send("turn 1");
    assert.deepStrictEqual(result, { status: "crashed" });
    await session.dispose();
  });

  test("reports crashed when checkAlive finds no live CLI descendant", async () => {
    const cwd = await mkTmpRepo();
    const transport = new FakeTerminalTransport();
    const session = await startInteractive(
      fakeProfile(),
      { cwd, workerId: "w5", readyTimeoutMs: 2_000, turnTimeoutMs: 2_000 },
      {
        terminalFactory: { create: () => transport },
        launchDelayMs: 0,
        mailboxPollMs: 20,
        crashPollMs: 30,
        checkAlive: async () => false,
      }
    );
    const result = await session.send("turn 1");
    assert.deepStrictEqual(result, { status: "crashed" });
    await session.dispose();
  });

  test("classifies an agent-reported error via classifyError", async () => {
    const cwd = await mkTmpRepo();
    const transport = new FakeTerminalTransport();
    const session = await startInteractive(
      fakeProfile(),
      { cwd, workerId: "w6", readyTimeoutMs: 2_000, turnTimeoutMs: 2_000 },
      { terminalFactory: { create: () => transport }, launchDelayMs: 0, mailboxPollMs: 20 }
    );
    writeOutboxSoon(cwd, "w6", 1, { status: "error", reason: "hit a 429 rate limit" });
    const result = await session.send("turn 1");
    assert.deepStrictEqual(result, { status: "error", reason: "hit a 429 rate limit", errorClass: "limit" });
    await session.dispose();
  });

  test("dispose strips the instruction-file marker block and removes the mailbox dir", async () => {
    const cwd = await mkTmpRepo();
    await fs.writeFile(path.join(cwd, "FAKE_AGENTS.md"), "# Real project instructions\n");
    const transport = new FakeTerminalTransport();
    const session = await startInteractive(
      fakeProfile(),
      { cwd, workerId: "w7", readyTimeoutMs: 2_000, turnTimeoutMs: 2_000 },
      { terminalFactory: { create: () => transport }, launchDelayMs: 0, mailboxPollMs: 20 }
    );
    writeOutboxSoon(cwd, "w7", 1, { status: "done", summary: "done" });
    await session.send("turn 1");
    await session.dispose();

    assert.strictEqual(await fs.readFile(path.join(cwd, "FAKE_AGENTS.md"), "utf8"), "# Real project instructions\n");
    await assert.rejects(fs.access(path.join(cwd, ".skynet", "w7")));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile-tests`
Expected: FAIL — `Cannot find module '../adapters/interactive/interactive-session'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/adapters/interactive/interactive-session.ts`:

```ts
import { EventEmitter, once } from "node:events";
import { classifyError } from "../classify";
import type { WorkerEvent } from "../types";
import { bootstrapInstructionFile, teardownInstructionFile } from "./instruction-file";
import { Mailbox } from "./mailbox";
import { ring } from "./doorbell";
import { harvestSession } from "./session-harvester";
import { buildLaunchCommand } from "./shell";
import type {
  InteractiveCliProfile,
  InteractiveOpts,
  InteractiveSession,
  TerminalFactory,
  TerminalTransport,
  TurnResult,
  HarvestResult,
} from "./types";

const DEFAULT_TURN_TIMEOUT_MS = 300_000;
const DEFAULT_READY_TIMEOUT_MS = 30_000;
const DEFAULT_CRASH_POLL_MS = 3_000;
const DEFAULT_LAUNCH_DELAY_MS = 1_500;
const DEFAULT_MAILBOX_POLL_MS = 500;

export interface StartInteractiveDeps {
  terminalFactory: TerminalFactory;
  checkAlive: (pid: number, matchName: string) => Promise<boolean>;
  crashPollMs: number;
  launchDelayMs: number;
  mailboxPollMs: number;
}

// No static import of vscode-terminal-transport or process-watch here: this
// keeps the core module loadable without `vscode` or a `ps` binary present.
// Both are only resolved, via dynamic import, when a caller omits the dep —
// production wiring (Task 11) always hits this path; every test in this
// plan injects its own terminalFactory/checkAlive and never triggers it.
async function defaultTerminalFactory(): Promise<TerminalFactory> {
  const { VscodeTerminalFactory } = await import("./vscode-terminal-transport");
  return new VscodeTerminalFactory();
}

async function defaultCheckAlive(): Promise<(pid: number, matchName: string) => Promise<boolean>> {
  const { hasLiveDescendant } = await import("./process-watch");
  return hasLiveDescendant;
}

export async function startInteractive(
  profile: InteractiveCliProfile,
  opts: InteractiveOpts,
  deps: Partial<StartInteractiveDeps> = {}
): Promise<InteractiveSession> {
  const resolved: StartInteractiveDeps = {
    terminalFactory: deps.terminalFactory ?? (await defaultTerminalFactory()),
    checkAlive: deps.checkAlive ?? (await defaultCheckAlive()),
    crashPollMs: deps.crashPollMs ?? DEFAULT_CRASH_POLL_MS,
    launchDelayMs: deps.launchDelayMs ?? DEFAULT_LAUNCH_DELAY_MS,
    mailboxPollMs: deps.mailboxPollMs ?? DEFAULT_MAILBOX_POLL_MS,
  };

  const mailbox = new Mailbox(opts.cwd, opts.workerId);
  await mailbox.ensureDirs();
  await mailbox.ensureGitignored(opts.cwd);
  await bootstrapInstructionFile(opts.cwd, profile.instructionFile, mailbox.relativeDir);

  const transport = resolved.terminalFactory.create({
    name: `${profile.id}-interactive-${opts.workerId}`,
    cwd: opts.cwd,
    env: profile.configEnv(opts.configDir),
  });
  transport.sendText(buildLaunchCommand(profile.id, profile.launchArgv(opts)), true);
  await delay(resolved.launchDelayMs);

  return new InteractiveSessionImpl(profile, opts, mailbox, transport, resolved);
}

class InteractiveSessionImpl implements InteractiveSession {
  private turn = 0;
  private closed = false;
  private closedByTerminal = false;
  private _sessionId: string | undefined;
  private readonly emitter = new EventEmitter();
  private readonly buffered: WorkerEvent[] = [];

  constructor(
    private readonly profile: InteractiveCliProfile,
    private readonly opts: InteractiveOpts,
    private readonly mailbox: Mailbox,
    private readonly transport: TerminalTransport,
    private readonly deps: StartInteractiveDeps
  ) {
    transport.onDidClose(() => {
      this.closedByTerminal = true;
    });
  }

  get sessionId(): Promise<string | undefined> {
    if (this._sessionId !== undefined) {
      return Promise.resolve(this._sessionId);
    }
    if (this.closed) {
      return Promise.resolve(undefined);
    }
    return once(this.emitter, "sessionId").then(([id]) => id as string | undefined);
  }

  async send(prompt: string): Promise<TurnResult> {
    if (this.closed) {
      throw new Error("session already completed");
    }
    this.turn += 1;
    const turn = this.turn;
    const isFirstTurn = turn === 1;

    await this.mailbox.writeInbox(turn, prompt);
    const pingLine = `Read ${this.mailbox.relativeDir}/inbox/turn-${turn}.md and follow it.`;
    await ring(this.transport, pingLine, this.profile.submitSequence);

    const readyTimeoutMs = this.opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
    const turnTimeoutMs = this.opts.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
    let raw = await this.waitForOutbox(turn, isFirstTurn ? readyTimeoutMs : turnTimeoutMs);

    if (raw === "timeout" && isFirstTurn) {
      await ring(this.transport, pingLine, this.profile.submitSequence);
      raw = await this.waitForOutbox(turn, readyTimeoutMs);
    }

    const base = this.toTurnResult(raw);
    return this.afterTurn(base);
  }

  private async waitForOutbox(turn: number, timeoutMs: number): Promise<unknown> {
    const deadline = Date.now() + timeoutMs;
    let nextCrashCheck = Date.now() + this.deps.crashPollMs;

    while (Date.now() < deadline) {
      if (this.closedByTerminal) {
        return "crashed";
      }
      if (Date.now() >= nextCrashCheck) {
        const pid = await this.transport.processId();
        if (pid !== undefined && !(await this.deps.checkAlive(pid, this.profile.id))) {
          return "crashed";
        }
        nextCrashCheck = Date.now() + this.deps.crashPollMs;
      }
      const raw = await this.mailbox.tryReadOutbox(turn);
      if (raw !== undefined) {
        return raw;
      }
      await delay(Math.min(this.deps.mailboxPollMs, Math.max(0, deadline - Date.now())));
    }
    return "timeout";
  }

  private toTurnResult(raw: unknown): TurnResult {
    if (raw === "timeout") {
      return { status: "timeout" };
    }
    if (raw === "crashed") {
      return { status: "crashed" };
    }
    const data = raw as { status?: unknown; summary?: unknown; reason?: unknown; filesTouched?: unknown };
    if (data.status === "paused") {
      return { status: "paused", summary: String(data.summary ?? "") };
    }
    if (data.status === "done") {
      return {
        status: "done",
        summary: String(data.summary ?? ""),
        filesTouched: Array.isArray(data.filesTouched) ? data.filesTouched.map(String) : undefined,
      };
    }
    if (data.status === "error") {
      const reason = String(data.reason ?? "");
      return { status: "error", reason, errorClass: classifyError(reason) };
    }
    return { status: "error", reason: `outbox had unknown status: ${JSON.stringify(raw)}` };
  }

  private async afterTurn(base: TurnResult): Promise<TurnResult> {
    const harvested: HarvestResult = await harvestSession(this.profile, this.opts.configDir).catch(() => ({}));

    if (this._sessionId === undefined && harvested.sessionId) {
      this._sessionId = harvested.sessionId;
      this.emitter.emit("sessionId", harvested.sessionId);
      this.pushEvent({
        kind: "started",
        sessionId: harvested.sessionId,
        ...(this.opts.model ? { model: this.opts.model } : {}),
      });
    }
    if (harvested.usage) {
      this.pushEvent({ kind: "usage", ...harvested.usage });
    }
    if (base.status === "paused" || base.status === "done") {
      this.pushEvent({ kind: "message", text: base.summary });
    }

    const result: TurnResult =
      base.status === "done" && harvested.usage ? { ...base, usage: harvested.usage } : base;

    if (result.status !== "paused") {
      this.finish();
    }
    return result;
  }

  private pushEvent(event: WorkerEvent): void {
    this.buffered.push(event);
    this.emitter.emit("event");
  }

  private finish(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.emitter.emit("event");
    if (this._sessionId === undefined) {
      this.emitter.emit("sessionId", undefined);
    }
  }

  async dispose(): Promise<void> {
    await teardownInstructionFile(this.opts.cwd, this.profile.instructionFile);
    await this.mailbox.dispose();
    this.transport.dispose();
    this.finish();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<WorkerEvent> {
    let index = 0;
    while (true) {
      while (index < this.buffered.length) {
        yield this.buffered[index];
        index += 1;
      }
      if (this.closed) {
        return;
      }
      await once(this.emitter, "event");
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all seven `InteractiveSession` cases green. If timing-sensitive cases flake, raise the fake delays in the test (they are intentionally small to keep the suite fast) rather than the production defaults.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/interactive/interactive-session.ts src/test/interactive-session.test.ts
git commit -m "feat: InteractiveSession turn-cycle state machine + startInteractive"
```

---

### Task 10: Codex interactive profile

**Files:**
- Modify: `src/adapters/codex/interactive-profile.ts` (add `codexInteractive` alongside the existing `parseCodexRollout` from Task 6)
- Test: `src/test/codex-interactive-profile.test.ts`

**Interfaces:**
- Consumes: `InteractiveCliProfile` from `../interactive/types` (Task 1), `parseCodexRollout` (Task 6, same file).
- Produces: `const codexInteractive: InteractiveCliProfile`

Launch argv matches the exact command proven working by `terminal-probe.test.ts` (cited in the groomed spec).

- [ ] **Step 1: Write the failing test**

Create `src/test/codex-interactive-profile.test.ts`:

```ts
import * as assert from "assert";
import * as os from "node:os";
import * as path from "node:path";
import { codexInteractive } from "../adapters/codex/interactive-profile";

suite("codexInteractive profile", () => {
  test("launchArgv matches the probe-verified argv exactly", () => {
    assert.deepStrictEqual(
      codexInteractive.launchArgv({ cwd: "/tmp/proj", workerId: "w1", sandbox: "workspace-write" }),
      [
        "-C", "/tmp/proj",
        "-s", "workspace-write",
        "-a", "never",
        "-c", "disable_paste_burst=true",
        "-c", 'tui.keymap.composer.submit="tab"',
        "-c", 'tui.keymap.composer.queue="ctrl-q"',
      ]
    );
  });

  test("launchArgv includes -m only when a model is given", () => {
    const argv = codexInteractive.launchArgv({ cwd: "/tmp/proj", workerId: "w1", model: "gpt-5" });
    assert.strictEqual(argv[argv.indexOf("-m") + 1], "gpt-5");
  });

  test("launchArgv defaults sandbox to workspace-write when unset", () => {
    const argv = codexInteractive.launchArgv({ cwd: "/tmp/proj", workerId: "w1" });
    assert.strictEqual(argv[argv.indexOf("-s") + 1], "workspace-write");
  });

  test("configEnv sets CODEX_HOME only when configDir is given", () => {
    assert.deepStrictEqual(codexInteractive.configEnv("/config/dir"), { CODEX_HOME: "/config/dir" });
    assert.deepStrictEqual(codexInteractive.configEnv(undefined), {});
  });

  test("sessionDir defaults to ~/.codex/sessions and relocates under configDir", () => {
    assert.strictEqual(codexInteractive.sessionDir(undefined), path.join(os.homedir(), ".codex", "sessions"));
    assert.strictEqual(codexInteractive.sessionDir("/config/dir"), path.join("/config/dir", "sessions"));
  });

  test("submitSequence and instructionFile match the probe", () => {
    assert.strictEqual(codexInteractive.submitSequence, "\t");
    assert.strictEqual(codexInteractive.instructionFile, "AGENTS.md");
    assert.strictEqual(codexInteractive.id, "codex");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile-tests`
Expected: FAIL — `codexInteractive` is not exported from `../adapters/codex/interactive-profile`.

- [ ] **Step 3: Write minimal implementation**

Modify `src/adapters/codex/interactive-profile.ts` so the complete file reads exactly as follows (adds the `os`/`path`/`InteractiveCliProfile` imports and the `codexInteractive` export; `RolloutLine` and `parseCodexRollout` are unchanged from Task 6):

```ts
import * as os from "node:os";
import * as path from "node:path";
import type { HarvestResult, InteractiveCliProfile } from "../interactive/types";
import type { WorkerUsage } from "../types";

interface RolloutLine {
  type?: string;
  payload?: {
    id?: unknown;
    type?: string;
    info?: { total_token_usage?: Record<string, unknown> };
    rate_limits?: unknown;
  };
}

export function parseCodexRollout(text: string): HarvestResult {
  let sessionId: string | undefined;
  let usage: WorkerUsage | undefined;
  let rateLimits: unknown;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let entry: RolloutLine;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (entry.type === "session_meta" && entry.payload?.id) {
      sessionId = String(entry.payload.id);
    } else if (entry.type === "event_msg" && entry.payload?.type === "token_count") {
      const total = entry.payload.info?.total_token_usage;
      if (total) {
        usage = {
          inputTokens: Number(total.input_tokens ?? 0),
          outputTokens: Number(total.output_tokens ?? 0),
          cachedInputTokens: total.cached_input_tokens !== undefined ? Number(total.cached_input_tokens) : undefined,
          reasoningTokens:
            total.reasoning_output_tokens !== undefined ? Number(total.reasoning_output_tokens) : undefined,
        };
      }
      if (entry.payload.rate_limits) {
        rateLimits = entry.payload.rate_limits;
      }
    }
  }

  return { sessionId, usage, rateLimits };
}

export const codexInteractive: InteractiveCliProfile = {
  id: "codex",
  launchArgv: (o) => [
    "-C", o.cwd,
    ...(o.model ? ["-m", o.model] : []),
    "-s", o.sandbox ?? "workspace-write",
    "-a", "never",
    "-c", "disable_paste_burst=true",
    "-c", 'tui.keymap.composer.submit="tab"',
    "-c", 'tui.keymap.composer.queue="ctrl-q"',
  ],
  configEnv: (dir) => (dir ? { CODEX_HOME: dir } : {}),
  instructionFile: "AGENTS.md",
  submitSequence: "\t",
  sessionDir: (dir) => (dir ? path.join(dir, "sessions") : path.join(os.homedir(), ".codex", "sessions")),
  harvest: (text) => parseCodexRollout(text),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all six `codexInteractive profile` cases green, plus Task 6's `parseCodexRollout` suite still green.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/codex/interactive-profile.ts src/test/codex-interactive-profile.test.ts
git commit -m "feat: codexInteractive profile (launch argv, env, session dir)"
```

---

### Task 11: Wire `codexAdapter.runInteractive`

**Files:**
- Modify: `src/adapters/types.ts:45-48` (add optional `runInteractive` to `AgentAdapter`)
- Modify: `src/adapters/codex/codex-adapter.ts:136-139` (implement it)
- Test: `src/test/codex-adapter-interactive-wiring.test.ts`

**Interfaces:**
- Consumes: `InteractiveOpts`, `InteractiveSession` from `./interactive/types` (Task 1); `startInteractive` (Task 9); `codexInteractive` (Task 10).
- Produces: `AgentAdapter.runInteractive?(opts: InteractiveOpts): Promise<InteractiveSession>`, wired on `codexAdapter`.

One-line delegation — no new logic, so the test is a cheap sanity check. The real proof is Task 12's integration test.

- [ ] **Step 1: Write the failing test**

Create `src/test/codex-adapter-interactive-wiring.test.ts`:

```ts
import * as assert from "assert";
import { codexAdapter } from "../adapters/codex/codex-adapter";

suite("codexAdapter.runInteractive wiring", () => {
  test("is exposed as a function", () => {
    assert.strictEqual(typeof codexAdapter.runInteractive, "function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile-tests`
Expected: FAIL — `codexAdapter.runInteractive` is `undefined` (assertion fails at runtime, or `npm run check-types` if you also add the call site before the type exists — either way, no `runInteractive` yet).

- [ ] **Step 3: Write minimal implementation**

Modify `src/adapters/types.ts` — replace the `AgentAdapter` interface (lines 45-48):

```ts
import type { InteractiveOpts, InteractiveSession } from "./interactive/types";

export interface AgentAdapter {
  readonly id: "codex" | "claude" | "agy";
  run(opts: RunOpts): WorkerRun;
  runInteractive?(opts: InteractiveOpts): Promise<InteractiveSession>;
}
```

Modify `src/adapters/codex/codex-adapter.ts` — add imports at the top and update the `codexAdapter` export at the bottom (lines 136-139):

```ts
import { startInteractive } from "../interactive/interactive-session";
import { codexInteractive } from "./interactive-profile";

// ... existing runCodex unchanged ...

export const codexAdapter: AgentAdapter = {
  id: "codex",
  run: (opts) => runCodex(opts),
  runInteractive: (opts) => startInteractive(codexInteractive, opts),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — wiring test green; `npm run check-types` also passes (no import cycle: `interactive/types.ts` does not import from `codex/`).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/types.ts src/adapters/codex/codex-adapter.ts src/test/codex-adapter-interactive-wiring.test.ts
git commit -m "feat: wire codexAdapter.runInteractive to startInteractive(codexInteractive)"
```

---

### Task 12: Real-CLI integration proof

**Files:**
- Create: `src/test/codex-interactive.integration.test.ts`

**Interfaces:**
- Consumes: `codexAdapter` (Task 11).
- Produces: nothing new — this is the acceptance gate for the whole US.

Mirrors the already-passing `terminal-probe.test.ts` scenario (pause → resume → done, session metadata) but drives it through the production `codexAdapter.runInteractive` path instead of probe-local helpers, closing the gap the groomed spec flagged in its proof-of-function section.

- [ ] **Step 1: Write the test**

Create `src/test/codex-interactive.integration.test.ts`. Gated behind `CODEX_INTERACTIVE_E2E` so a normal `npm test` skips it (mirrors `codex-adapter.integration.test.ts`'s `CODEX_E2E` gate):

```ts
import * as assert from "assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { codexAdapter } from "../adapters/codex/codex-adapter";

const describe = process.env.CODEX_INTERACTIVE_E2E ? suite : suite.skip;

describe("codex interactive mode (real CLI, slow — set CODEX_INTERACTIVE_E2E=1)", function () {
  this.timeout(240_000);

  test("drives a real codex TUI through pause and done via the production adapter", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "codex-interactive-e2e-"));
    const stateFile = path.join(cwd, "flow-state.txt");

    const session = await codexAdapter.runInteractive!({ cwd, workerId: "e2e" });

    try {
      const first = await session.send(
        [
          "Turn 1 of 2.",
          "Write flow-state.txt containing exactly `step-1` followed by one newline.",
          'Then write the outbox JSON for this turn with exactly: {"status":"paused","summary":"step 1 complete"}',
          "Stop after the outbox file exists.",
        ].join("\n")
      );
      assert.strictEqual(first.status, "paused");
      assert.strictEqual(await fs.readFile(stateFile, "utf8"), "step-1\n");

      const second = await session.send(
        [
          "Turn 2 of 2.",
          "Append exactly `step-2` followed by one newline to flow-state.txt.",
          'Then write the outbox JSON for this turn with exactly: {"status":"done","summary":"flow complete","filesTouched":["flow-state.txt"]}',
          "Stop after the outbox file exists.",
        ].join("\n")
      );
      assert.strictEqual(second.status, "done");
      assert.strictEqual(await fs.readFile(stateFile, "utf8"), "step-1\nstep-2\n");

      const sessionId = await session.sessionId;
      assert.match(sessionId ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    } finally {
      await session.dispose();
      const remainingAgents = await fs.readFile(path.join(cwd, "AGENTS.md"), "utf8").catch(() => "");
      assert.ok(!remainingAgents.includes("skynet-interactive"), "instruction-file marker block was stripped");
    }
  });
});
```

- [ ] **Step 2: Run it**

Run: `CODEX_INTERACTIVE_E2E=1 npm test`
Expected: PASS. This uses real quota and takes a few minutes — same tradeoff as the existing `CODEX_E2E=1 npm test` gate.

- [ ] **Step 3: Run the full fast suite once more to confirm nothing else regressed**

Run: `npm test`
Expected: PASS — every suite from Tasks 1-11 green; this integration suite shows as pending/skipped (`CODEX_INTERACTIVE_E2E` unset).

- [ ] **Step 4: Commit**

```bash
git add src/test/codex-interactive.integration.test.ts
git commit -m "feat: real-CLI integration proof for interactive codex mode"
```

- [ ] **Step 5: Update the roadmap entry**

Modify `docs/superpowers/roadmap.json` — set the `plan` field for the `adapters--interactive-codex` entry (status stays `"open"` until this ships; that's a separate decision, not part of this plan):

```json
"plan": "plans/2026-07-01-interactive-codex.md",
```

```bash
git add docs/superpowers/roadmap.json
git commit -m "docs: link interactive-codex roadmap entry to its plan"
```

---

## Self-review

**Spec coverage:** every numbered component in the groomed spec's Architecture section maps to a task — `TerminalSession`/`TerminalTransport` → Task 8, `Mailbox` → Task 2, `Doorbell` → Task 3, protocol bootstrap → Task 4, `SessionHarvester` → Task 7 (+ Task 6 for the codex-specific parse), `InteractiveSession` → Task 9, per-CLI profile → Task 10, integration seam → Task 11. Readiness handshake and crash sad-path → Task 9 (`waitForOutbox`) + Task 5 (`hasLiveDescendant`). Proof-of-function bullets (turn cycle, timeout, partial outbox, crash, rollout parser, doorbell) → Tasks 2, 3, 5, 6, 9. Submit-key gate and slash-status diagnostic are already DONE per the groomed spec (cited, not re-planned). Real-CLI integration → Task 12.

**Out of scope, confirmed not planned here:** multi-worker fleet/scheduler, claude/agy profiles (deferred per the grooming conversation), automated `codex resume` recovery, Windows PID polling, webview panel rework — all inherited from the spec's Out-of-scope section, none touched by this plan.

**Placeholder scan:** no TBD/TODO markers; every step has real code or an exact command.

**Type consistency:** `TurnResult`, `InteractiveOpts`, `InteractiveCliProfile`, `TerminalTransport`, `HarvestResult` are defined once in Task 1 and referenced identically (same field names) through Tasks 2-12. `Mailbox.relativeDir`/`dir`, `ring()`, `hasLiveDescendant()`, `harvestSession()`, `parseCodexRollout()`, `codexInteractive`, `startInteractive()` each have exactly one definition (their own task) and are only imported, never redefined, downstream.

**Refine pass (2026-07-01):** applied 4 should-fix findings — `readFileIfExists` deduplicated into `fs-helpers.ts` (Task 2, consumed by Task 4); `onDidClose()`'s returned `dispose()` now actually unsubscribes in both `FakeTerminalTransport` (Task 3) and `VscodeTerminalTransport` (Task 8); `interactive-session.ts` (Task 9) no longer statically imports `vscode-terminal-transport`/`process-watch` — both defaults are resolved via dynamic `import()` so the core module has no hard load-time coupling to `vscode` or `ps`; Task 10's merge step now shows the complete final file instead of a fragment. Declined: splitting US-1 into multiple User Stories (no intermediate component is independently user-testable — the single-US structure is pragmatic, not a layer-split). Full findings: `.superpowers/plan-refine/2026-07-01-interactive-codex-findings.md`.

---

Plan complete and saved to `docs/superpowers/plans/2026-07-01-interactive-codex.md`. Two options:

1. **Refine** — get an independent review pass (gaps, ambiguity, User Story slicing) before execution
2. **Execute** — go straight to execution

Which would you like?
