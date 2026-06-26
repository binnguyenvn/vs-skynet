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
