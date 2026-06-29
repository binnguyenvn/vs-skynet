import { useEffect, useState } from "react";
import { TerminalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { onMessage, postMessage } from "@/lib/vscode";

interface LogLine {
  level: "info" | "error";
  text: string;
}

export function HelloView() {
  const [reply, setReply] = useState("");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);

  useEffect(
    () =>
      onMessage((msg) => {
        if (msg.type === "greeting") {
          setReply(msg.text);
        }
        if (msg.type === "codexLog") {
          setLogs((current) => [...current, { level: msg.level, text: msg.text }]);
          if (msg.level === "error" || msg.text.startsWith("done ")) {
            setRunning(false);
          }
        }
      }),
    []
  );

  const testCodex = () => {
    setReply("");
    setLogs([]);
    setRunning(true);
    postMessage({ type: "testCodex" });
  };

  return (
    <div className="p-4 flex max-w-3xl flex-col gap-4 items-start">
      <h1 className="text-lg font-semibold">Skynet Webview</h1>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => postMessage({ type: "hello", name: "Skynet" })}>
          Say hello to the extension
        </Button>
        <Button onClick={testCodex} disabled={running} variant="secondary">
          <TerminalIcon />
          {running ? "Testing Codex..." : "Test Codex"}
        </Button>
      </div>
      {reply && <p>{reply}</p>}
      <div className="w-full rounded-md border bg-muted/30 p-3 font-mono text-xs">
        <div className="mb-2 font-sans text-sm font-medium">Codex log</div>
        <div className="flex min-h-32 flex-col gap-1 whitespace-pre-wrap break-words">
          {logs.length === 0 ? (
            <span className="text-muted-foreground">Click Test Codex to stream logs here.</span>
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
    </div>
  );
}
