import * as assert from "assert";
import { parseCodexRollout } from "../adapters/codex/interactive-profile";

const SESSION_META_LINE = JSON.stringify({
  type: "session_meta",
  payload: {
    session_id: "019f1953-71c9-7c41-b8fb-c841283efe1e",
    id: "019f1953-71c9-7c41-b8fb-c841283efe1e",
  },
});

const TOKEN_COUNT_LINE = JSON.stringify({
  type: "event_msg",
  payload: {
    type: "token_count",
    info: {
      total_token_usage: {
        input_tokens: 16660,
        cached_input_tokens: 9088,
        output_tokens: 69,
        reasoning_output_tokens: 53,
        total_tokens: 16729,
      },
    },
    rate_limits: { limit_id: "codex", plan_type: "plus" },
  },
});

const LATER_TOKEN_COUNT_LINE = JSON.stringify({
  type: "event_msg",
  payload: {
    type: "token_count",
    info: {
      total_token_usage: {
        input_tokens: 20000,
        cached_input_tokens: 9088,
        output_tokens: 120,
        reasoning_output_tokens: 60,
        total_tokens: 20180,
      },
    },
    rate_limits: { limit_id: "codex", plan_type: "plus" },
  },
});

suite("parseCodexRollout", () => {
  test("extracts sessionId, cumulative usage, and rate limits", () => {
    const result = parseCodexRollout([SESSION_META_LINE, TOKEN_COUNT_LINE].join("\n"));
    assert.strictEqual(result.sessionId, "019f1953-71c9-7c41-b8fb-c841283efe1e");
    assert.deepStrictEqual(result.usage, {
      inputTokens: 16660,
      outputTokens: 69,
      cachedInputTokens: 9088,
      reasoningTokens: 53,
    });
    assert.ok(result.rateLimits);
  });

  test("keeps the latest cumulative usage when multiple token_count lines are present", () => {
    const result = parseCodexRollout([SESSION_META_LINE, TOKEN_COUNT_LINE, LATER_TOKEN_COUNT_LINE].join("\n"));
    assert.strictEqual(result.usage?.inputTokens, 20000);
    assert.strictEqual(result.usage?.outputTokens, 120);
  });

  test("ignores blank lines and non-JSON noise", () => {
    const result = parseCodexRollout(["", "  ", "not json", SESSION_META_LINE].join("\n"));
    assert.strictEqual(result.sessionId, "019f1953-71c9-7c41-b8fb-c841283efe1e");
  });

  test("returns an empty result for text with no recognized lines", () => {
    assert.deepStrictEqual(parseCodexRollout(""), { sessionId: undefined, usage: undefined, rateLimits: undefined });
  });
});
