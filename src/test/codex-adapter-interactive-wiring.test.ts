import * as assert from "assert";
import { codexAdapter } from "../adapters/codex/codex-adapter";

suite("codexAdapter.runInteractive wiring", () => {
  test("is exposed as a function", () => {
    assert.strictEqual(typeof codexAdapter.runInteractive, "function");
  });
});
