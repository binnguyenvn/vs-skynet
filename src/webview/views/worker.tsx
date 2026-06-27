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
  const [events, setEvents] = useState<WorkerEvent[]>([]);

  useEffect(
    () =>
      onMessage((msg) => {
        if (msg.type === "taskEvent" && msg.workerId === WORKER_ID) {
          setEvents((prev) => [...prev, msg.event]);
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
    setEvents([]);
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
        {events.length ? (
          <div className="flex flex-col gap-1 text-xs">
            {events.map((e, i) => (
              <EventRow key={i} event={e} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Output will stream here.</p>
        )}
      </ScrollArea>
    </div>
  );
}

function EventRow({ event: e }: { event: WorkerEvent }) {
  switch (e.type) {
    case "started":
      return <div className="text-muted-foreground">● started</div>;
    case "reasoning":
      return <div className="text-muted-foreground italic whitespace-pre-wrap">{e.text}</div>;
    case "agent-message":
      return <div className="whitespace-pre-wrap">{e.text}</div>;
    case "tool-call":
      return <div className="font-mono">▶ {e.name}{e.detail ? `: ${e.detail}` : ""}</div>;
    case "tool-result":
      return (
        <div className="font-mono">
          <span className={e.ok ? "text-green-500" : "text-red-500"}>{e.ok ? "✓" : "✗"}</span>{" "}
          exit {e.exitCode ?? "?"}
          {e.output ? <pre className="whitespace-pre-wrap opacity-80">{e.output}</pre> : null}
        </div>
      );
    case "file-change":
      return <div className="font-mono">✎ {e.kind} {e.path}</div>;
    case "usage":
      return (
        <div className="text-muted-foreground">
          tokens — in {e.inputTokens ?? 0} (cached {e.cachedInputTokens ?? 0}) · out {e.outputTokens ?? 0}
        </div>
      );
    case "log":
      return <div className={e.level === "error" ? "text-red-500" : "text-muted-foreground"}>{e.text}</div>;
    case "verification":
      return (
        <div className="font-mono">
          <span className={e.ok ? "text-green-500" : "text-red-500"}>{e.ok ? "✓" : "✗"}</span>{" "}
          verify: {e.command}
          {e.output ? <pre className="whitespace-pre-wrap opacity-80">{e.output}</pre> : null}
        </div>
      );
    case "decision-request":
      return <div>question: {e.questions.map((q) => q.question).join(" | ")}</div>;
    case "done":
      return <div className="text-green-500">● done</div>;
    case "error":
      return <div className="text-red-500">error: {e.message}</div>;
  }
}
