import * as assert from "assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { probeSessionInfo } from "../adapters/interactive/session-info-probe";
import { FakeTerminalTransport } from "./helpers/fake-terminal-transport";

async function mkTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "session-info-probe-test-"));
}

function writeFileSoon(file: string, content: string, delayMs = 20): void {
  setTimeout(() => {
    void fs.mkdir(path.dirname(file), { recursive: true }).then(() => fs.writeFile(file, content));
  }, delayMs);
}

suite("probeSessionInfo", () => {
  test("rings the doorbell with the built prompt, then resolves sessionId once the file appears", async () => {
    const dir = await mkTmpDir();
    const transport = new FakeTerminalTransport();
    const outboxFile = path.join(dir, "outbox", "session-info.json");
    writeFileSoon(outboxFile, JSON.stringify({ conversationId: "abc-123", model: "gemini-3" }));

    const result = await probeSessionInfo(transport, dir, (file) => `write session info to ${file}`, "\r", 2_000);

    assert.deepStrictEqual(result, { sessionId: "abc-123" });
    assert.deepStrictEqual(transport.calls, [
      { method: "show", args: [false] },
      { method: "sendText", args: [`write session info to ${outboxFile}`, false] },
      { method: "sendSequence", args: ["\r"] },
    ]);
  });

  test("returns {} when the JSON has no conversationId", async () => {
    const dir = await mkTmpDir();
    const transport = new FakeTerminalTransport();
    writeFileSoon(path.join(dir, "outbox", "session-info.json"), JSON.stringify({ model: "gemini-3" }));

    const result = await probeSessionInfo(transport, dir, (file) => file, "\r", 2_000);
    assert.deepStrictEqual(result, {});
  });

  test("retries past a half-written file and resolves once it is valid JSON", async () => {
    const dir = await mkTmpDir();
    const transport = new FakeTerminalTransport();
    const outboxFile = path.join(dir, "outbox", "session-info.json");
    await fs.mkdir(path.dirname(outboxFile), { recursive: true });
    await fs.writeFile(outboxFile, '{"conversationId":"ab');
    setTimeout(() => void fs.writeFile(outboxFile, JSON.stringify({ conversationId: "final-id" })), 100);

    const result = await probeSessionInfo(transport, dir, (file) => file, "\r", 2_000);
    assert.deepStrictEqual(result, { sessionId: "final-id" });
  });

  test("returns {} when the file never appears before the timeout", async () => {
    const dir = await mkTmpDir();
    const transport = new FakeTerminalTransport();
    const result = await probeSessionInfo(transport, dir, (file) => file, "\r", 150);
    assert.deepStrictEqual(result, {});
  });
});
