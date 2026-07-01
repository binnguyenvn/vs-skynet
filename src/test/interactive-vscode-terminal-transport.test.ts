import * as assert from "assert";
import { VscodeTerminalFactory } from "../adapters/interactive/vscode-terminal-transport";

suite("VscodeTerminalTransport", () => {
  test("creates a real terminal, resolves a process id, and disposes cleanly", async function () {
    this.timeout(10_000);
    const factory = new VscodeTerminalFactory();
    const transport = factory.create({ name: "interactive-transport-test", cwd: process.cwd(), env: {} });
    try {
      const pid = await transport.processId();
      assert.strictEqual(typeof pid, "number");
    } finally {
      transport.dispose();
    }
  });
});
