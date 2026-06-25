export function nonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

export function buildWebviewHtml(opts: {
  scriptUri: string;
  styleUri: string;
  cspSource: string;
  nonce: string;
  viewId: string;
}): string {
  const { scriptUri, styleUri, cspSource, nonce, viewId } = opts;
  const state = JSON.stringify({ viewId });
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${cspSource};" />
  <link href="${styleUri}" rel="stylesheet" />
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">window.__INITIAL_STATE__ = ${state};</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
