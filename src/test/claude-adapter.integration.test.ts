import * as assert from "assert";
import * as fs from "node:fs/promises";
import * as os from "os";
import * as path from "node:path";
import { runClaude } from "../adapters/claude/claude-adapter";
import type { ClaudeEvent } from "../adapters/claude/events";

async function withFakeClaude(script: string, fn: () => Promise<void>): Promise<void> {
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), "fake-claude-"));
  const claudePath = path.join(binDir, "claude");
  await fs.writeFile(claudePath, script);
  await fs.chmod(claudePath, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${oldPath ?? ""}`;
  try {
    await fn();
  } finally {
    process.env.PATH = oldPath;
    await fs.rm(binDir, { recursive: true, force: true });
  }
}

const HAPPY = `#!/bin/sh
printf '%s\\n' '{"type":"system","subtype":"hook_started","hook_name":"SessionStart"}'
printf '%s\\n' '{"type":"system","subtype":"init","session_id":"s1","model":"claude-x"}'
printf '%s\\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"pong"}],"usage":{"input_tokens":10,"output_tokens":2,"cache_creation_input_tokens":0,"cache_read_input_tokens":5}}}'
printf '%s\\n' '{"type":"result","subtype":"success","is_error":false,"result":"pong","total_cost_usd":0.01,"usage":{"input_tokens":10,"output_tokens":2,"cache_creation_input_tokens":0,"cache_read_input_tokens":5}}'
exit 0
`;

const NOT_LOGGED_IN = `#!/bin/sh
printf '%s\\n' '{"type":"system","subtype":"init","session_id":"s1","model":"claude-x"}'
printf '%s\\n' '{"type":"result","subtype":"success","is_error":true,"result":"Not logged in · Please run /login","total_cost_usd":0}'
exit 0
`;

const RATE_LIMITED = `#!/bin/sh
printf '%s\\n' '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"429 rate limit exceeded"}'
exit 1
`;

suite("claude adapter (fake CLI)", () => {
  test("happy: init+text+result -> success, message + started + usage(cost), hook noise skipped", async () => {
    await withFakeClaude(HAPPY, async () => {
      const run = runClaude({ prompt: "ignored", cwd: os.tmpdir() });
      const events: ClaudeEvent[] = [];
      for await (const ev of run) {
        events.push(ev);
      }
      const result = await run.result;
      assert.strictEqual(result.status, "success");
      assert.ok(events.some((e) => e.kind === "started"), "started streamed");
      assert.ok(events.some((e) => e.kind === "message"), "message streamed");
      assert.ok(events.some((e) => e.kind === "unknown"), "hook noise surfaced as unknown");
      assert.strictEqual(result.lastMessage, "pong");
      assert.ok(result.usage && result.usage.costUsd === 0.01, "final usage carries cost");
    });
  });

  test("GOTCHA: exit 0 + subtype success + is_error true -> failed/terminal", async () => {
    await withFakeClaude(NOT_LOGGED_IN, async () => {
      const run = runClaude({ prompt: "ignored", cwd: os.tmpdir() });
      for await (const _ of run) {
        // drain
      }
      const result = await run.result;
      assert.strictEqual(result.status, "failed");
      assert.strictEqual(result.errorClass, "terminal");
      assert.ok((result.reason ?? "").includes("Not logged in"), "reason carries result text");
    });
  });

  test("is_error result with 429 -> failed + errorClass limit", async () => {
    await withFakeClaude(RATE_LIMITED, async () => {
      const run = runClaude({ prompt: "ignored", cwd: os.tmpdir() });
      for await (const _ of run) {
        // drain
      }
      const result = await run.result;
      assert.strictEqual(result.status, "failed");
      assert.strictEqual(result.errorClass, "limit");
    });
  });

  test("passes -p and the prompt before the flags", async () => {
    const script =
      "#!/bin/sh\n" +
      "printf '{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"result\":\"'\"$1 $2\"'\"}\\n'\n" +
      "exit 0\n";
    await withFakeClaude(script, async () => {
      const run = runClaude({ prompt: "hello", cwd: os.tmpdir() });
      for await (const _ of run) {
        // drain
      }
      const result = await run.result;
      assert.strictEqual(result.lastMessage, "-p hello");
    });
  });
});

const describe = process.env.CLAUDE_E2E ? suite : suite.skip;

describe("claude adapter (real CLI, slow — set CLAUDE_E2E=1)", function () {
  this.timeout(120_000);

  test("happy path: reply pong -> success", async () => {
    const run = runClaude({ prompt: "Reply with exactly the word: pong", cwd: os.tmpdir() });
    const events: ClaudeEvent[] = [];
    for await (const ev of run) {
      events.push(ev);
    }
    const result = await run.result;
    assert.strictEqual(result.status, "success");
    assert.ok((result.lastMessage ?? "").toLowerCase().includes("pong"), "agent said pong");
    assert.ok(events.some((e) => e.kind === "message"), "a message event streamed");
    assert.ok(result.usage, "usage present");
  });

  test("cancel mid-run -> cancelled", async () => {
    const run = runClaude({
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
