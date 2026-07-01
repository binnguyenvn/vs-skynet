# Interactive Agy Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second, interactive run mode to the agy adapter that drives `agy` as a live TUI inside a VSCode terminal — reusing the already-shipped CLI-agnostic core (`src/adapters/interactive/`) built for codex — proven against a real `agy` install, alongside the existing one-shot `runAgy`.

**Architecture:** The CLI-agnostic core (mailbox, doorbell, instruction-file bootstrap, crash detection, session harvesting, the `InteractiveSession` state machine, `TerminalTransport`) already exists and is fully tested from the interactive-codex plan — nothing there needs rebuilding. This plan adds exactly two new things: (1) a shared `SessionInfoProbe` fallback in `src/adapters/interactive/` — for CLIs with no readable on-disk session transcript, it asks the agent to write `outbox/session-info.json` and wires the result into `InteractiveSession`'s existing sessionId-harvest path — and (2) `src/adapters/agy/interactive-profile.ts` supplying the one CLI-specific seam (`agyInteractive: InteractiveCliProfile`), which is agy's only new file. `agyAdapter.runInteractive()` wires the two together, exactly like `codexAdapter.runInteractive()` already does.

**Tech Stack:** TypeScript (Node16 modules, strict), VSCode extension API (`vscode.window.createTerminal`), Node `child_process`/`fs/promises`/`events`, mocha/`@vscode/test-cli` test runner, `assert`.

## Global Constraints

