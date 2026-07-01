import * as assert from "assert";
import * as os from "node:os";
import * as path from "node:path";
import { agyInteractive } from "../adapters/agy/interactive-profile";

suite("agyInteractive profile", () => {
  test("launchArgv matches the probe-verified argv, without --print", () => {
    assert.deepStrictEqual(agyInteractive.launchArgv({ cwd: "/tmp/proj", workerId: "w1" }), [
      "--dangerously-skip-permissions",
      "--new-project",
      "--add-dir",
      "/tmp/proj",
    ]);
  });

  test("launchArgv includes --model only when a model is given", () => {
    const argv = agyInteractive.launchArgv({ cwd: "/tmp/proj", workerId: "w1", model: "gemini-3-pro" });
    assert.strictEqual(argv[argv.indexOf("--model") + 1], "gemini-3-pro");
  });

  test("launchArgv never includes --sandbox (unverified in interactive mode)", () => {
    const argv = agyInteractive.launchArgv({ cwd: "/tmp/proj", workerId: "w1", sandbox: "workspace-write" });
    assert.strictEqual(argv.includes("--sandbox"), false);
  });

  test("configEnv sets HOME only when configDir is given", () => {
    assert.deepStrictEqual(agyInteractive.configEnv("/config/dir"), { HOME: "/config/dir" });
    assert.deepStrictEqual(agyInteractive.configEnv(undefined), {});
  });

  test("sessionDir defaults to ~/.gemini and relocates under configDir", () => {
    assert.strictEqual(agyInteractive.sessionDir(undefined), path.join(os.homedir(), ".gemini"));
    assert.strictEqual(agyInteractive.sessionDir("/config/dir"), path.join("/config/dir", ".gemini"));
  });

  test("harvest always returns {} (no confirmed on-disk transcript)", () => {
    assert.deepStrictEqual(agyInteractive.harvest("anything"), {});
  });

  test("submitSequence and instructionFile match the probe", () => {
    assert.strictEqual(agyInteractive.submitSequence, "\r");
    assert.strictEqual(agyInteractive.instructionFile, "GEMINI.md");
    assert.strictEqual(agyInteractive.id, "agy");
  });

  test("sessionInfoPrompt embeds the given outbox path and asks for conversationId", () => {
    const prompt = agyInteractive.sessionInfoPrompt!("/tmp/proj/.skynet/w1/outbox/session-info.json");
    assert.ok(prompt.includes("/tmp/proj/.skynet/w1/outbox/session-info.json"));
    assert.ok(prompt.includes("conversationId"));
  });
});
