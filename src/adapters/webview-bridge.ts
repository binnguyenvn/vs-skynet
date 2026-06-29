import type { AgentAdapter, RunOpts, WorkerEvent } from "./types";
import type { ExtensionToWebview } from "../webview/protocol";

interface LogWebview {
  postMessage(msg: ExtensionToWebview): boolean | PromiseLike<boolean>;
}

const LABELS: Record<AgentAdapter["id"], string> = { codex: "Codex", claude: "Claude", agy: "Agy" };

function formatEvent(ev: WorkerEvent): string | null {
  switch (ev.kind) {
    case "started":
      return `started session ${ev.sessionId}${ev.model ? ` (${ev.model})` : ""}`;
    case "message":
      return ev.text;
    case "thinking":
      return `thinking: ${ev.text}`;
    case "tool_call":
      return `tool ${ev.name}`;
    case "usage": {
      let s = `usage in=${ev.inputTokens} out=${ev.outputTokens}`;
      if (ev.cachedInputTokens !== undefined) {
        s += ` cached=${ev.cachedInputTokens}`;
      }
      if (ev.cacheWriteTokens !== undefined) {
        s += ` cacheW=${ev.cacheWriteTokens}`;
      }
      if (ev.reasoningTokens !== undefined) {
        s += ` reasoning=${ev.reasoningTokens}`;
      }
      if (ev.costUsd !== undefined) {
        s += ` cost=$${ev.costUsd}`;
      }
      return s;
    }
    case "unknown":
      return null;
  }
}

export async function streamAdapterTestToWebview(
  adapter: AgentAdapter,
  webview: LogWebview,
  cwd: string,
  overrides: Partial<RunOpts> = {}
): Promise<void> {
  const logType = `${adapter.id}Log` as "codexLog" | "claudeLog" | "agyLog";
  const post = (level: "info" | "error", text: string) =>
    webview.postMessage({ type: logType, level, text });

  await post("info", `Starting ${LABELS[adapter.id]} test...`);

  const run = adapter.run({ prompt: "Reply with exactly the word: pong", cwd, ...overrides });

  try {
    for await (const ev of run) {
      const text = formatEvent(ev);
      if (text) {
        await post("info", text);
      }
    }

    const result = await run.result;
    if (result.status === "success") {
      await post("info", "done success");
    } else {
      await post("error", `done ${result.status}: ${result.reason ?? "unknown error"}`);
    }
  } catch (err) {
    await post("error", err instanceof Error ? err.message : String(err));
  }
}