- This is **additive only**: `runAgy` / `agyAdapter.run` (`src/adapters/agy/agy-adapter.ts`) are unchanged. Interactive mode is a new sibling.
- Verified against a real `agy` install by `src/test/terminal-probe.test.ts`'s `agy-ultra` profile (`TERMINAL_PROBE=1`, confirmed passing 2026-07-01): launching **without** `--print` starts a real interactive TUI, driven by `agy --dangerously-skip-permissions --new-project --add-dir <cwd>`; `GEMINI.md` is read as the instruction channel; plain Enter (`"\r"`) submits — **not** the spec skeleton's guessed kitty escape (`[13u`).
- `--model` is passed through best-effort the same way the one-shot `agyAdapter` does it (`--model <m>` when given). `--sandbox` is **intentionally omitted** from the interactive launch argv: the probe never exercised it in interactive mode, and agy's one-shot `--sandbox` is a bare on/off switch while `InteractiveOpts.sandbox` is a 3-way enum (`"read-only"|"workspace-write"|"danger-full-access"`) — there is no verified mapping between the two, so `opts.sandbox` is silently unused for agy in v1.
- agy has **no confirmed on-disk session transcript** — `agyInteractive.harvest()` always returns `{}`. `sessionId` comes exclusively from the new `SessionInfoProbe` fallback (`agyInteractive.sessionInfoPrompt`), which the probe proved works: the agent writes `outbox/session-info.json` with `conversationId`/`model`/`workspace`/`artifactDirectory`, and `conversationId` becomes the harvested `sessionId`. No usage/token data is available for agy in v1 (matches the spec's stated "likely degraded mode").
- The `sessionInfoPrompt` text is the **exact wording proved by the probe** (Vietnamese) — reused verbatim rather than re-translated, so production behavior matches what was actually tested against the real CLI.
- Default timeouts (inherited, unchanged): `turnTimeoutMs` 300000 (5 min), `readyTimeoutMs` 30000 (30s, turn-1 only). New: `sessionInfoTimeoutMs` 90000 (90s, matches the probe's own wait), injectable via `StartInteractiveDeps` for fast deterministic tests.
- Crash detection is macOS/Linux only in v1 (inherited, unchanged).
- Protocol bootstrap never overwrites a target repo's real `GEMINI.md`; it appends a marker-delimited block and strips it back out on `dispose()` (inherited, unchanged — `bootstrapInstructionFile`/`teardownInstructionFile` already handle any instruction filename).
- Tests reuse the existing runner: `*.test.ts` under `src/test/`, compiled to `out/` by `npm run compile-tests`, run with `npm test`.
- The real-CLI integration test is gated behind `process.env.AGY_INTERACTIVE_E2E` so `npm test` does not burn quota by default (mirrors `CODEX_INTERACTIVE_E2E` and the existing `AGY_E2E` convention in `src/test/agy-adapter.integration.test.ts`).
- Relative imports omit the `.js` extension (matches existing `src/test/*.test.ts`).
- Spec: [`docs/superpowers/specs/2026-06-30-interactive-agy-design.md`](../specs/2026-06-30-interactive-agy-design.md) and the canonical frame [`docs/superpowers/specs/2026-06-30-interactive-codex-design.md`](../specs/2026-06-30-interactive-codex-design.md) (read both first). The spec's NEEDS-RESEARCH table is resolved as described above and in `src/test/terminal-probe.test.ts`'s `agy-ultra` profile — this plan implements it as grooming-updated 2026-07-01, not as originally drafted.

---

## US-1: Interactive Agy Mode

A developer can call `agyAdapter.runInteractive({cwd, workerId})`, get back an `InteractiveSession`, `send()` turns that pause or complete, watch a sparse `WorkerEvent` stream, get a harvested `sessionId` via the session-info fallback (no usage — agy has none), `dispose()` cleanly, and manually exercise all of it through a webview smoke button — proven by deterministic unit tests (fake terminal transport) plus an opt-in real-CLI integration test.

### Task 1: SessionInfoProbe fallback + wire into InteractiveSession

**Files:**
- Create: `src/adapters/interactive/session-info-probe.ts`
- Test: `src/test/interactive-session-info-probe.test.ts`
- Modify: `src/adapters/interactive/interactive-session.ts`
- Modify: `src/test/interactive-session.test.ts`

**Interfaces:**
- Consumes: `ring` from `./doorbell`, `HarvestResult`/`TerminalTransport` from `./types` (all already exist). `harvestSession` from `./session-harvester` (already exists, unchanged).
- Produces: `function probeSessionInfo(transport: TerminalTransport, mailboxDir: string, buildPrompt: (outboxPath: string) => string, submitSequence: string, timeoutMs?: number): Promise<HarvestResult>` — new. `StartInteractiveDeps.sessionInfoTimeoutMs: number` — new field on the already-existing interface. `InteractiveSessionImpl.afterTurn()` gains one new branch: when `harvestSession()` yields no `sessionId` and the profile has a `sessionInfoPrompt`, call `probeSessionInfo()` once per turn (until a sessionId is found) and use its result the same way harvested rollout data is used today.

This is the one piece of shared core plumbing the codex plan didn't need (codex's rollout JSONL is authoritative, so it never sets `sessionInfoPrompt`). It is CLI-agnostic: any future profile that sets `sessionInfoPrompt` gets this fallback for free.

- [ ] **Step 1: Write the failing tests for `probeSessionInfo`**

Create `src/test/interactive-session-info-probe.test.ts`:

```ts
import * as assert from "assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { probeSessionInfo } from "../adapters/interactive/session-info-probe";
import { FakeTerminalTransport } from "./helpers/fake-terminal-transport";

async function mkTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "session-info-probe-test-"));
}

function writeFileSoon(file: string, content: string, delayMs = 20): void {
  setTimeout(() => {
    void fs.mkdir(path.dirname(file), { recursive: true }).then(() => fs.writeFile(file, content));
  }, delayMs);
}

suite("probeSessionInfo", () => {
  test("rings the doorbell with the built prompt, then resolves sessionId once the file appears", async () => {
    const dir = await mkTmpDir();
    const transport = new FakeTerminalTransport();
    const outboxFile = path.join(dir, "outbox", "session-info.json");
    writeFileSoon(outboxFile, JSON.stringify({ conversationId: "abc-123", model: "gemini-3" }));

    const result = await probeSessionInfo(transport, dir, (file) => `write session info to ${file}`, "\r", 2_000);

    assert.deepStrictEqual(result, { sessionId: "abc-123" });
    assert.deepStrictEqual(transport.calls, [
      { method: "show", args: [false] },
      { method: "sendText", args: [`write session info to ${outboxFile}`, false] },
      { method: "sendSequence", args: ["\r"] },
    ]);
  });

  test("returns {} when the JSON has no conversationId", async () => {
    const dir = await mkTmpDir();
    const transport = new FakeTerminalTransport();
    writeFileSoon(path.join(dir, "outbox", "session-info.json"), JSON.stringify({ model: "gemini-3" }));

    const result = await probeSessionInfo(transport, dir, (file) => file, "\r", 2_000);
    assert.deepStrictEqual(result, {});
  });

  test("retries past a half-written file and resolves once it is valid JSON", async () => {
    const dir = await mkTmpDir();
    const transport = new FakeTerminalTransport();
    const outboxFile = path.join(dir, "outbox", "session-info.json");
    await fs.mkdir(path.dirname(outboxFile), { recursive: true });
    await fs.writeFile(outboxFile, '{"conversationId":"ab');
    setTimeout(() => void fs.writeFile(outboxFile, JSON.stringify({ conversationId: "final-id" })), 100);

    const result = await probeSessionInfo(transport, dir, (file) => file, "\r", 2_000);
    assert.deepStrictEqual(result, { sessionId: "final-id" });
  });

  test("returns {} when the file never appears before the timeout", async () => {
    const dir = await mkTmpDir();
    const transport = new FakeTerminalTransport();
    const result = await probeSessionInfo(transport, dir, (file) => file, "\r", 150);
    assert.deepStrictEqual(result, {});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile-tests`
Expected: FAIL — `Cannot find module '../adapters/interactive/session-info-probe'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/adapters/interactive/session-info-probe.ts`:

```ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ring } from "./doorbell";
import type { HarvestResult, TerminalTransport } from "./types";

const DEFAULT_TIMEOUT_MS = 90_000;
const POLL_MS = 500;

interface SessionInfoJson {
  conversationId?: unknown;
}

export async function probeSessionInfo(
  transport: TerminalTransport,
  mailboxDir: string,
  buildPrompt: (outboxPath: string) => string,
  submitSequence: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<HarvestResult> {
  const file = path.join(mailboxDir, "outbox", "session-info.json");
  await ring(transport, buildPrompt(file), submitSequence);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const data = JSON.parse(await fs.readFile(file, "utf8")) as SessionInfoJson;
      return data.conversationId ? { sessionId: String(data.conversationId) } : {};
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && !(err instanceof SyntaxError)) {
        throw err;
      }
    }
    await delay(Math.min(POLL_MS, Math.max(0, deadline - Date.now())));
  }
  return {};
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all four `probeSessionInfo` cases green.

- [ ] **Step 5: Write the failing test for the wiring into `InteractiveSession`**

Modify `src/test/interactive-session.test.ts` — insert this new test as the **last** test inside `suite("InteractiveSession", ...)`, immediately before its closing `});`. The tail of the file currently reads:

```ts
    assert.strictEqual(await fs.readFile(path.join(cwd, "FAKE_AGENTS.md"), "utf8"), "# Real project instructions\n");
    await assert.rejects(fs.access(path.join(cwd, ".skynet", "w7")));
  });
});
```

Change it to:

```ts
    assert.strictEqual(await fs.readFile(path.join(cwd, "FAKE_AGENTS.md"), "utf8"), "# Real project instructions\n");
    await assert.rejects(fs.access(path.join(cwd, ".skynet", "w7")));
  });

  test("falls back to sessionInfoPrompt when harvest yields no sessionId, using it once found", async () => {
    const cwd = await mkTmpRepo();
    const transport = new FakeTerminalTransport();
    const profile = fakeProfile({
      sessionInfoPrompt: (file) => `write conversation info to ${file}`,
    });
    const session = await startInteractive(
      profile,
      { cwd, workerId: "w8", readyTimeoutMs: 2_000, turnTimeoutMs: 2_000 },
      {
        terminalFactory: { create: () => transport },
        launchDelayMs: 0,
        mailboxPollMs: 20,
        sessionInfoTimeoutMs: 2_000,
      }
    );

    writeOutboxSoon(cwd, "w8", 1, { status: "paused", summary: "step 1 complete" });
    setTimeout(() => {
      void fs.writeFile(
        path.join(cwd, ".skynet", "w8", "outbox", "session-info.json"),
        JSON.stringify({ conversationId: "conv-42" })
      );
    }, 60);

    const result = await session.send("turn 1");
    assert.deepStrictEqual(result, { status: "paused", summary: "step 1 complete" });
    assert.strictEqual(await session.sessionId, "conv-42");

    await session.dispose();
  });
});
```

(`fakeProfile()`'s defaults — `sessionDir: (dir) => dir ?? "/nonexistent"`, `harvest: () => ({})` — already guarantee `harvestSession()` finds nothing, so this test exercises the fallback path without needing to override them.)

- [ ] **Step 6: Run test to verify it fails**

Run: `npm run compile-tests`
Expected: FAIL — `StartInteractiveDeps` has no property `sessionInfoTimeoutMs` (type error), or (if that's loosened) the test times out/fails because nothing calls `probeSessionInfo` yet.

- [ ] **Step 7: Wire the fallback into `InteractiveSession`**

Modify `src/adapters/interactive/interactive-session.ts` so the complete file reads exactly as follows (adds the `probeSessionInfo` import, the `DEFAULT_SESSION_INFO_TIMEOUT_MS` constant, `sessionInfoTimeoutMs` on `StartInteractiveDeps` + its default, and the fallback branch in `afterTurn()`; everything else is unchanged). Note: `afterTurn()`'s local `harvested` changes from `const` to `let`, because the new fallback branch may reassign it.

```ts
import { EventEmitter, once } from "node:events";
import { classifyError } from "../classify";
import type { WorkerEvent } from "../types";
import { ring } from "./doorbell";
import { bootstrapInstructionFile, teardownInstructionFile } from "./instruction-file";
import { Mailbox } from "./mailbox";
import { harvestSession } from "./session-harvester";
import { probeSessionInfo } from "./session-info-probe";
import { buildLaunchCommand } from "./shell";
import type {
  HarvestResult,
  InteractiveCliProfile,
  InteractiveOpts,
  InteractiveSession,
  TerminalFactory,
  TerminalTransport,
  TurnResult,
} from "./types";

