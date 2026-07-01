import * as assert from "assert";
import * as os from "node:os";
import * as path from "node:path";
import { codexInteractive } from "../adapters/codex/interactive-profile";

suite("codexInteractive profile", () => {
  test("launchArgv matches the probe-verified argv exactly", () => {
    assert.deepStrictEqual(
      codexInteractive.launchArgv({ cwd: "/tmp/proj", workerId: "w1", sandbox: "workspace-write" }),
      [
        "-C",
        "/tmp/proj",
        "-s",
        "workspace-write",
        "-a",
        "never",
        "-c",
        "disable_paste_burst=true",
        "-c",
        'tui.keymap.composer.submit="tab"',
        "-c",
        'tui.keymap.composer.queue="ctrl-q"',
      ]
    );
  });

  test("launchArgv includes -m only when a model is given", () => {
    const argv = codexInteractive.launchArgv({ cwd: "/tmp/proj", workerId: "w1", model: "gpt-5" });
    assert.strictEqual(argv[argv.indexOf("-m") + 1], "gpt-5");
  });

  test("launchArgv defaults sandbox to workspace-write when unset", () => {
    const argv = codexInteractive.launchArgv({ cwd: "/tmp/proj", workerId: "w1" });
    assert.strictEqual(argv[argv.indexOf("-s") + 1], "workspace-write");
  });

  test("configEnv sets CODEX_HOME only when configDir is given", () => {
    assert.deepStrictEqual(codexInteractive.configEnv("/config/dir"), { CODEX_HOME: "/config/dir" });
    assert.deepStrictEqual(codexInteractive.configEnv(undefined), {});
  });

  test("sessionDir defaults to ~/.codex/sessions and relocates under configDir", () => {
    assert.strictEqual(codexInteractive.sessionDir(undefined), path.join(os.homedir(), ".codex", "sessions"));
    assert.strictEqual(codexInteractive.sessionDir("/config/dir"), path.join("/config/dir", "sessions"));
  });

  test("submitSequence and instructionFile match the probe", () => {
    assert.strictEqual(codexInteractive.submitSequence, "\t");
    assert.strictEqual(codexInteractive.instructionFile, "AGENTS.md");
    assert.strictEqual(codexInteractive.id, "codex");
  });
});
