import * as assert from "assert";
import * as fs from "node:fs/promises";
import * as os from "os";
import * as path from "node:path";
import { runAgy } from "../adapters/agy/agy-adapter";
import type { AgyEvent } from "../adapters/agy/events";

async function withFakeAgy(script: string, fn: () => Promise<void>): Promise<void> {
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), "fake-agy-"));
  const agyPath = path.join(binDir, "agy");
  await fs.writeFile(agyPath, script);
  await fs.chmod(agyPath, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${oldPath ?? ""}`;
  try {
    await fn();
  } finally {
    process.env.PATH = oldPath;
    await fs.rm(binDir, { recursive: true, force: true });
  }
}

suite("agy adapter (fake CLI)", () => {
  test("exit 0 with text -> success, message streamed, lastMessage accumulated", async () => {
    await withFakeAgy("#!/bin/sh\nprintf '%s\\n' 'pong'\nexit 0\n", async () => {
      const run = runAgy({ prompt: "ignored", cwd: os.tmpdir() });
      const events: AgyEvent[] = [];
      for await (const ev of run) {
        events.push(ev);
      }
      const result = await run.result;
      assert.strictEqual(result.status, "success");
      assert.ok(events.some((e) => e.kind === "message"), "a message event streamed");
      assert.ok((result.lastMessage ?? "").includes("pong"), "lastMessage has pong");
      assert.strictEqual(result.usage, undefined, "no usage from --print");
    });
  });

  test("exit 1 with rate-limit stderr -> failed + errorClass limit", async () => {
    await withFakeAgy("#!/bin/sh\necho '429 rate limit' 1>&2\nexit 1\n", async () => {
      const run = runAgy({ prompt: "ignored", cwd: os.tmpdir() });
      for await (const _ of run) {
        // drain
      }
      const result = await run.result;
      assert.strictEqual(result.status, "failed");
      assert.strictEqual(result.errorClass, "limit");
    });
  });

  test("passes prompt as the --print value before flags", async () => {
    await withFakeAgy("#!/bin/sh\nprintf '%s\\n' \"$1|$2|$3\"\n", async () => {
      const run = runAgy({ prompt: "hello", cwd: os.tmpdir() });
      const events: AgyEvent[] = [];
      for await (const ev of run) {
        events.push(ev);
      }
      assert.deepStrictEqual(events[0], {
        kind: "message",
        text: "--print|hello|--dangerously-skip-permissions",
      });
    });
  });
});

const describe = process.env.AGY_E2E ? suite : suite.skip;

describe("agy adapter (real CLI, slow — set AGY_E2E=1)", function () {
  this.timeout(120_000);

  test("happy path: reply pong -> success", async () => {
    const run = runAgy({ prompt: "Reply with exactly the word: pong", cwd: os.tmpdir() });
    const events: AgyEvent[] = [];
    for await (const ev of run) {
      events.push(ev);
    }
    const result = await run.result;
    assert.strictEqual(result.status, "success");
    assert.ok((result.lastMessage ?? "").toLowerCase().includes("pong"), "agent said pong");
    assert.ok(events.some((e) => e.kind === "message"), "a message event streamed");
  });

  test("cancel mid-run -> cancelled", async () => {
    const run = runAgy({
      prompt: "Count slowly from 1 to 200, one number per line.",
      cwd: os.tmpdir(),
    });
    const timer = setTimeout(() => run.cancel(), 5_000);
    try {
      for await (const _ of run) {
        // drain
      }
    } finally {
      clearTimeout(timer);
    }
    const result = await run.result;
    assert.strictEqual(result.status, "cancelled");
  });
});
