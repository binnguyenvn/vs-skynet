import * as assert from "assert";
import * as os from "os";
import { runCodex } from "../adapters/codex/codex-adapter";
import type { CodexEvent } from "../adapters/codex/events";

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
