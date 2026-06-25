# React Webview Skeleton — Design

**Date:** 2026-06-25
**Status:** Approved

## Goal

Establish a unified React-based foundation for the many webviews this extension
will host, so every panel shares the same theme, build, and message plumbing.
Styling stays in sync with the user's VSCode theme automatically.

## Decisions

- **Build tool:** Reuse the existing esbuild setup — add a *second* esbuild
  context for the webview. No Vite. (DX tradeoff accepted: no HMR; edit UI →
  reload webview.)
- **Tailwind v4:** Compiled via `@tailwindcss/cli` as a separate watch process,
  not bridged into esbuild. Avoids a postcss/esbuild plugin.
- **Bundle structure:** One shared React app. Each panel is opened with a
  `viewId`; the app renders the matching component via an internal `switch`.
  Adding a webview = add a component + a case. Maximum shared infra.
- **Components:** shadcn/ui, with its theme tokens remapped to VSCode CSS
  variables so panels track the active theme (light/dark/high-contrast).

## Architecture

### Build

| Source | Output | Target |
|--------|--------|--------|
| `src/extension.ts` | `dist/extension.js` | node / cjs (unchanged) |
| `src/webview/index.tsx` | `dist/webview/main.js` | browser / iife |
| `src/webview/styles.css` | `dist/webview/main.css` | Tailwind CLI |

`esbuild.js` gains a second `esbuild.context()` for the webview entry. The
webview build is browser-platform, IIFE format, externalizes nothing.
`@tailwindcss/cli` runs as its own `watch:css` / build script. All watch
scripts run in parallel via the existing `npm-run-all` (`watch:*`).

### Extension side — `src/webview/panel.ts`

`openWebview(context, viewId)`:
- Creates a `WebviewPanel` (retainContextWhenHidden as needed).
- Builds the HTML shell with a strict **CSP + per-load nonce**.
- Injects `main.js` and `main.css` via `webview.asWebviewUri`.
- Passes `viewId` into the page as initial state (serialized into the HTML).
- Wires `onDidReceiveMessage` to a handler.

This helper is the single unification point — every webview is opened through it.

### Webview side — `src/webview/`

- `index.tsx` — reads `viewId` from injected state, renders the matching view
  (internal `switch`), mounts React root.
- `lib/vscode.ts` — typed message bus wrapping `acquireVsCodeApi()`:
  `postMessage(msg)` and `onMessage(handler)`.
- `styles.css` — `@import "tailwindcss"` plus a `:root` block mapping ~10
  shadcn tokens to `var(--vscode-*)`. Dark/light/high-contrast is driven by the
  `vscode-dark` / `vscode-light` / `vscode-high-contrast` class VSCode sets on
  `<body>` — no separate theme toggle.
- `components/ui/button.tsx` — one shadcn component, as the pattern sample.
- `views/hello.tsx` — demo view: a shadcn Button that posts a message to the
  extension, which replies / shows an info message (round-trip both directions).

### Shared protocol — `src/webview/protocol.ts`

Typed message shapes imported by BOTH the extension and the webview, so the
postMessage contract is checked at compile time in both directions.

### Demo command

`skynet-harness.openWebview` opens the `hello` view through `openWebview()`.
The existing `helloWorld` command stays.

## Theme mapping (the glue)

In `styles.css`, map shadcn tokens to VSCode vars and drop shadcn's `hsl()`
wrapper (Tailwind v4 / shadcn already use full-color tokens, so it's ~1:1):

```css
:root {
  --background: var(--vscode-editor-background);
  --foreground: var(--vscode-foreground);
  --primary: var(--vscode-button-background);
  --primary-foreground: var(--vscode-button-foreground);
  --border: var(--vscode-panel-border);
  --input: var(--vscode-input-background);
  --ring: var(--vscode-focusBorder);
  --muted: var(--vscode-editorWidget-background);
  --destructive: var(--vscode-errorForeground);
  --radius: 4px;
}
```

Font: `--vscode-font-family`, `--vscode-font-size`. Only the ~10 tokens actually
used are mapped.

## Testing / verification

- `protocol.ts` holds the message types; a small test asserts the message shape.
- Webview render is not unit-tested (no clean harness) — verified by running the
  extension (F5) and exercising the round-trip in the demo view.

## Out of scope (YAGNI)

- Routing library — one `switch` is enough.
- State-management library — not needed yet.
- More shadcn components — added when a view needs them.
- Vite / HMR — revisit only if webview iteration becomes painful.
