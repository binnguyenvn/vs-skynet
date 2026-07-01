import * as assert from "assert";
import { agyAdapter } from "../adapters/agy/agy-adapter";

suite("agyAdapter.runInteractive wiring", () => {
  test("is exposed as a function", () => {
    assert.strictEqual(typeof agyAdapter.runInteractive, "function");
  });
});
