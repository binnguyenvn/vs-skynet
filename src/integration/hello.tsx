import { useEffect, useState } from "react";
import { TerminalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { onMessage, postMessage } from "@/lib/vscode";
import type { ExtensionToWebview, TestFields, WebviewToExtension } from "@/protocol";

interface LogLine {
  level: "info" | "error";
  text: string;
}

type LogMsg = Extract<ExtensionToWebview, { level: "info" | "error" }>;
const isLog = (msg: ExtensionToWebview): msg is LogMsg => msg.type !== "greeting";

interface FieldDef {
  key: keyof TestFields;
  label: string;
  placeholder: string;
}

// prompt/model/configDir apply to all three CLIs; oauthToken is claude-only.
const COMMON_FIELDS: FieldDef[] = [
  { key: "prompt", label: "Prompt", placeholder: "Reply with exactly the word: pong" },
  { key: "model", label: "Model", placeholder: "(adapter default)" },
  { key: "configDir", label: "configDir", placeholder: "isolate account, e.g. ~/.agents/cc-thai" },
];

const INTERACTIVE_FIELDS: FieldDef[] = [
  { key: "workerId", label: "workerId", placeholder: "webview" },
  { key: "model", label: "Model", placeholder: "(adapter default)" },
  { key: "configDir", label: "configDir", placeholder: "isolate account, e.g. ~/.agents/codex-plus" },
];

type TestMsg = Extract<WebviewToExtension, { fields?: TestFields }>;

interface CliConfig {
  type: TestMsg["type"];
  log: LogMsg["type"];
  title: string;
  fields: FieldDef[];
}

const CLIS: CliConfig[] = [
  { type: "testCodex", log: "codexLog", title: "Codex", fields: COMMON_FIELDS },
  { type: "testAgy", log: "agyLog", title: "Agy", fields: COMMON_FIELDS },
  {
    type: "testClaude",
    log: "claudeLog",
    title: "Claude",
    fields: [
      ...COMMON_FIELDS,
      { key: "oauthToken", label: "oauthToken", placeholder: "CLAUDE_CODE_OAUTH_TOKEN" },
    ],
  },
];

function CliForm({ config }: { config: CliConfig }) {
  const [values, setValues] = useState<TestFields>({});
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);

  useEffect(
    () =>
      onMessage((msg) => {
        if (isLog(msg) && msg.type === config.log) {
          setLogs((current) => [...current, { level: msg.level, text: msg.text }]);
          if (msg.level === "error" || msg.text.startsWith("done ")) {
            setRunning(false);
          }
        }
      }),
    [config.log]
  );

  const run = () => {
    setLogs([]);
    setRunning(true);
    postMessage({ type: config.type, fields: values });
  };

  return (
    <div className="w-full rounded-md border bg-muted/30 p-3">
      <div className="mb-2 text-sm font-medium">{config.title}</div>
      <div className="flex flex-col gap-2">
        {config.fields.map((f) => (
          <div key={f.key} className="flex flex-col gap-1">
            <Label htmlFor={`${config.type}-${f.key}`} className="text-xs">
              {f.label}
            </Label>
            <Input
              id={`${config.type}-${f.key}`}
              value={values[f.key] ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <Button onClick={run} disabled={running} variant="secondary" className="mt-3">
        <TerminalIcon />
        {running ? `Testing ${config.title}...` : `Test ${config.title}`}
      </Button>
      <div className="mt-3 font-mono text-xs whitespace-pre-wrap break-words flex flex-col gap-1">
        {logs.length === 0 ? (
          <span className="text-muted-foreground">Click Test {config.title} to stream logs here.</span>
        ) : (
          logs.map((line, index) => (
            <div
              key={`${line.text}-${index}`}
              className={line.level === "error" ? "text-destructive" : "text-foreground"}
            >
              {line.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function CodexInteractiveForm() {
  const [values, setValues] = useState<TestFields>({ workerId: "webview" });
  const [prompt, setPrompt] = useState("Reply by writing the outbox JSON with status paused and summary ok.");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);

  useEffect(
    () =>
      onMessage((msg) => {
        if (isLog(msg) && msg.type === "codexInteractiveLog") {
          setLogs((current) => [...current, { level: msg.level, text: msg.text }]);
          if (msg.text === "disposed" || msg.level === "error") {
            setRunning(false);
          }
        }
      }),
    []
  );

  const start = () => {
    setLogs([]);
    setRunning(true);
    postMessage({ type: "testCodexInteractiveStart", fields: values });
  };

  const send = () => postMessage({ type: "testCodexInteractiveSend", prompt });

  const dispose = () => {
    setRunning(false);
    postMessage({ type: "testCodexInteractiveDispose" });
  };

  return (
    <div className="w-full rounded-md border bg-muted/30 p-3">
      <div className="mb-2 text-sm font-medium">Codex Interactive</div>
      <div className="flex flex-col gap-2">
        {INTERACTIVE_FIELDS.map((f) => (
          <div key={f.key} className="flex flex-col gap-1">
            <Label htmlFor={`codex-interactive-${f.key}`} className="text-xs">
              {f.label}
            </Label>
            <Input
              id={`codex-interactive-${f.key}`}
              value={values[f.key] ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            />
          </div>
        ))}
        <div className="flex flex-col gap-1">
          <Label htmlFor="codex-interactive-prompt" className="text-xs">
            Turn prompt
          </Label>
          <Input
            id="codex-interactive-prompt"
            value={prompt}
            placeholder="Turn prompt"
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={start} disabled={running} variant="secondary">
          <TerminalIcon />
          {running ? "Interactive Running..." : "Start Interactive"}
        </Button>
        <Button onClick={send} disabled={!running} variant="secondary">
          Send Turn
        </Button>
        <Button onClick={dispose} disabled={!running} variant="secondary">
          Dispose
        </Button>
      </div>
      <div className="mt-3 font-mono text-xs whitespace-pre-wrap break-words flex flex-col gap-1">
        {logs.length === 0 ? (
          <span className="text-muted-foreground">Click Start Interactive to stream logs here.</span>
        ) : (
          logs.map((line, index) => (
            <div
              key={`${line.text}-${index}`}
              className={line.level === "error" ? "text-destructive" : "text-foreground"}
            >
              {line.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function HelloView() {
  const [reply, setReply] = useState("");

  useEffect(
    () =>
      onMessage((msg) => {
        if (msg.type === "greeting") {
          setReply(msg.text);
        }
      }),
    []
  );

  return (
    <div className="p-4 flex max-w-3xl flex-col gap-4 items-start">
      <h1 className="text-lg font-semibold">Skynet Webview</h1>
      <Button onClick={() => postMessage({ type: "hello", name: "Skynet" })}>
        Say hello to the extension
      </Button>
      {reply && <p>{reply}</p>}
      {CLIS.map((config) => (
        <CliForm key={config.type} config={config} />
      ))}
      <CodexInteractiveForm />
    </div>
  );
}
