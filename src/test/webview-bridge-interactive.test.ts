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
