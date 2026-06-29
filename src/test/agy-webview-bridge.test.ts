import * as assert from "assert";
import { streamAgyTestToWebview } from "../adapters/agy/webview-bridge";
import type { AgyEvent, AgyResult } from "../adapters/agy/events";
import type { ExtensionToWebview } from "../webview/protocol";

suite("streamAgyTestToWebview", () => {
  test("posts agy events and final result as webview log messages", async () => {
    const posted: ExtensionToWebview[] = [];
    const events: AgyEvent[] = [
      { kind: "started", threadId: "abc" },
      { kind: "message", text: "pong" },
      { kind: "tool_call", name: "run_command", args: { cmd: "ls" } },
    ];
    const result: AgyResult = { status: "success", lastMessage: "pong" };

    await streamAgyTestToWebview(
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
      { type: "agyLog", level: "info", text: "Starting Antigravity test..." },
      { type: "agyLog", level: "info", text: "started thread abc" },
      { type: "agyLog", level: "info", text: "pong" },
      { type: "agyLog", level: "info", text: "tool run_command" },
      { type: "agyLog", level: "info", text: "done success" },
    ]);
  });
});
