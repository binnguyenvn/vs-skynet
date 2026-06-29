import * as assert from "assert";
import { classifyError } from "../adapters/claude/classify";

suite("classifyError (claude)", () => {
  test("429 rate limit -> limit", () =>
    assert.strictEqual(classifyError("Error: 429 rate limit exceeded"), "limit"));
  test("quota -> limit", () =>
    assert.strictEqual(classifyError("You have exceeded your quota"), "limit"));
  test("ECONNRESET -> transport", () =>
    assert.strictEqual(classifyError("ECONNRESET while connecting"), "transport"));
  test("timeout -> transport", () =>
    assert.strictEqual(classifyError("request timeout"), "transport"));
  test("not logged in -> terminal", () =>
    assert.strictEqual(classifyError("Not logged in · Please run /login"), "terminal"));
  test("empty -> terminal", () =>
    assert.strictEqual(classifyError(""), "terminal"));
});
