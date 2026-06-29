import * as assert from "assert";
import { streamAdapterTestToWebview } from "../adapters/webview-bridge";
import type { AgentAdapter, WorkerEvent, WorkerResult } from "../adapters/types";
import type { ExtensionToWebview } from "../webview/protocol";

function fakeAdapter(id: AgentAdapter["id"], events: WorkerEvent[], result: WorkerResult): AgentAdapter {
  return {
    id,
    run: () => ({
      cancel() {},
      result: Promise.resolve(result),
      async *[Symbol.asyncIterator]() {
        yield* events;
      },
    }),
  };
}

suite("streamAdapterTestToWebview", () => {
  test("posts normalized events + result as <id>Log messages", async () => {
    const posted: ExtensionToWebview[] = [];
    const events: WorkerEvent[] = [
      { kind: "started", sessionId: "s1", model: "claude-x" },
      { kind: "thinking", text: "hmm" },
      { kind: "tool_call", name: "Bash", input: { cmd: "ls" } },
      { kind: "message", text: "pong" },
      { kind: "usage", inputTokens: 10, outputTokens: 2, cachedInputTokens: 5, cacheWriteTokens: 0, costUsd: 0.01 },
    ];
    const adapter = fakeAdapter("claude", events, { status: "success", lastMessage: "pong" });

    await streamAdapterTestToWebview(adapter, { postMessage: (m) => (posted.push(m), true) }, "/tmp");

    assert.deepStrictEqual(posted, [
      { type: "claudeLog", level: "info", text: "Starting Claude test..." },
      { type: "claudeLog", level: "info", text: "started session s1 (claude-x)" },
      { type: "claudeLog", level: "info", text: "thinking: hmm" },
      { type: "claudeLog", level: "info", text: "tool Bash" },
      { type: "claudeLog", level: "info", text: "pong" },
      { type: "claudeLog", level: "info", text: "usage in=10 out=2 cached=5 cacheW=0 cost=$0.01" },
      { type: "claudeLog", level: "info", text: "done success" },
    ]);
  });

  test("started without model omits the parenthetical; channel matches id", async () => {
    const posted: ExtensionToWebview[] = [];
    const adapter = fakeAdapter("codex", [{ kind: "started", sessionId: "abc" }], { status: "success" });

    await streamAdapterTestToWebview(adapter, { postMessage: (m) => (posted.push(m), true) }, "/tmp");

    assert.deepStrictEqual(posted, [
      { type: "codexLog", level: "info", text: "Starting Codex test..." },
      { type: "codexLog", level: "info", text: "started session abc" },
      { type: "codexLog", level: "info", text: "done success" },
    ]);
  });

  test("failure posts an error line", async () => {
    const posted: ExtensionToWebview[] = [];
    const adapter = fakeAdapter("agy", [], { status: "failed", reason: "boom" });

    await streamAdapterTestToWebview(adapter, { postMessage: (m) => (posted.push(m), true) }, "/tmp");

    assert.deepStrictEqual(posted, [
      { type: "agyLog", level: "info", text: "Starting Agy test..." },
      { type: "agyLog", level: "error", text: "done failed: boom" },
    ]);
  });
});
