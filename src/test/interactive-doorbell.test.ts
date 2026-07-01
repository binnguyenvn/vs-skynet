import * as assert from "assert";
import { ring } from "../adapters/interactive/doorbell";
import { FakeTerminalTransport } from "./helpers/fake-terminal-transport";

suite("ring (doorbell)", () => {
  test("shows the terminal, sends the ping as plain text, then sends the submit sequence", async () => {
    const transport = new FakeTerminalTransport();
    await ring(transport, "Read .skynet/w1/inbox/turn-1.md and follow it.", "\t");
    assert.deepStrictEqual(transport.calls, [
      { method: "show", args: [false] },
      { method: "sendText", args: ["Read .skynet/w1/inbox/turn-1.md and follow it.", false] },
      { method: "sendSequence", args: ["\t"] },
    ]);
  });
});
