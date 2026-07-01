import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ring } from "./doorbell";
import type { HarvestResult, TerminalTransport } from "./types";

const DEFAULT_TIMEOUT_MS = 90_000;
const POLL_MS = 500;

interface SessionInfoJson {
  conversationId?: unknown;
}

export async function probeSessionInfo(
  transport: TerminalTransport,
  mailboxDir: string,
  buildPrompt: (outboxPath: string) => string,
  submitSequence: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<HarvestResult> {
  const file = path.join(mailboxDir, "outbox", "session-info.json");
  await ring(transport, buildPrompt(file), submitSequence);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const data = JSON.parse(await fs.readFile(file, "utf8")) as SessionInfoJson;
      return data.conversationId ? { sessionId: String(data.conversationId) } : {};
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && !(err instanceof SyntaxError)) {
        throw err;
      }
    }
    await delay(Math.min(POLL_MS, Math.max(0, deadline - Date.now())));
  }
  return {};
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
