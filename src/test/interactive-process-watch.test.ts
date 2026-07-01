import * as assert from "assert";
import { spawn, type ChildProcess } from "node:child_process";
import { hasLiveDescendant } from "../adapters/interactive/process-watch";

suite("hasLiveDescendant", () => {
  test("finds a live descendant by command name, then stops finding it once it exits", async function () {
    this.timeout(10_000);
    const child: ChildProcess = spawn("sleep", ["5"]);
    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.strictEqual(await hasLiveDescendant(process.pid, "sleep"), true);

    child.kill();
    await new Promise((resolve) => setTimeout(resolve, 500));

    assert.strictEqual(await hasLiveDescendant(process.pid, "sleep"), false);
  });

  test("returns false for a pid with no matching descendants", async () => {
    assert.strictEqual(await hasLiveDescendant(process.pid, "definitely-not-a-real-process-name"), false);
  });
});
