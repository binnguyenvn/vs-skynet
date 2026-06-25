import type { ExtensionToWebview, WebviewToExtension } from "../protocol";

interface VsCodeApi {
  postMessage(msg: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

export function postMessage(msg: WebviewToExtension): void {
  vscode.postMessage(msg);
}

export function onMessage(handler: (msg: ExtensionToWebview) => void): () => void {
  const listener = (e: MessageEvent) => handler(e.data as ExtensionToWebview);
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
