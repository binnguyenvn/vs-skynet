import * as assert from "assert";
import { mapCodexLine } from "../adapters/codex/events";

suite("mapCodexLine", () => {
  test("thread.started -> started", () => {
    assert.deepStrictEqual(
      mapCodexLine('{"type":"thread.started","thread_id":"abc"}'),
      { kind: "started", threadId: "abc" });
  });

  test("agent_message item -> message", () => {
    assert.deepStrictEqual(
      mapCodexLine('{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"pong"}}'),
      { kind: "message", text: "pong" });
  });

  test("turn.completed -> usage", () => {
    assert.deepStrictEqual(
      mapCodexLine('{"type":"turn.completed","usage":{"input_tokens":12,"cached_input_tokens":9,"output_tokens":5,"reasoning_output_tokens":0}}'),
      { kind: "usage", inputTokens: 12, cachedInputTokens: 9, outputTokens: 5, reasoningOutputTokens: 0 });
  });

  test("blank line -> null", () => assert.strictEqual(mapCodexLine("  "), null));

  test("non-JSON stdin notice -> null", () =>
    assert.strictEqual(mapCodexLine("Reading additional input from stdin..."), null));

  test("unknown type -> unknown{raw}", () => {
    assert.deepStrictEqual(mapCodexLine('{"type":"turn.started"}'),
      { kind: "unknown", raw: { type: "turn.started" } });
  });
});
