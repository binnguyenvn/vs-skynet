import * as assert from "assert";
import { codexAdapter } from "./codex";
import type { WorkerEvent } from "./types";
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
      "{\"type\":\"item.started\",\"item\":{\"id\":\"item_0\",\"type\":\"command_execution\",\"command\":\"/bin/zsh -lc 'cat note.txt'\",\"status\":\"in_progress\"}}\n";
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
        streamOf('{"type":"item.completed","item":{"type":"reasoning","text":"..."}}\n'),
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
