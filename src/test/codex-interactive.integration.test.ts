import * as assert from "assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { codexAdapter } from "../adapters/codex/codex-adapter";

const describe = process.env.CODEX_INTERACTIVE_E2E ? suite : suite.skip;

describe("codex interactive mode (real CLI, slow - set CODEX_INTERACTIVE_E2E=1)", function () {
  this.timeout(240_000);

  test("drives a real codex TUI through pause and done via the production adapter", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "codex-interactive-e2e-"));
    const stateFile = path.join(cwd, "flow-state.txt");
    const session = await codexAdapter.runInteractive!({
      cwd,
      workerId: "e2e",
      ...(process.env.CODEX_HOME ? { configDir: process.env.CODEX_HOME } : {}),
    });

    try {
      const first = await session.send(
        [
          "Turn 1 of 2.",
          "Write flow-state.txt containing exactly `step-1` followed by one newline.",
          'Then write the outbox JSON for this turn with exactly: {"status":"paused","summary":"step 1 complete"}',
          "Stop after the outbox file exists.",
        ].join("\n")
      );
      assert.strictEqual(first.status, "paused");
      assert.strictEqual(await fs.readFile(stateFile, "utf8"), "step-1\n");

      const second = await session.send(
        [
          "Turn 2 of 2.",
          "Append exactly `step-2` followed by one newline to flow-state.txt.",
          'Then write the outbox JSON for this turn with exactly: {"status":"done","summary":"flow complete","filesTouched":["flow-state.txt"]}',
          "Stop after the outbox file exists.",
        ].join("\n")
      );
      assert.strictEqual(second.status, "done");
      assert.strictEqual(await fs.readFile(stateFile, "utf8"), "step-1\nstep-2\n");

      assert.match(await session.sessionId ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    } finally {
      await session.dispose();
      const remainingAgents = await fs.readFile(path.join(cwd, "AGENTS.md"), "utf8").catch(() => "");
      assert.ok(!remainingAgents.includes("skynet-interactive"));
    }
  });
});
