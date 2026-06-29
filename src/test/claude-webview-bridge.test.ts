import * as assert from "assert";
import { streamClaudeTestToWebview } from "../adapters/claude/webview-bridge";
import type { ClaudeEvent, ClaudeResult } from "../adapters/claude/events";
import type { ExtensionToWebview } from "../webview/protocol";

suite("streamClaudeTestToWebview", () => {
  test("posts claude events and final result as webview log messages", async () => {
    const posted: ExtensionToWebview[] = [];
    const events: ClaudeEvent[] = [
      { kind: "started", sessionId: "s1", model: "claude-x" },
      { kind: "thinking", text: "hmm" },
      { kind: "tool_call", name: "Bash", input: { cmd: "ls" } },
      { kind: "message", text: "pong" },
      { kind: "usage", inputTokens: 10, outputTokens: 2, cacheCreationInputTokens: 0, cacheReadInputTokens: 5, costUsd: 0.01 },
    ];
    const result: ClaudeResult = { status: "success", lastMessage: "pong" };

    await streamClaudeTestToWebview(
      {
        postMessage: (msg) => {
          posted.push(msg);
          return true;
        },
      },
      "/tmp",
      {},
      () => ({
        cancel() {},
        result: Promise.resolve(result),
        async *[Symbol.asyncIterator]() {
          yield* events;
        },
      })
    );

    assert.deepStrictEqual(posted, [
      { type: "claudeLog", level: "info", text: "Starting Claude test..." },
      { type: "claudeLog", level: "info", text: "started session s1 (claude-x)" },
      { type: "claudeLog", level: "info", text: "thinking: hmm" },
      { type: "claudeLog", level: "info", text: "tool Bash" },
      { type: "claudeLog", level: "info", text: "pong" },
      { type: "claudeLog", level: "info", text: "usage in=10 out=2 cacheW=0 cacheR=5 cost=$0.01" },
      { type: "claudeLog", level: "info", text: "done success" },
    ]);
  });
});
