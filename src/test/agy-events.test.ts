import * as assert from "assert";
import { mapAgyLine } from "../adapters/agy/events";

suite("mapAgyLine", () => {
  test("plain text line -> message", () => {
    assert.deepStrictEqual(mapAgyLine("pong"), { kind: "message", text: "pong" });
  });

  test("plain text line is trimmed", () => {
    assert.deepStrictEqual(mapAgyLine("  hello  "), { kind: "message", text: "hello" });
  });

  test("blank line -> null", () => assert.strictEqual(mapAgyLine("   "), null));

  // Forward-compat stub branches (dormant until the SDK sidecar emits JSONL):
  test("JSON thread.started -> started", () => {
    assert.deepStrictEqual(
      mapAgyLine('{"type":"thread.started","thread_id":"abc"}'),
      { kind: "started", threadId: "abc" });
  });

  test("JSON tool_call -> tool_call", () => {
    assert.deepStrictEqual(
      mapAgyLine('{"type":"tool_call","name":"run_command","args":{"cmd":"ls"}}'),
      { kind: "tool_call", name: "run_command", args: { cmd: "ls" } });
  });

  test("JSON thought -> thought", () => {
    assert.deepStrictEqual(
      mapAgyLine('{"type":"thought","text":"hmm"}'),
      { kind: "thought", text: "hmm" });
  });

  test("JSON usage -> usage", () => {
    assert.deepStrictEqual(
      mapAgyLine('{"type":"usage","input_tokens":12,"output_tokens":5}'),
      { kind: "usage", inputTokens: 12, outputTokens: 5 });
  });

  test("unknown JSON type -> unknown{raw}", () => {
    assert.deepStrictEqual(
      mapAgyLine('{"type":"weird"}'),
      { kind: "unknown", raw: { type: "weird" } });
  });
});
