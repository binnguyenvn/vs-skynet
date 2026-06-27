import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { buildWebviewHtml, nonce } from "./html";
import type { WebviewToExtension } from "./protocol";
import { runWorker, type RunHandle } from "../worker/runner";

export function openWebview(
  context: vscode.ExtensionContext,
  viewId: string
): vscode.WebviewPanel {
  const distWebview = vscode.Uri.joinPath(context.extensionUri, "dist", "webview");
  const panel = vscode.window.createWebviewPanel(
    "skynet." + viewId,
    "Skynet",
    vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [distWebview] }
  );

  const webview = panel.webview;
  const scriptUri = webview
    .asWebviewUri(vscode.Uri.joinPath(distWebview, "main.js"))
    .toString();
  const styleUri = webview
    .asWebviewUri(vscode.Uri.joinPath(distWebview, "main.css"))
    .toString();

  webview.html = buildWebviewHtml({
    scriptUri,
    styleUri,
    cspSource: webview.cspSource,
    nonce: nonce(),
    viewId,
  });

  const runs = new Map<string, RunHandle>();

  webview.onDidReceiveMessage(
    (msg: WebviewToExtension) => {
      if (msg.type === "hello") {
        vscode.window.showInformationMessage(`Webview says hello: ${msg.name}`);
        webview.postMessage({ type: "greeting", text: `Hello back, ${msg.name}!` });
      } else if (msg.type === "runTask") {
        const workerId = msg.worker.id;
        // Expand a leading ~ and ensure the dir exists — e2e workdirs like
        // ~/.temp/<id> won't exist yet, and codex's cwd/-C would ENOENT.
        const dir = expandHome(msg.worker.harness.workingDir);
        msg.worker.harness.workingDir = dir;
        if (dir) {
          fs.mkdirSync(dir, { recursive: true });
        }
        runs.get(workerId)?.cancel();
        const handle = runWorker(msg.worker, msg.task, (event) => {
          webview.postMessage({ type: "taskEvent", workerId, event });
        });
        runs.set(workerId, handle);
        handle.done.finally(() => {
          if (runs.get(workerId) === handle) {
            runs.delete(workerId);
          }
        });
      } else if (msg.type === "cancelTask") {
        runs.get(msg.workerId)?.cancel();
      }
    },
    undefined,
    context.subscriptions
  );

  panel.onDidDispose(
    () => {
      for (const handle of runs.values()) {
        handle.cancel();
      }
      runs.clear();
    },
    undefined,
    context.subscriptions
  );

  return panel;
}

function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/") ? path.join(os.homedir(), p.slice(1)) : p;
}
