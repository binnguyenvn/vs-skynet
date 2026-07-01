import * as assert from "assert";
import { buildLaunchCommand, shellQuote } from "../adapters/interactive/shell";

suite("shellQuote", () => {
  test("wraps a plain value in single quotes", () => {
    assert.strictEqual(shellQuote("workspace-write"), "'workspace-write'");
  });

  test("escapes embedded single quotes", () => {
    assert.strictEqual(shellQuote("it's"), "'it'\\''s'");
  });

  test("wraps a path with spaces", () => {
    assert.strictEqual(shellQuote("/tmp/with space"), "'/tmp/with space'");
  });
});

suite("buildLaunchCommand", () => {
  test("joins the binary name with each quoted argv token", () => {
    assert.strictEqual(
      buildLaunchCommand("codex", ["-C", "/tmp/proj", "-s", "workspace-write"]),
      "codex '-C' '/tmp/proj' '-s' 'workspace-write'"
    );
  });
});
