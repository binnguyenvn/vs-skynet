import { runClaude, type ClaudeRun, type RunOpts } from "./claude-adapter";
import type { ClaudeEvent } from "./events";
import type { ExtensionToWebview } from "../../webview/protocol";

interface LogWebview {
  postMessage(msg: ExtensionToWebview): boolean | PromiseLike<boolean>;
}

type ClaudeRunner = (opts: RunOpts) => ClaudeRun;

async function postLog(webview: LogWebview, level: "info" | "error", text: string): Promise<void> {
  await webview.postMessage({ type: "claudeLog", level, text });
}

function formatEvent(ev: ClaudeEvent): string | null {
  switch (ev.kind) {
    case "started":
      return `started session ${ev.sessionId} (${ev.model})`;
    case "message":
      return ev.text;
    case "thinking":
      return `thinking: ${ev.text}`;
    case "tool_call":
      return `tool ${ev.name}`;
    case "usage": {
      const cost = ev.costUsd === undefined ? "" : ` cost=$${ev.costUsd}`;
      return `usage in=${ev.inputTokens} out=${ev.outputTokens} cacheW=${ev.cacheCreationInputTokens} cacheR=${ev.cacheReadInputTokens}${cost}`;
    }
    case "unknown":
      return null;
  }
}

export async function streamClaudeTestToWebview(
  webview: LogWebview,
  cwd: string,
  runner: ClaudeRunner = runClaude
): Promise<void> {
  await postLog(webview, "info", "Starting Claude test...");

  const run = runner({
    prompt: "Reply with exactly the word: pong",
    cwd,
  });

  try {
    for await (const ev of run) {
      const text = formatEvent(ev);
      if (text) {
        await postLog(webview, "info", text);
      }
    }

    const result = await run.result;
    if (result.status === "success") {
      await postLog(webview, "info", "done success");
    } else {
      await postLog(webview, "error", `done ${result.status}: ${result.reason ?? "unknown error"}`);
    }
  } catch (err) {
    await postLog(webview, "error", err instanceof Error ? err.message : String(err));
  }
}
