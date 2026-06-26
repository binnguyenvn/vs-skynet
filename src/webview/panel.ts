import * as vscode from "vscode";
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