const DEFAULT_TURN_TIMEOUT_MS = 300_000;
const DEFAULT_READY_TIMEOUT_MS = 30_000;
const DEFAULT_CRASH_POLL_MS = 3_000;
const DEFAULT_LAUNCH_DELAY_MS = 1_500;
const DEFAULT_MAILBOX_POLL_MS = 500;
const DEFAULT_SESSION_INFO_TIMEOUT_MS = 90_000;

export interface StartInteractiveDeps {
  terminalFactory: TerminalFactory;
  checkAlive: (pid: number, matchName: string) => Promise<boolean>;
  crashPollMs: number;
  launchDelayMs: number;
  mailboxPollMs: number;
  sessionInfoTimeoutMs: number;
}

async function defaultTerminalFactory(): Promise<TerminalFactory> {
  const { VscodeTerminalFactory } = await import("./vscode-terminal-transport.js");
  return new VscodeTerminalFactory();
}

async function defaultCheckAlive(): Promise<(pid: number, matchName: string) => Promise<boolean>> {
  const { hasLiveDescendant } = await import("./process-watch.js");
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
    sessionInfoTimeoutMs: deps.sessionInfoTimeoutMs ?? DEFAULT_SESSION_INFO_TIMEOUT_MS,
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

    await this.mailbox.writeInbox(turn, prompt);
    const pingLine = `Read ${this.mailbox.relativeDir}/inbox/turn-${turn}.md and follow it.`;
    await ring(this.transport, pingLine, this.profile.submitSequence);

    const readyTimeoutMs = this.opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
    const turnTimeoutMs = this.opts.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
    let raw = await this.waitForOutbox(turn, turn === 1 ? readyTimeoutMs : turnTimeoutMs);
    if (raw === "timeout" && turn === 1) {
      await ring(this.transport, pingLine, this.profile.submitSequence);
      raw = await this.waitForOutbox(turn, readyTimeoutMs);
    }

    return this.afterTurn(this.toTurnResult(raw));
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
    let harvested: HarvestResult = await harvestSession(this.profile, this.opts.configDir).catch(() => ({}));

    if (!harvested.sessionId && this._sessionId === undefined && this.profile.sessionInfoPrompt) {
      harvested = await probeSessionInfo(
        this.transport,
        this.mailbox.dir,
        this.profile.sessionInfoPrompt,
        this.profile.submitSequence,
        this.deps.sessionInfoTimeoutMs
      ).catch(() => harvested);
    }

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

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all eight `InteractiveSession` cases (the original seven plus the new fallback case) green, plus all four `probeSessionInfo` cases still green.

- [ ] **Step 9: Commit**

```bash
git add src/adapters/interactive/session-info-probe.ts src/adapters/interactive/interactive-session.ts src/test/interactive-session-info-probe.test.ts src/test/interactive-session.test.ts
git commit -m "feat: session-info-probe fallback for CLIs with no readable session transcript"
```

---

### Task 2: agy interactive profile

**Files:**
- Create: `src/adapters/agy/interactive-profile.ts`
- Test: `src/test/agy-interactive-profile.test.ts`

**Interfaces:**
- Consumes: `InteractiveCliProfile` from `../interactive/types` (existing).
- Produces: `const agyInteractive: InteractiveCliProfile`

Launch argv, instruction file, and submit key match exactly what `terminal-probe.test.ts`'s `agy-ultra` profile proved working against a real `agy` install.

- [ ] **Step 1: Write the failing test**

Create `src/test/agy-interactive-profile.test.ts`:

```ts
import * as assert from "assert";
import * as os from "node:os";
import * as path from "node:path";
import { agyInteractive } from "../adapters/agy/interactive-profile";

suite("agyInteractive profile", () => {
  test("launchArgv matches the probe-verified argv, without --print", () => {
    assert.deepStrictEqual(agyInteractive.launchArgv({ cwd: "/tmp/proj", workerId: "w1" }), [
      "--dangerously-skip-permissions",
      "--new-project",
      "--add-dir",
      "/tmp/proj",
    ]);
  });

  test("launchArgv includes --model only when a model is given", () => {
    const argv = agyInteractive.launchArgv({ cwd: "/tmp/proj", workerId: "w1", model: "gemini-3-pro" });
    assert.strictEqual(argv[argv.indexOf("--model") + 1], "gemini-3-pro");
  });

  test("launchArgv never includes --sandbox (unverified in interactive mode)", () => {
    const argv = agyInteractive.launchArgv({ cwd: "/tmp/proj", workerId: "w1", sandbox: "workspace-write" });
    assert.strictEqual(argv.includes("--sandbox"), false);
  });

  test("configEnv sets HOME only when configDir is given", () => {
    assert.deepStrictEqual(agyInteractive.configEnv("/config/dir"), { HOME: "/config/dir" });
    assert.deepStrictEqual(agyInteractive.configEnv(undefined), {});
  });

  test("sessionDir defaults to ~/.gemini and relocates under configDir", () => {
    assert.strictEqual(agyInteractive.sessionDir(undefined), path.join(os.homedir(), ".gemini"));
    assert.strictEqual(agyInteractive.sessionDir("/config/dir"), path.join("/config/dir", ".gemini"));
  });

  test("harvest always returns {} (no confirmed on-disk transcript)", () => {
    assert.deepStrictEqual(agyInteractive.harvest("anything"), {});
  });

  test("submitSequence and instructionFile match the probe", () => {
    assert.strictEqual(agyInteractive.submitSequence, "\r");
    assert.strictEqual(agyInteractive.instructionFile, "GEMINI.md");
    assert.strictEqual(agyInteractive.id, "agy");
  });

  test("sessionInfoPrompt embeds the given outbox path and asks for conversationId", () => {
    const prompt = agyInteractive.sessionInfoPrompt!("/tmp/proj/.skynet/w1/outbox/session-info.json");
    assert.ok(prompt.includes("/tmp/proj/.skynet/w1/outbox/session-info.json"));
    assert.ok(prompt.includes("conversationId"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile-tests`
Expected: FAIL — `Cannot find module '../adapters/agy/interactive-profile'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/adapters/agy/interactive-profile.ts`:

```ts
import * as os from "node:os";
import * as path from "node:path";
import type { InteractiveCliProfile } from "../interactive/types";

// Verified against a real `agy` install via src/test/terminal-probe.test.ts's
// "agy-ultra" profile (TERMINAL_PROBE=1, confirmed passing 2026-07-01):
// launching without --print starts an interactive TUI; GEMINI.md is read as
// the instruction channel; plain Enter ("\r") submits — not the kitty escape
// the spec skeleton guessed. agy never confirmed a readable on-disk session
// transcript, so harvest() always returns {} and sessionId comes only from
// the sessionInfoPrompt fallback (see session-info-probe.ts).
export const agyInteractive: InteractiveCliProfile = {
  id: "agy",
  launchArgv: (o) => [
    "--dangerously-skip-permissions",
    "--new-project",
    ...(o.model ? ["--model", o.model] : []),
    "--add-dir",
    o.cwd,
    // ponytail: --sandbox intentionally omitted — the probe never exercised
    // it in interactive mode, and agy's one-shot --sandbox is a bare switch
    // while InteractiveOpts.sandbox is a 3-way enum; no verified mapping.
  ],
  configEnv: (dir) => (dir ? { HOME: dir } : {}),
  instructionFile: "GEMINI.md",
  submitSequence: "\r",
  sessionDir: (dir) => path.join(dir ?? os.homedir(), ".gemini"),
  harvest: () => ({}),
  sessionInfoPrompt: (file) =>
    `thông tin session này; ghi kết quả vào ${file} dạng JSON hợp lệ với các field ` +
    '{"conversationId":"...","model":"...","workspace":"...","artifactDirectory":"..."}; ' +
    "conversationId phải là Conversation ID đầy đủ nếu có; artifactDirectory phải là Artifact Directory đầy đủ nếu có; chỉ ghi file JSON.",
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all eight `agyInteractive profile` cases green.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/agy/interactive-profile.ts src/test/agy-interactive-profile.test.ts
git commit -m "feat: agyInteractive profile (probe-verified launch argv, GEMINI.md, plain-Enter submit)"
```

---

### Task 3: Wire `agyAdapter.runInteractive`

**Files:**
- Modify: `src/adapters/agy/agy-adapter.ts`
- Test: `src/test/agy-adapter-interactive-wiring.test.ts`

**Interfaces:**
- Consumes: `startInteractive` from `../interactive/interactive-session` (existing), `agyInteractive` (Task 2).
- Produces: `agyAdapter.runInteractive` — `AgentAdapter.runInteractive` already exists on the shared type (added by the interactive-codex plan), so no type changes are needed here.

One-line delegation — no new logic, mirrors `codexAdapter.runInteractive` exactly.

- [ ] **Step 1: Write the failing test**

Create `src/test/agy-adapter-interactive-wiring.test.ts`:

```ts
import * as assert from "assert";
import { agyAdapter } from "../adapters/agy/agy-adapter";

suite("agyAdapter.runInteractive wiring", () => {
  test("is exposed as a function", () => {
    assert.strictEqual(typeof agyAdapter.runInteractive, "function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile-tests`
Expected: FAIL — assertion fails at runtime (`agyAdapter.runInteractive` is `undefined`).

- [ ] **Step 3: Write minimal implementation**

Modify `src/adapters/agy/agy-adapter.ts` — add two imports at the top and update the `agyAdapter` export at the bottom:

```ts
import { spawn } from "node:child_process";
import * as readline from "node:readline";
import { classifyError } from "../classify";
import { startInteractive } from "../interactive/interactive-session";
import { mapAgyLine } from "./events";
import { agyInteractive } from "./interactive-profile";
import type { AgentAdapter, RunOpts, WorkerEvent, WorkerResult, WorkerRun } from "../types";

// ... runAgy() unchanged ...

export const agyAdapter: AgentAdapter = {
  id: "agy",
  run: (opts) => runAgy(opts),
  runInteractive: (opts) => startInteractive(agyInteractive, opts),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — wiring test green; `npm run check-types` also passes.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/agy/agy-adapter.ts src/test/agy-adapter-interactive-wiring.test.ts
git commit -m "feat: wire agyAdapter.runInteractive to startInteractive(agyInteractive)"
```

---

### Task 4: Real-CLI integration proof

**Files:**
- Create: `src/test/agy-interactive.integration.test.ts`

**Interfaces:**
- Consumes: `agyAdapter` (Task 3).
- Produces: nothing new — this is the acceptance gate for the whole US.

Mirrors the already-passing `terminal-probe.test.ts` `agy-ultra` scenario (pause → resume → done, session-info fallback) but drives it through the production `agyAdapter.runInteractive` path instead of probe-local helpers. Matches the plain style of the existing `agy-adapter.integration.test.ts` (no `configDir` override — runs against the real default `HOME`).

- [ ] **Step 1: Write the test**

Create `src/test/agy-interactive.integration.test.ts`. Gated behind `AGY_INTERACTIVE_E2E` so a normal `npm test` skips it (mirrors `AGY_E2E` and `CODEX_INTERACTIVE_E2E`):

```ts
import * as assert from "assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { agyAdapter } from "../adapters/agy/agy-adapter";

const describe = process.env.AGY_INTERACTIVE_E2E ? suite : suite.skip;

describe("agy interactive mode (real CLI, slow — set AGY_INTERACTIVE_E2E=1)", function () {
  this.timeout(240_000);

  test("drives a real agy TUI through pause and done via the production adapter", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "agy-interactive-e2e-"));
    const stateFile = path.join(cwd, "flow-state.txt");
    const session = await agyAdapter.runInteractive!({ cwd, workerId: "e2e" });

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
      const remainingGemini = await fs.readFile(path.join(cwd, "GEMINI.md"), "utf8").catch(() => "");
      assert.ok(!remainingGemini.includes("skynet-interactive"), "instruction-file marker block was stripped");
    }
  });
});
```

- [ ] **Step 2: Run it**

Run: `AGY_INTERACTIVE_E2E=1 npm test`
Expected: PASS. Uses real quota/session and takes a few minutes — same tradeoff as `AGY_E2E=1 npm test` and `CODEX_INTERACTIVE_E2E=1 npm test`.

- [ ] **Step 3: Run the full fast suite once more to confirm nothing else regressed**

Run: `npm test`
Expected: PASS — every suite from Tasks 1-3 green; this integration suite shows as pending/skipped (`AGY_INTERACTIVE_E2E` unset).

- [ ] **Step 4: Commit**

```bash
git add src/test/agy-interactive.integration.test.ts
git commit -m "feat: real-CLI integration proof for interactive agy mode"
```

- [ ] **Step 5: Update the roadmap entry**

Modify `docs/superpowers/roadmap.json` — set the `plan` field for the `adapters--interactive-agy` entry (status stays `"open"` until this ships — a separate decision, not part of this plan):

```json
"plan": "plans/2026-07-01-interactive-agy.md",
```

```bash
git add docs/superpowers/roadmap.json
git commit -m "docs: link interactive-agy roadmap entry to its plan"
```

---

### Task 5: Generalize the webview interactive bridge for multi-CLI + agy smoke button

**Files:**
- Modify: `src/webview/protocol.ts`
- Modify: `src/adapters/webview-bridge.ts`
- Modify: `src/webview/panel.ts`
- Modify: `src/integration/hello.tsx`
- Modify: `src/test/webview-bridge-interactive.test.ts`

**Interfaces:**
- Consumes: `AgentAdapter`, `InteractiveSession`, `TurnResult` (existing); `agyAdapter.runInteractive` (Task 3).
- Produces: `startInteractiveTestToWebview` now derives its log-message type from `adapter.id` instead of hardcoding `"codexInteractiveLog"`. `sendInteractiveTurn` gains a required 4th parameter, `logType: "codexInteractiveLog" | "agyInteractiveLog"`, so it can post to either channel. `hello.tsx`'s `CodexInteractiveForm` is replaced by a generic `InteractiveForm` driven by an `INTERACTIVE_CLIS` config array (mirrors the existing `CliForm`/`CLIS` pattern used for the one-shot test buttons), rendering one form for Codex and one for Agy.

Today `startInteractiveTestToWebview`/`sendInteractiveTurn` hardcode the `codexInteractiveLog` message type — that was fine with one interactive CLI, but adding agy's smoke button needs a second channel. This task generalizes both functions (small, additive change to already-shipped code) and adds the agy-specific wiring end to end: message types → bridge → panel → UI.

- [ ] **Step 1: Write the failing tests for the generalized bridge functions**

Modify `src/test/webview-bridge-interactive.test.ts` so the complete file reads exactly as follows (adds an `agy`-flavored `startInteractiveTestToWebview` suite, updates all four existing `sendInteractiveTurn` calls to pass the new required `logType` argument, and adds one `agyInteractiveLog` case):

```ts
import * as assert from "assert";
import { sendInteractiveTurn, startInteractiveTestToWebview } from "../adapters/webview-bridge";
import type { InteractiveSession, TurnResult } from "../adapters/interactive/types";
import type { AgentAdapter, WorkerEvent } from "../adapters/types";
import type { ExtensionToWebview } from "../webview/protocol";

function fakeInteractiveSession(events: WorkerEvent[], turnResults: TurnResult[]): InteractiveSession {
  let turnIndex = 0;
  return {
    async send(): Promise<TurnResult> {
      const result = turnResults[turnIndex] ?? { status: "error", reason: "no more turns configured" };
      turnIndex += 1;
      return result;
    },
    sessionId: Promise.resolve("sess-1"),
    async dispose(): Promise<void> {},
    async *[Symbol.asyncIterator]() {
      yield* events;
    },
  };
}

function fakeAdapter(id: AgentAdapter["id"], runInteractive?: AgentAdapter["runInteractive"]): AgentAdapter {
  return {
    id,
    run: () => {
      throw new Error("run() not used by this test");
    },
    runInteractive,
  };
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

suite("startInteractiveTestToWebview", () => {
  test("starts a codex session and streams its events as codexInteractiveLog lines", async () => {
    const posted: ExtensionToWebview[] = [];
    const session = fakeInteractiveSession(
      [
        { kind: "started", sessionId: "sess-1" },
        { kind: "message", text: "hello from turn 1" },
      ],
      []
    );
    const adapter = fakeAdapter("codex", async () => session);

    const returned = await startInteractiveTestToWebview(
      adapter,
      { postMessage: (m) => (posted.push(m), true) },
      { cwd: "/tmp", workerId: "w1" }
    );
    await flushMicrotasks();

    assert.strictEqual(returned, session);
    assert.deepStrictEqual(posted, [
      { type: "codexInteractiveLog", level: "info", text: "Starting Codex interactive session..." },
      { type: "codexInteractiveLog", level: "info", text: "started session sess-1" },
      { type: "codexInteractiveLog", level: "info", text: "hello from turn 1" },
    ]);
  });

  test("starts an agy session and streams its events as agyInteractiveLog lines", async () => {
    const posted: ExtensionToWebview[] = [];
    const session = fakeInteractiveSession(
      [
        { kind: "started", sessionId: "sess-2" },
        { kind: "message", text: "hello from agy turn 1" },
      ],
      []
    );
    const adapter = fakeAdapter("agy", async () => session);

    const returned = await startInteractiveTestToWebview(
      adapter,
      { postMessage: (m) => (posted.push(m), true) },
      { cwd: "/tmp", workerId: "w1" }
    );
    await flushMicrotasks();

    assert.strictEqual(returned, session);
    assert.deepStrictEqual(posted, [
      { type: "agyInteractiveLog", level: "info", text: "Starting Agy interactive session..." },
      { type: "agyInteractiveLog", level: "info", text: "started session sess-2" },
      { type: "agyInteractiveLog", level: "info", text: "hello from agy turn 1" },
    ]);
  });

  test("posts an error and returns undefined when the adapter has no runInteractive", async () => {
    const posted: ExtensionToWebview[] = [];
    const returned = await startInteractiveTestToWebview(
      fakeAdapter("codex", undefined),
      { postMessage: (m) => (posted.push(m), true) },
      { cwd: "/tmp", workerId: "w1" }
    );

    assert.strictEqual(returned, undefined);
    assert.deepStrictEqual(posted, [
      { type: "codexInteractiveLog", level: "error", text: "codex does not support interactive mode" },
    ]);
  });
});

suite("sendInteractiveTurn", () => {
  test("posts a formatted line for paused, done, error, timeout, and crashed results", async () => {
    const posted: ExtensionToWebview[] = [];
    const session = fakeInteractiveSession([], [
      { status: "paused", summary: "step 1 complete" },
      { status: "done", summary: "all done", filesTouched: ["a.txt"] },
      { status: "error", reason: "hit a 429 rate limit" },
      { status: "timeout" },
      { status: "crashed" },
    ]);
    const webview = { postMessage: (m: ExtensionToWebview) => (posted.push(m), true) };

    await sendInteractiveTurn(session, webview, "turn 1", "codexInteractiveLog");
    await sendInteractiveTurn(session, webview, "turn 2", "codexInteractiveLog");
    await sendInteractiveTurn(session, webview, "turn 3", "codexInteractiveLog");
    await sendInteractiveTurn(session, webview, "turn 4", "codexInteractiveLog");
    await sendInteractiveTurn(session, webview, "turn 5", "codexInteractiveLog");

    assert.deepStrictEqual(posted, [
      { type: "codexInteractiveLog", level: "info", text: "paused: step 1 complete" },
      { type: "codexInteractiveLog", level: "info", text: "done: all done" },
      { type: "codexInteractiveLog", level: "error", text: "error: hit a 429 rate limit" },
      { type: "codexInteractiveLog", level: "error", text: "timeout" },
      { type: "codexInteractiveLog", level: "error", text: "crashed" },
    ]);
  });

  test("posts to the agyInteractiveLog channel when told to", async () => {
    const posted: ExtensionToWebview[] = [];
    const session = fakeInteractiveSession([], [{ status: "paused", summary: "agy step 1" }]);
    const webview = { postMessage: (m: ExtensionToWebview) => (posted.push(m), true) };

    await sendInteractiveTurn(session, webview, "turn 1", "agyInteractiveLog");

    assert.deepStrictEqual(posted, [{ type: "agyInteractiveLog", level: "info", text: "paused: agy step 1" }]);
  });

  test("posts an error when no session is running yet", async () => {
    const posted: ExtensionToWebview[] = [];
    await sendInteractiveTurn(undefined, { postMessage: (m) => (posted.push(m), true) }, "turn 1", "codexInteractiveLog");
    assert.deepStrictEqual(posted, [
      {
        type: "codexInteractiveLog",
        level: "error",
        text: "no interactive session running - click Start Interactive first",
      },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile-tests`
Expected: FAIL — `agyInteractiveLog` is not a valid `ExtensionToWebview` member yet, and `sendInteractiveTurn` does not accept a 4th argument.

- [ ] **Step 3: Add the `agyInteractiveLog`/`testAgyInteractive*` message types**

Modify `src/webview/protocol.ts` so the complete file reads:

```ts
// Messages shared by the extension host and the webview. Imported by both
// sides so the postMessage contract is checked at compile time.

// Per-CLI test knobs from the webview forms. All optional; bridges fall back to
// defaults. oauthToken is claude-only; workerId is interactive-only.
export interface TestFields {
  prompt?: string;
  model?: string;
  configDir?: string;
  oauthToken?: string;
  workerId?: string;
}

export type WebviewToExtension =
  | { type: "ready" }
  | { type: "hello"; name: string }
  | { type: "testCodex"; fields?: TestFields }
  | { type: "testAgy"; fields?: TestFields }
  | { type: "testClaude"; fields?: TestFields }
  | { type: "testCodexInteractiveStart"; fields?: TestFields }
  | { type: "testCodexInteractiveSend"; prompt: string }
  | { type: "testCodexInteractiveDispose" }
  | { type: "testAgyInteractiveStart"; fields?: TestFields }
  | { type: "testAgyInteractiveSend"; prompt: string }
  | { type: "testAgyInteractiveDispose" };

export type ExtensionToWebview =
  | { type: "greeting"; text: string }
  | { type: "codexLog"; level: "info" | "error"; text: string }
  | { type: "agyLog"; level: "info" | "error"; text: string }
  | { type: "claudeLog"; level: "info" | "error"; text: string }
  | { type: "codexInteractiveLog"; level: "info" | "error"; text: string }
  | { type: "agyInteractiveLog"; level: "info" | "error"; text: string };
```

- [ ] **Step 4: Generalize the two interactive bridge functions**

Modify `src/adapters/webview-bridge.ts` — replace `startInteractiveTestToWebview` and `sendInteractiveTurn` (leave `formatEvent`, `formatTurnResult`, `streamAdapterTestToWebview`, `LABELS` unchanged):

```ts
type InteractiveLogType = "codexInteractiveLog" | "agyInteractiveLog";

export async function startInteractiveTestToWebview(
  adapter: AgentAdapter,
  webview: LogWebview,
  opts: InteractiveOpts
): Promise<InteractiveSession | undefined> {
  const logType = `${adapter.id}InteractiveLog` as InteractiveLogType;
  const post = (level: "info" | "error", text: string) => webview.postMessage({ type: logType, level, text });

  if (!adapter.runInteractive) {
    await post("error", `${adapter.id} does not support interactive mode`);
    return undefined;
  }

  await post("info", `Starting ${LABELS[adapter.id]} interactive session...`);
  try {
    const session = await adapter.runInteractive(opts);
    void (async () => {
      try {
        for await (const ev of session) {
          const text = formatEvent(ev);
          if (text) {
            await post("info", text);
          }
        }
      } catch (err) {
        await post("error", err instanceof Error ? err.message : String(err));
      }
    })();
    return session;
  } catch (err) {
    await post("error", err instanceof Error ? err.message : String(err));
    return undefined;
  }
}

export async function sendInteractiveTurn(
  session: InteractiveSession | undefined,
  webview: LogWebview,
  prompt: string,
  logType: InteractiveLogType
): Promise<void> {
  const post = (level: "info" | "error", text: string) => webview.postMessage({ type: logType, level, text });

  if (!session) {
    await post("error", "no interactive session running - click Start Interactive first");
    return;
  }

  try {
    const result = await session.send(prompt);
    const level = result.status === "paused" || result.status === "done" ? "info" : "error";
    await post(level, formatTurnResult(result));
  } catch (err) {
    await post("error", err instanceof Error ? err.message : String(err));
  }
}
```

Note: `webview-bridge.ts` now compiles on its own, but the project as a whole does not yet — `src/webview/panel.ts` still has the old 3-arg `sendInteractiveTurn(codexInteractiveSession, webview, msg.prompt)` call from before this task, which no longer type-checks against the new required `logType` parameter. Step 5 fixes that before the next full-suite run (`npm test` runs `tsc -p .` across the whole project via `pretest`, so it would fail here if run now).

- [ ] **Step 5: Wire agy's message types in the panel**

Modify `src/webview/panel.ts` so the complete file reads:

```ts
import * as vscode from "vscode";
import { agyAdapter } from "../adapters/agy/agy-adapter";
import { claudeAdapter } from "../adapters/claude/claude-adapter";
import { codexAdapter } from "../adapters/codex/codex-adapter";
import { sendInteractiveTurn, startInteractiveTestToWebview, streamAdapterTestToWebview } from "../adapters/webview-bridge";
import { buildWebviewHtml, nonce } from "./html";
import type { TestFields, WebviewToExtension } from "./protocol";
import type { InteractiveSession } from "../adapters/interactive/types";

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

  let codexInteractiveSession: InteractiveSession | undefined;
  let agyInteractiveSession: InteractiveSession | undefined;

  webview.onDidReceiveMessage(
    (msg: WebviewToExtension) => {
      if (msg.type === "hello") {
        vscode.window.showInformationMessage(`Webview says hello: ${msg.name}`);
        webview.postMessage({ type: "greeting", text: `Hello back, ${msg.name}!` });
      }
      const cwd = () =>
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? context.extensionUri.fsPath;
      // configDir/model/oauthToken map straight onto RunOpts; prune empty strings
      // so the bridge defaults stay in effect.
      const clean = (f?: TestFields): Partial<TestFields> =>
        Object.fromEntries(Object.entries(f ?? {}).filter(([, v]) => v !== ""));
      if (msg.type === "testCodex") {
        void streamAdapterTestToWebview(codexAdapter, webview, cwd(), clean(msg.fields));
      }
      if (msg.type === "testAgy") {
        void streamAdapterTestToWebview(agyAdapter, webview, cwd(), clean(msg.fields));
      }
      if (msg.type === "testClaude") {
        void streamAdapterTestToWebview(claudeAdapter, webview, cwd(), clean(msg.fields));
      }
      if (msg.type === "testCodexInteractiveStart") {
        const fields = clean(msg.fields);
        void (async () => {
          codexInteractiveSession = await startInteractiveTestToWebview(codexAdapter, webview, {
            cwd: cwd(),
            workerId: fields.workerId || "webview",
            model: fields.model,
            configDir: fields.configDir,
          });
        })();
      }
      if (msg.type === "testCodexInteractiveSend") {
        void sendInteractiveTurn(codexInteractiveSession, webview, msg.prompt, "codexInteractiveLog");
      }
      if (msg.type === "testCodexInteractiveDispose") {
        const session = codexInteractiveSession;
        codexInteractiveSession = undefined;
        void session?.dispose();
        void webview.postMessage({ type: "codexInteractiveLog", level: "info", text: "disposed" });
      }
      if (msg.type === "testAgyInteractiveStart") {
        const fields = clean(msg.fields);
        void (async () => {
          agyInteractiveSession = await startInteractiveTestToWebview(agyAdapter, webview, {
            cwd: cwd(),
            workerId: fields.workerId || "webview",
            model: fields.model,
            configDir: fields.configDir,
          });
        })();
      }
      if (msg.type === "testAgyInteractiveSend") {
        void sendInteractiveTurn(agyInteractiveSession, webview, msg.prompt, "agyInteractiveLog");
      }
      if (msg.type === "testAgyInteractiveDispose") {
        const session = agyInteractiveSession;
        agyInteractiveSession = undefined;
        void session?.dispose();
        void webview.postMessage({ type: "agyInteractiveLog", level: "info", text: "disposed" });
      }
    },
    undefined,
    context.subscriptions
  );

  return panel;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all `startInteractiveTestToWebview`/`sendInteractiveTurn` cases (codex + new agy) green, and the project compiles cleanly now that both `webview-bridge.ts` and `panel.ts` agree on the 4-arg `sendInteractiveTurn` signature.

- [ ] **Step 7: Generalize the webview form and add the Agy smoke button**

Modify `src/integration/hello.tsx` — replace the `CodexInteractiveForm` function and the `<CodexInteractiveForm />` render call. The complete file reads:

```tsx
import { useEffect, useState } from "react";
import { TerminalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { onMessage, postMessage } from "@/lib/vscode";
import type { ExtensionToWebview, TestFields, WebviewToExtension } from "@/protocol";

interface LogLine {
  level: "info" | "error";
  text: string;
}

type LogMsg = Extract<ExtensionToWebview, { level: "info" | "error" }>;
const isLog = (msg: ExtensionToWebview): msg is LogMsg => msg.type !== "greeting";

interface FieldDef {
  key: keyof TestFields;
  label: string;
  placeholder: string;
}

// prompt/model/configDir apply to all three CLIs; oauthToken is claude-only.
const COMMON_FIELDS: FieldDef[] = [
  { key: "prompt", label: "Prompt", placeholder: "Reply with exactly the word: pong" },
  { key: "model", label: "Model", placeholder: "(adapter default)" },
  { key: "configDir", label: "configDir", placeholder: "isolate account, e.g. ~/.agents/cc-thai" },
];

const INTERACTIVE_FIELDS: FieldDef[] = [
  { key: "workerId", label: "workerId", placeholder: "webview" },
  { key: "model", label: "Model", placeholder: "(adapter default)" },
  { key: "configDir", label: "configDir", placeholder: "isolate account, e.g. ~/.agents/codex-plus" },
];

type TestMsg = Extract<WebviewToExtension, { fields?: TestFields }>;

interface CliConfig {
  type: TestMsg["type"];
  log: LogMsg["type"];
  title: string;
  fields: FieldDef[];
}

const CLIS: CliConfig[] = [
  { type: "testCodex", log: "codexLog", title: "Codex", fields: COMMON_FIELDS },
  { type: "testAgy", log: "agyLog", title: "Agy", fields: COMMON_FIELDS },
  {
    type: "testClaude",
    log: "claudeLog",
    title: "Claude",
    fields: [
      ...COMMON_FIELDS,
      { key: "oauthToken", label: "oauthToken", placeholder: "CLAUDE_CODE_OAUTH_TOKEN" },
    ],
  },
];

function CliForm({ config }: { config: CliConfig }) {
  const [values, setValues] = useState<TestFields>({});
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);

  useEffect(
    () =>
      onMessage((msg) => {
        if (isLog(msg) && msg.type === config.log) {
          setLogs((current) => [...current, { level: msg.level, text: msg.text }]);
          if (msg.level === "error" || msg.text.startsWith("done ")) {
            setRunning(false);
          }
        }
      }),
    [config.log]
  );

  const run = () => {
    setLogs([]);
    setRunning(true);
    postMessage({ type: config.type, fields: values });
  };

  return (
    <div className="w-full rounded-md border bg-muted/30 p-3">
      <div className="mb-2 text-sm font-medium">{config.title}</div>
      <div className="flex flex-col gap-2">
        {config.fields.map((f) => (
          <div key={f.key} className="flex flex-col gap-1">
            <Label htmlFor={`${config.type}-${f.key}`} className="text-xs">
              {f.label}
            </Label>
            <Input
              id={`${config.type}-${f.key}`}
              value={values[f.key] ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <Button onClick={run} disabled={running} variant="secondary" className="mt-3">
        <TerminalIcon />
        {running ? `Testing ${config.title}...` : `Test ${config.title}`}
      </Button>
      <div className="mt-3 font-mono text-xs whitespace-pre-wrap break-words flex flex-col gap-1">
        {logs.length === 0 ? (
          <span className="text-muted-foreground">Click Test {config.title} to stream logs here.</span>
        ) : (
          logs.map((line, index) => (
            <div
              key={`${line.text}-${index}`}
              className={line.level === "error" ? "text-destructive" : "text-foreground"}
            >
              {line.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

interface InteractiveCliConfig {
  start: (fields: TestFields) => WebviewToExtension;
  send: (prompt: string) => WebviewToExtension;
  dispose: () => WebviewToExtension;
  log: "codexInteractiveLog" | "agyInteractiveLog";
  title: string;
}

const INTERACTIVE_CLIS: InteractiveCliConfig[] = [
  {
    start: (fields) => ({ type: "testCodexInteractiveStart", fields }),
    send: (prompt) => ({ type: "testCodexInteractiveSend", prompt }),
    dispose: () => ({ type: "testCodexInteractiveDispose" }),
    log: "codexInteractiveLog",
    title: "Codex",
  },
  {
    start: (fields) => ({ type: "testAgyInteractiveStart", fields }),
    send: (prompt) => ({ type: "testAgyInteractiveSend", prompt }),
    dispose: () => ({ type: "testAgyInteractiveDispose" }),
    log: "agyInteractiveLog",
    title: "Agy",
  },
];

function InteractiveForm({ config }: { config: InteractiveCliConfig }) {
  const [values, setValues] = useState<TestFields>({ workerId: "webview" });
  const [prompt, setPrompt] = useState("Reply by writing the outbox JSON with status paused and summary ok.");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);

  useEffect(
    () =>
      onMessage((msg) => {
        if (isLog(msg) && msg.type === config.log) {
          setLogs((current) => [...current, { level: msg.level, text: msg.text }]);
          if (msg.text === "disposed" || msg.level === "error") {
            setRunning(false);
          }
        }
      }),
    [config.log]
  );

  const start = () => {
    setLogs([]);
    setRunning(true);
    postMessage(config.start(values));
  };

  const send = () => postMessage(config.send(prompt));

  const dispose = () => {
    setRunning(false);
    postMessage(config.dispose());
  };

  return (
    <div className="w-full rounded-md border bg-muted/30 p-3">
      <div className="mb-2 text-sm font-medium">{config.title} Interactive</div>
      <div className="flex flex-col gap-2">
        {INTERACTIVE_FIELDS.map((f) => (
          <div key={f.key} className="flex flex-col gap-1">
            <Label htmlFor={`${config.log}-${f.key}`} className="text-xs">
              {f.label}
            </Label>
            <Input
              id={`${config.log}-${f.key}`}
              value={values[f.key] ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            />
          </div>
        ))}
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${config.log}-prompt`} className="text-xs">
            Turn prompt
          </Label>
          <Input
            id={`${config.log}-prompt`}
            value={prompt}
            placeholder="Turn prompt"
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={start} disabled={running} variant="secondary">
          <TerminalIcon />
          {running ? "Interactive Running..." : "Start Interactive"}
        </Button>
        <Button onClick={send} disabled={!running} variant="secondary">
          Send Turn
        </Button>
        <Button onClick={dispose} disabled={!running} variant="secondary">
          Dispose
        </Button>
      </div>
      <div className="mt-3 font-mono text-xs whitespace-pre-wrap break-words flex flex-col gap-1">
        {logs.length === 0 ? (
          <span className="text-muted-foreground">Click Start Interactive to stream logs here.</span>
        ) : (
          logs.map((line, index) => (
            <div
              key={`${line.text}-${index}`}
              className={line.level === "error" ? "text-destructive" : "text-foreground"}
            >
              {line.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function HelloView() {
  const [reply, setReply] = useState("");

  useEffect(
    () =>
      onMessage((msg) => {
        if (msg.type === "greeting") {
          setReply(msg.text);
        }
      }),
    []
  );

  return (
    <div className="p-4 flex max-w-3xl flex-col gap-4 items-start">
      <h1 className="text-lg font-semibold">Skynet Webview</h1>
      <Button onClick={() => postMessage({ type: "hello", name: "Skynet" })}>
        Say hello to the extension
      </Button>
      {reply && <p>{reply}</p>}
      {CLIS.map((config) => (
        <CliForm key={config.type} config={config} />
      ))}
      {INTERACTIVE_CLIS.map((config) => (
        <InteractiveForm key={config.log} config={config} />
      ))}
    </div>
  );
}
```

- [ ] **Step 8: Run tests to verify they pass, then typecheck**

Run: `npm test`
Expected: PASS — all suites green, including the updated `webview-bridge-interactive.test.ts`.

Run: `npm run check-types`
Expected: PASS — no type errors (each `InteractiveCliConfig.start`/`send`/`dispose` factory returns a single-literal-`type` object, so it's directly assignable to `WebviewToExtension` without a cast).

- [ ] **Step 9: Manual smoke check**

Run the extension (`F5` / Extension Development Host), open the Skynet webview, scroll to the new **Agy Interactive** form, fill in `workerId`, click **Start Interactive**, confirm a log line appears (`Starting Agy interactive session...`), type a turn prompt, click **Send Turn**, confirm a `paused:`/`done:` line appears, click **Dispose**, confirm the button resets and a `disposed` line appears. Repeat for the existing Codex Interactive form to confirm it still works unchanged.

- [ ] **Step 10: Commit**

```bash
git add src/webview/protocol.ts src/adapters/webview-bridge.ts src/webview/panel.ts src/integration/hello.tsx src/test/webview-bridge-interactive.test.ts
git commit -m "feat: generalize webview interactive bridge for multi-CLI + agy smoke button"
```

---

## Self-review

**Spec coverage:** every NEEDS-RESEARCH row in the skeleton spec is resolved and cited (probe launch argv/instruction file/submit key/session strategy in Global Constraints and Task 2; the spec's "likely degraded mode" is exactly what `harvest() => {}` + the `sessionInfoPrompt` fallback delivers). The frame's "Optional SessionInfoProbe" architecture component → Task 1 (the one piece of shared core codex didn't need). Per-CLI profile → Task 2. Integration seam → Task 3. Real-CLI acceptance gate → Task 4. Manual smoke-test UI (requested) → Task 5, generalized rather than duplicated so future CLIs (claude) reuse the same bridge functions and `INTERACTIVE_CLIS` pattern.

**Out of scope, confirmed not planned here:** multi-worker fleet/scheduler, claude interactive profile (its own skeleton spec), automated crash/timeout recovery via `agy resume`-equivalent (no such mechanism verified — collapses to "surface the status" like codex), Windows PID polling, usage/token harvesting for agy (spec explicitly expects none) — all inherited from the frame's Out-of-scope section.

**Placeholder scan:** no TBD/TODO markers; every step has real code, an exact command, or an exact file anchor for the insertion point.

**Type consistency:** `agyInteractive: InteractiveCliProfile` (Task 2) matches the existing interface exactly (same field names/signatures as `codexInteractive`). `probeSessionInfo`'s `HarvestResult` return type (Task 1) matches the type already defined in `src/adapters/interactive/types.ts` — no redefinition. `StartInteractiveDeps.sessionInfoTimeoutMs` is defined once (Task 1) and consumed identically in its own module and its tests. `InteractiveLogType` (Task 5) is defined once in `webview-bridge.ts` and its two string literals (`"codexInteractiveLog"|"agyInteractiveLog"`) match the `ExtensionToWebview` variants added in the same task.

---

Plan complete and saved to `docs/superpowers/plans/2026-07-01-interactive-agy.md`. Two options:

1. **Refine** — get an independent review pass (gaps, ambiguity, User Story slicing) before execution
2. **Execute** — go straight to execution

Which would you like?
