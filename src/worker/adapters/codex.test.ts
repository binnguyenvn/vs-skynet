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
      "-c",
      "model_reasoning_summary=auto",
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

  test("requests reasoning summaries so reasoning items are emitted", () => {
    const inv = codexAdapter.buildInvocation(sampleWorker(), "t", {});
    const i = inv.args.indexOf("-c");
    assert.ok(i >= 0 && inv.args[i + 1] === "model_reasoning_summary=auto", "expected -c model_reasoning_summary=auto");
  });

  test("appends --add-dir for each writable root", () => {
    const w = sampleWorker();
    w.harness.writableRoots = ["/extra/one", "/extra/two"];
    const inv = codexAdapter.buildInvocation(w, "t", {});
    const flags = inv.args.filter((_, i) => inv.args[i - 1] === "--add-dir");
    assert.deepStrictEqual(flags, ["/extra/one", "/extra/two"]);
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
      { type: "usage", inputTokens: 1, cachedInputTokens: undefined, outputTokens: undefined },
      { type: "done", lastMessage: "PONG" },
    ]);
  });

  test("maps command_execution item.started to a tool-call", async () => {
    const line =
      "{\"type\":\"item.started\",\"item\":{\"id\":\"item_0\",\"type\":\"command_execution\",\"command\":\"/bin/zsh -lc 'cat note.txt'\",\"status\":\"in_progress\"}}\n";
    const events = await collect(codexAdapter.parseEvents(streamOf(line)));
    assert.deepStrictEqual(events, [
      { type: "tool-call", id: "item_0", name: "shell", detail: "/bin/zsh -lc 'cat note.txt'" },
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
      codexAdapter.parseEvents(streamOf('{"type":"turn.completed"}')),
    );
    assert.deepStrictEqual(events, [{ type: "done", lastMessage: undefined }]);
  });

  test("surfaces unknown item types as a log", async () => {
    const events = await collect(
      codexAdapter.parseEvents(
        streamOf('{"type":"item.completed","item":{"type":"web_search","query":"x"}}\n'),
      ),
    );
    assert.deepStrictEqual(events, [{ type: "log", level: "info", text: "web_search" }]);
  });

  test("maps an error event with the transport flag unset", async () => {
    const events = await collect(
      codexAdapter.parseEvents(streamOf('{"type":"error","message":"boom"}\n')),
    );
    assert.deepStrictEqual(events, [{ type: "error", message: "boom", transport: false }]);
  });

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

  test("does not emit a usage event when usage is empty", async () => {
    const events = await collect(codexAdapter.parseEvents(streamOf('{"type":"turn.completed","usage":{}}\n')));
    assert.deepStrictEqual(events, [{ type: "done", lastMessage: undefined }]);
  });

  test("maps an item.completed error to an error event", async () => {
    const line =
      '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Falling back from WebSockets to HTTPS transport."}}\n';
    const events = await collect(codexAdapter.parseEvents(streamOf(line)));
    assert.deepStrictEqual(events, [
      { type: "error", message: "Falling back from WebSockets to HTTPS transport.", transport: false },
    ]);
  });
});
