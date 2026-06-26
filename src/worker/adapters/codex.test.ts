import * as assert from "assert";
import { codexAdapter } from "./codex";
import type { Worker } from "../types";

function sampleWorker(overrides: Partial<Worker["agent"]> = {}): Worker {
  return {
    id: "w1",
    agent: {
      company: "openai",
      protocol: "cli",
      subProtocol: { authMethod: "oauth2Pkce" },
      ...overrides,
    },
    harness: { sandbox: "read-only", workingDir: "/tmp/repo" },
    soul: { role: "developer", identity: "", responsibilities: [] },
  };
}

suite("codexAdapter.buildInvocation", () => {
  test("builds codex exec argv with sandbox and working dir", () => {
    const inv = codexAdapter.buildInvocation(sampleWorker(), "do the thing", {});
    assert.strictEqual(inv.command, "codex");
    assert.deepStrictEqual(inv.args, [
      "exec",
      "--json",
      "-s",
      "read-only",
      "-C",
      "/tmp/repo",
      "--skip-git-repo-check",
      "do the thing",
    ]);
    assert.strictEqual(inv.cwd, "/tmp/repo");
  });

  test("includes -m only when a model is set", () => {
    const withModel = codexAdapter.buildInvocation(sampleWorker({ model: "gpt-5" }), "t", {});
    assert.ok(withModel.args.includes("-m"));
    assert.strictEqual(withModel.args[withModel.args.indexOf("-m") + 1], "gpt-5");

    const noModel = codexAdapter.buildInvocation(sampleWorker(), "t", {});
    assert.ok(!noModel.args.includes("-m"));
  });

  test("passes credential env through to the invocation", () => {
    const inv = codexAdapter.buildInvocation(sampleWorker(), "t", { env: { CODEX_HOME: "/x" } });
    assert.deepStrictEqual(inv.env, { CODEX_HOME: "/x" });
  });
});
