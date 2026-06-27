// Domain model for a Worker = Agent + Harness + Soul. Node-free so the webview
// can import these types without pulling in child_process.

export type Company = "openai" | "anthropic" | "google" | "openrouter" | "nvidia";
export type Protocol = "cli" | "http";
export type AuthMethod = "apiKey" | "oauth2Pkce" | "oauth2" | "deviceCode";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type ModelTier = "fast" | "balanced" | "deep";

export interface SubProtocol {
  authMethod: AuthMethod;
  endpointUrl?: string; // http only; cli resolves its own endpoint
}

export interface Agent {
  company: Company;
  protocol: Protocol;
  subProtocol: SubProtocol;
  model?: string; // omit -> CLI uses its configured default (no -m)
  tier?: ModelTier;
  credentialRef?: string; // opaque handle; Epic 1 uses the CLI's existing login
}

export interface Harness {
  sandbox: SandboxMode;
  workingDir: string;
  verification?: { command: string; label?: string }[]; // independent checks run AFTER the agent's done (Epic 2)
  // ponytail: writableRoots/maxSteps/timeoutMs added in US-3 of this epic.
}

export interface Soul {
  role: string;
  identity: string;
  responsibilities: string[];
  methodology?: string;
  requiredTier?: ModelTier;
  // ponytail: present for type stability; Epic 1 ignores soul (no injection yet, Epic 3).
}

export interface Worker {
  id: string;
  agent: Agent;
  harness: Harness;
  soul: Soul;
}
