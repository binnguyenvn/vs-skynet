import * as assert from "assert";
import { classifyError } from "../adapters/agy/classify";

suite("classifyError (agy)", () => {
  test("429 rate limit -> limit", () =>
    assert.strictEqual(classifyError("Error: 429 rate limit exceeded"), "limit"));
  test("quota -> limit", () =>
    assert.strictEqual(classifyError("You have exceeded your quota"), "limit"));
  test("ECONNRESET -> transport", () =>
    assert.strictEqual(classifyError("ECONNRESET while connecting"), "transport"));
  test("timeout -> transport", () =>
    assert.strictEqual(classifyError("request timeout"), "transport"));
  test("other -> terminal", () =>
    assert.strictEqual(classifyError("invalid prompt syntax"), "terminal"));
  test("empty -> terminal", () =>
    assert.strictEqual(classifyError(""), "terminal"));
});
