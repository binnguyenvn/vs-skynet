import type { AuthMethod, Worker } from "../types";
import type { AgentAdapter, Credentials, Invocation, WorkerEvent } from "./types";

export const codexAdapter: AgentAdapter = {
  company: "openai",
  protocol: "cli",

  allowedAuthMethods(): AuthMethod[] {
    return ["oauth2Pkce", "apiKey"];
  },

  buildInvocation(worker: Worker, task: string, creds: Credentials): Invocation {
    const { agent, harness } = worker;
    const args = [
      "exec",
      "--json",
      "-s",
      harness.sandbox,
      "-C",
      harness.workingDir,
      "--skip-git-repo-check",
    ];
    if (agent.model) {
      args.push("-m", agent.model);
    }
    args.push(task);
    return { command: "codex", args, cwd: harness.workingDir, env: creds.env };
  },

  parseEvents(raw: AsyncIterable<Buffer>): AsyncIterable<WorkerEvent> {
    return parseCodexEvents(raw);
  },
};

// Filled in Task 2.
async function* parseCodexEvents(_raw: AsyncIterable<Buffer>): AsyncIterable<WorkerEvent> {
  // placeholder body replaced in Task 2
}
