import * as vscode from "vscode";
import { agyAdapter } from "../adapters/agy/agy-adapter";
import { claudeAdapter } from "../adapters/claude/claude-adapter";
import { codexAdapter } from "../adapters/codex/codex-adapter";
import { sendInteractiveTurn, startInteractiveTestToWebview, streamAdapterTestToWebview } from "../adapters/webview-bridge";
import { buildWebviewHtml, nonce } from "./html";
import type { TestFields, WebviewToExtension } from "./protocol";
import type { InteractiveSession } from "../adapters/interactive/types";

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

  let codexInteractiveSession: InteractiveSession | undefined;
  let agyInteractiveSession: InteractiveSession | undefined;

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
        void streamAdapterTestToWebview(codexAdapter, webview, cwd(), clean(msg.fields));
      }
      if (msg.type === "testAgy") {
        void streamAdapterTestToWebview(agyAdapter, webview, cwd(), clean(msg.fields));
      }
      if (msg.type === "testClaude") {
        void streamAdapterTestToWebview(claudeAdapter, webview, cwd(), clean(msg.fields));
      }
      if (msg.type === "testCodexInteractiveStart") {
        const fields = clean(msg.fields);
        void (async () => {
          codexInteractiveSession = await startInteractiveTestToWebview(codexAdapter, webview, {
            cwd: cwd(),
            workerId: fields.workerId || "webview",
            model: fields.model,
            configDir: fields.configDir,
          });
        })();
      }
      if (msg.type === "testCodexInteractiveSend") {
        void sendInteractiveTurn(codexInteractiveSession, webview, msg.prompt, "codexInteractiveLog");
      }
      if (msg.type === "testCodexInteractiveDispose") {
        const session = codexInteractiveSession;
        codexInteractiveSession = undefined;
        void session?.dispose();
        void webview.postMessage({ type: "codexInteractiveLog", level: "info", text: "disposed" });
      }
      if (msg.type === "testAgyInteractiveStart") {
        const fields = clean(msg.fields);
        void (async () => {
          agyInteractiveSession = await startInteractiveTestToWebview(agyAdapter, webview, {
            cwd: cwd(),
            workerId: fields.workerId || "webview",
            model: fields.model,
            configDir: fields.configDir,
          });
        })();
      }
      if (msg.type === "testAgyInteractiveSend") {
        void sendInteractiveTurn(agyInteractiveSession, webview, msg.prompt, "agyInteractiveLog");
      }
      if (msg.type === "testAgyInteractiveDispose") {
        const session = agyInteractiveSession;
        agyInteractiveSession = undefined;
        void session?.dispose();
        void webview.postMessage({ type: "agyInteractiveLog", level: "info", text: "disposed" });
      }
    },
    undefined,
    context.subscriptions
  );

  return panel;
}
