import { useEffect, useState } from "react";
import { PlayIcon, SquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { onMessage, postMessage } from "@/lib/vscode";
import type { SandboxMode, Worker } from "../../worker/types";
import type { WorkerEvent } from "../../worker/adapters/types";

const WORKER_ID = "worker-1";
const SANDBOXES: SandboxMode[] = ["read-only", "workspace-write", "danger-full-access"];

export function WorkerView() {
  const [sandbox, setSandbox] = useState<SandboxMode>("read-only");
  const [workingDir, setWorkingDir] = useState("");
  const [model, setModel] = useState("");
  const [task, setTask] = useState("");
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<string[]>([]);

  useEffect(
    () =>
      onMessage((msg) => {
        if (msg.type === "taskEvent" && msg.workerId === WORKER_ID) {
          setLines((prev) => [...prev, formatEvent(msg.event)]);
          if (msg.event.type === "done" || msg.event.type === "error") {
            setRunning(false);
          }
        }
      }),
    []
  );

  function run() {
    const worker: Worker = {
      id: WORKER_ID,
      agent: {
        company: "openai",
        protocol: "cli",
        subProtocol: { authMethod: "oauth2Pkce" },
        model: model.trim() || undefined,
      },
      harness: { sandbox, workingDir: workingDir.trim() },
      // ponytail: Epic 1 has no soul behavior; a placeholder keeps the type valid.
      soul: { role: "developer", identity: "", responsibilities: [] },
    };
    setLines([]);
    setRunning(true);
    postMessage({ type: "runTask", worker, task });
  }

  function cancel() {
    postMessage({ type: "cancelTask", workerId: WORKER_ID });
    setRunning(false);
  }

  return (
    <div className="p-4 flex flex-col gap-4 max-w-2xl mx-auto">
      <h1 className="text-lg font-semibold">Worker - Codex</h1>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Sandbox</Label>
          <Select value={sandbox} onValueChange={(v) => setSandbox(v as SandboxMode)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SANDBOXES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="worker-model">Model (optional)</Label>
          <Input
            id="worker-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="default"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="worker-dir">Working directory</Label>
        <Input
          id="worker-dir"
          value={workingDir}
          onChange={(e) => setWorkingDir(e.target.value)}
          placeholder="/absolute/path"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="worker-task">Task</Label>
        <Textarea
          id="worker-task"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          rows={3}
          placeholder="Describe the task..."
        />
      </div>

      <div className="flex gap-2">
        <Button onClick={run} disabled={running || !task.trim() || !workingDir.trim()}>
          <PlayIcon />
          Run
        </Button>
        <Button variant="outline" onClick={cancel} disabled={!running}>
          <SquareIcon />
          Cancel
        </Button>
      </div>

      <ScrollArea className="h-72 rounded-md border bg-card p-3">
        <pre className="text-xs whitespace-pre-wrap">
          {lines.length ? lines.join("\n") : "Output will stream here."}
        </pre>
      </ScrollArea>
    </div>
  );
}

function formatEvent(e: WorkerEvent): string {
  switch (e.type) {
    case "started":
      return "started";
    case "agent-message":
      return e.text;
    case "tool-call":
      return `tool: ${e.name}${e.detail ? ": " + e.detail : ""}`;
    case "log":
      return e.text;
    case "decision-request":
      return `question: ${e.questions.map((q) => q.question).join(" | ")}`;
    case "done":
      return "done";
    case "error":
      return `error: ${e.message}`;
  }
}
