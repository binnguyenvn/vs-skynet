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

suite("runWorker", () => {
  test("streams normalized events from the process stdout", async () => {
    const events: WorkerEvent[] = [];
    const { proc } = fakeProcess(
      [
        '{"type":"thread.started","thread_id":"t1"}\n',
        '{"type":"item.completed","item":{"type":"agent_message","text":"PONG"}}\n',
        '{"type":"turn.completed"}\n',
      ],
      { code: 0 },
    );
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
    const handle = runWorker(worker(), "t", (e) => events.push(e), { spawnFn: () => proc, now: () => NOW });
    await handle.done;
    assert.deepStrictEqual(events, [
      { type: "error", message: "codex exited with code 2", transport: false, terminal: true, ts: NOW },
    ]);
  });

  test("passes adapter stream errors through as non-terminal (no terminal flag)", async () => {
    const events: WorkerEvent[] = [];
    // A bare Codex `error` envelope (e.g. a transient "Reconnecting..." diagnostic)
    // followed by a clean turn. The diagnostic must NOT carry terminal — only `done` ends the run.
    const { proc } = fakeProcess(
      ['{"type":"error","message":"Reconnecting... 2/5 (request timed out)"}\n', '{"type":"turn.completed"}\n'],
      { code: 0 },
    );
    const handle = runWorker(worker(), "t", (e) => events.push(e), { spawnFn: () => proc, now: () => NOW });
    await handle.done;
    assert.deepStrictEqual(events, [
      { type: "error", message: "Reconnecting... 2/5 (request timed out)", transport: false, ts: NOW },
      { type: "done", lastMessage: undefined, ts: NOW },
    ]);
  });

  test("maxSteps: 0 kills on the first tool call", async () => {
    const events: WorkerEvent[] = [];
    const w = worker();
    w.harness.maxSteps = 0;
    const { proc, wasKilled } = fakeProcess(
      [
        '{"type":"item.started","item":{"id":"a","type":"command_execution","command":"echo 1"}}\n',
        '{"type":"turn.completed"}\n',
      ],
      { code: null },
    );
    const handle = runWorker(w, "t", (e) => events.push(e), { spawnFn: () => proc, now: () => NOW });
    await handle.done;
    assert.strictEqual(wasKilled(), true);
    const err = events.find((e) => e.type === "error") as { message: string; terminal?: boolean } | undefined;
    assert.strictEqual(err?.message, "step cap (0) exceeded");
    assert.strictEqual(err?.terminal, true);
    assert.ok(!events.some((e) => e.type === "done"), "no done after a cap kill");
  });

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
    // ponytail: omit "usage" so turn.completed only emits done (usage:{} emits a usage event too)
    const { proc } = fakeProcess(['{"type":"turn.completed"}\n'], { code: 0 });
    const handle = runWorker(worker(), "t", (e) => events.push(e), { spawnFn: () => proc, now: () => NOW });
    await handle.done;
    assert.deepStrictEqual(events, [{ type: "done", lastMessage: undefined, ts: NOW }]);
  });

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

  test("clean run with a generous timeout emits done, not timeout error", async () => {
    // Guards the timer-race fix: disarming the timer before await proc.exit must
    // prevent a spurious "timeout exceeded" error on a normal completion.
    const events: WorkerEvent[] = [];
    const w = worker();
    w.harness.timeoutMs = 10_000; // generous — the run completes in <1ms
    const { proc } = fakeProcess(
      ['{"type":"item.completed","item":{"type":"agent_message","text":"hi"}}\n', '{"type":"turn.completed"}\n'],
      { code: 0 },
    );
    const handle = runWorker(w, "t", (e) => events.push(e), { spawnFn: () => proc, now: () => NOW });
    await handle.done;
    assert.ok(events.some((e) => e.type === "done"), "expected done event");
    assert.ok(!events.some((e) => e.type === "error"), "must not emit any error");
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
