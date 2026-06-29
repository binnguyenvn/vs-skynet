import * as vscode from "vscode";
import { streamCodexTestToWebview } from "../adapters/codex/webview-bridge";
import { buildWebviewHtml, nonce } from "./html";
import type { WebviewToExtension } from "./protocol";

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

  webview.onDidReceiveMessage(
    (msg: WebviewToExtension) => {
      if (msg.type === "hello") {
        vscode.window.showInformationMessage(`Webview says hello: ${msg.name}`);
        webview.postMessage({ type: "greeting", text: `Hello back, ${msg.name}!` });
      }
      if (msg.type === "testCodex") {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? context.extensionUri.fsPath;
        void streamCodexTestToWebview(webview, cwd);
      }
    },
    undefined,
    context.subscriptions
  );

  return panel;
}
