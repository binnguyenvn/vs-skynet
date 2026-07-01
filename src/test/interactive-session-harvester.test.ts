import * as assert from "assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { harvestSession } from "../adapters/interactive/session-harvester";
import type { InteractiveCliProfile } from "../adapters/interactive/types";

async function mkTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "session-harvester-test-"));
}

function fakeProfile(sessionDir: string, harvest: (text: string) => { sessionId?: string }): InteractiveCliProfile {
  return {
    id: "codex",
    launchArgv: () => [],
    configEnv: () => ({}),
    instructionFile: "AGENTS.md",
    submitSequence: "\t",
    sessionDir: () => sessionDir,
    harvest,
  };
}

suite("harvestSession", () => {
  test("returns {} when the session dir does not exist", async () => {
    const result = await harvestSession(fakeProfile("/nonexistent/does/not/exist", () => ({})), undefined);
    assert.deepStrictEqual(result, {});
  });

  test("finds the newest file across nested subdirectories and hands content to profile.harvest", async () => {
    const root = await mkTmpDir();
    const nestedDir = path.join(root, "2026", "06", "30");
    await fs.mkdir(nestedDir, { recursive: true });

    const older = path.join(nestedDir, "rollout-old.jsonl");
    const newer = path.join(nestedDir, "rollout-new.jsonl");
    await fs.writeFile(older, "old-content");
    await fs.writeFile(newer, "new-content");

    const oldTime = new Date(Date.now() - 60_000);
    const newTime = new Date();
    await fs.utimes(older, oldTime, oldTime);
    await fs.utimes(newer, newTime, newTime);

    const seenText: string[] = [];
    const result = await harvestSession(
      fakeProfile(root, (text) => {
        seenText.push(text);
        return { sessionId: "found-it" };
      }),
      undefined
    );

    assert.deepStrictEqual(seenText, ["new-content"]);
    assert.deepStrictEqual(result, { sessionId: "found-it" });
  });
});
