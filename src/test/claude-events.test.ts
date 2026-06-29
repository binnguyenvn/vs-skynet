import * as assert from "assert";
import { mapClaudeLine } from "../adapters/claude/events";

suite("mapClaudeLine", () => {
  test("system/init -> [started]", () => {
    assert.deepStrictEqual(
      mapClaudeLine({ type: "system", subtype: "init", session_id: "s1", model: "claude-x" }),
      [{ kind: "started", sessionId: "s1", model: "claude-x" }]
    );
  });

  test("system hook noise -> [unknown]", () => {
    assert.deepStrictEqual(
      mapClaudeLine({ type: "system", subtype: "hook_started", hook_name: "SessionStart" }),
      [{ kind: "unknown", raw: { type: "system", subtype: "hook_started", hook_name: "SessionStart" } }]
    );
  });

  test("assistant fans out: text + thinking + tool_use + usage", () => {
    const obj = {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "pong" },
          { type: "thinking", thinking: "hmm" },
          { type: "tool_use", name: "Bash", input: { cmd: "ls" } },
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 2,
          cache_creation_input_tokens: 1,
          cache_read_input_tokens: 5,
        },
      },
    };
    assert.deepStrictEqual(mapClaudeLine(obj), [
      { kind: "message", text: "pong" },
      { kind: "thinking", text: "hmm" },
      { kind: "tool_call", name: "Bash", input: { cmd: "ls" } },
      { kind: "usage", inputTokens: 10, outputTokens: 2, cacheCreationInputTokens: 1, cacheReadInputTokens: 5 },
    ]);
  });

  test("result with usage -> [usage incl. cost]", () => {
    assert.deepStrictEqual(
      mapClaudeLine({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "pong",
        total_cost_usd: 0.01,
        usage: { input_tokens: 10, output_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 5 },
      }),
      [{ kind: "usage", inputTokens: 10, outputTokens: 2, cacheCreationInputTokens: 0, cacheReadInputTokens: 5, costUsd: 0.01 }]
    );
  });

  test("unknown type -> [unknown{raw}]", () => {
    assert.deepStrictEqual(
      mapClaudeLine({ type: "weird" }),
      [{ kind: "unknown", raw: { type: "weird" } }]
    );
  });

  test("unrecognized content block -> [unknown{raw block}]", () => {
    assert.deepStrictEqual(
      mapClaudeLine({ type: "assistant", message: { content: [{ type: "image", source: {} }] } }),
      [{ kind: "unknown", raw: { type: "image", source: {} } }]
    );
  });
});
