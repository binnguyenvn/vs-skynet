import * as assert from "assert";
import { streamCodexTestToWebview } from "../adapters/codex/webview-bridge";
import type { CodexEvent, CodexResult } from "../adapters/codex/events";
import type { ExtensionToWebview } from "../webview/protocol";

suite("streamCodexTestToWebview", () => {
  test("posts codex events and final result as webview log messages", async () => {
    const posted: ExtensionToWebview[] = [];
    const events: CodexEvent[] = [
      { kind: "started", threadId: "abc" },
      { kind: "message", text: "pong" },
      {
        kind: "usage",
        inputTokens: 1,
        cachedInputTokens: 0,
        outputTokens: 2,
        reasoningOutputTokens: 0,
      },
    ];
    const result: CodexResult = { status: "success", lastMessage: "pong" };

    await streamCodexTestToWebview(
      {
        postMessage: (msg) => {
          posted.push(msg);
          return true;
        },
      },
      "/tmp",
      () => ({
        cancel() {},
        result: Promise.resolve(result),
        async *[Symbol.asyncIterator]() {
          yield* events;
        },
      })
    );

    assert.deepStrictEqual(posted, [
      { type: "codexLog", level: "info", text: "Starting Codex test..." },
      { type: "codexLog", level: "info", text: "started thread abc" },
      { type: "codexLog", level: "info", text: "pong" },
      { type: "codexLog", level: "info", text: "usage input=1 cached=0 output=2 reasoning=0" },
      { type: "codexLog", level: "info", text: "done success" },
    ]);
  });
});
