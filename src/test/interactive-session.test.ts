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
  test("turn cycle: paused then done, with harvested usage and sessionId events", async () => {
    const cwd = await mkTmpRepo();
    const transport = new FakeTerminalTransport();
    const session = await startInteractive(
      fakeProfile({
        sessionDir: () => cwd,
        harvest: () => ({ sessionId: "sess-1", usage: { inputTokens: 10, outputTokens: 5 } }),
      }),
      { cwd, workerId: "w1", readyTimeoutMs: 2_000, turnTimeoutMs: 2_000 },
      { terminalFactory: { create: () => transport }, launchDelayMs: 0, mailboxPollMs: 20 }
    );

    writeOutboxSoon(cwd, "w1", 1, { status: "paused", summary: "step 1 complete" });
    assert.deepStrictEqual(await session.send("turn 1"), { status: "paused", summary: "step 1 complete" });

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

  test("times out when no outbox appears, retrying the readiness ping once on turn 1", async () => {
    const cwd = await mkTmpRepo();
    const transport = new FakeTerminalTransport();
    const session = await startInteractive(
      fakeProfile(),
      { cwd, workerId: "w3", readyTimeoutMs: 150, turnTimeoutMs: 150 },
      { terminalFactory: { create: () => transport }, launchDelayMs: 0, mailboxPollMs: 20 }
    );
    assert.deepStrictEqual(await session.send("turn 1"), { status: "timeout" });
    assert.strictEqual(transport.calls.filter((c) => c.method === "sendSequence").length, 2);
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
    assert.deepStrictEqual(await session.send("turn 1"), { status: "crashed" });
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
    assert.deepStrictEqual(await session.send("turn 1"), { status: "crashed" });
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
    assert.deepStrictEqual(await session.send("turn 1"), {
      status: "error",
      reason: "hit a 429 rate limit",
      errorClass: "limit",
    });
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
