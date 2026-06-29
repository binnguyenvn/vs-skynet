import * as vscode from "vscode";
import { streamAgyTestToWebview } from "../adapters/agy/webview-bridge";
import { streamClaudeTestToWebview } from "../adapters/claude/webview-bridge";
import { streamCodexTestToWebview } from "../adapters/codex/webview-bridge";
import { buildWebviewHtml, nonce } from "./html";
import type { TestFields, WebviewToExtension } from "./protocol";

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
      const cwd = () =>
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? context.extensionUri.fsPath;
      // configDir/model/oauthToken map straight onto RunOpts; prune empty strings
      // so the bridge defaults stay in effect.
      const clean = (f?: TestFields): Partial<TestFields> =>
        Object.fromEntries(Object.entries(f ?? {}).filter(([, v]) => v !== ""));
      if (msg.type === "testCodex") {
        const { oauthToken: _drop, ...opts } = clean(msg.fields);
        void streamCodexTestToWebview(webview, cwd(), opts);
      }
      if (msg.type === "testAgy") {
        const { oauthToken: _drop, ...opts } = clean(msg.fields);
        void streamAgyTestToWebview(webview, cwd(), opts);
      }
      if (msg.type === "testClaude") {
        void streamClaudeTestToWebview(webview, cwd(), clean(msg.fields));
      }
    },
    undefined,
    context.subscriptions
  );

  return panel;
}
