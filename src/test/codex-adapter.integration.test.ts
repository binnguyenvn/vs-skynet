import * as assert from "assert";
import * as fs from "node:fs/promises";
import * as os from "os";
import * as path from "node:path";
import { runCodex } from "../adapters/codex/codex-adapter";
import type { CodexEvent } from "../adapters/codex/events";

suite("codex adapter", () => {
  test("exit 0 without turn.completed fails as incomplete output without terminal classification", async () => {
    const binDir = await fs.mkdtemp(path.join(os.tmpdir(), "fake-codex-"));
    const codexPath = path.join(binDir, "codex");
    await fs.writeFile(
      codexPath,
      "#!/bin/sh\nprintf '%s\\n' '{\"type\":\"thread.started\",\"thread_id\":\"abc\"}'\nexit 0\n"
    );
    await fs.chmod(codexPath, 0o755);

    const oldPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${oldPath ?? ""}`;
    try {
      const run = runCodex({ prompt: "ignored", cwd: os.tmpdir() });
      for await (const _ of run) {
        // drain events
      }
      const result = await run.result;

      assert.strictEqual(result.status, "failed");
      assert.strictEqual(result.reason, "codex exited successfully without turn.completed");
      assert.strictEqual(result.errorClass, undefined);
    } finally {
      process.env.PATH = oldPath;
      await fs.rm(binDir, { recursive: true, force: true });
    }
  });
});

const describe = process.env.CODEX_E2E ? suite : suite.skip;

describe("codex adapter (real CLI, slow - set CODEX_E2E=1)", function () {
  this.timeout(120_000);

  test("happy path: reply pong -> success with usage", async () => {
    const run = runCodex({ prompt: "Reply with exactly the word: pong", cwd: os.tmpdir() });
    const events: CodexEvent[] = [];
    for await (const ev of run) {
      events.push(ev);
    }
    const result = await run.result;
    assert.strictEqual(result.status, "success");
    assert.ok(result.usage, "usage captured");
    assert.ok((result.lastMessage ?? "").toLowerCase().includes("pong"), "agent said pong");
    assert.ok(events.some((e) => e.kind === "message"), "a message event streamed");
  });

  test("cancel mid-run -> cancelled", async () => {
    const run = runCodex({
      prompt: "Count slowly from 1 to 200, one number per line.",
      cwd: os.tmpdir(),
    });
    for await (const ev of run) {
      if (ev.kind === "started") {
        run.cancel();
      }
    }
    const result = await run.result;
    assert.strictEqual(result.status, "cancelled");
  });
});
