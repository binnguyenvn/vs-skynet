import * as os from "node:os";
import * as path from "node:path";
import type { InteractiveCliProfile } from "../interactive/types";

// Verified by src/test/terminal-probe.test.ts's agy-ultra profile:
// no --print for interactive TUI, GEMINI.md instructions, "\r" submits.
export const agyInteractive: InteractiveCliProfile = {
  id: "agy",
  launchArgv: (o) => [
    "--dangerously-skip-permissions",
    "--new-project",
    ...(o.model ? ["--model", o.model] : []),
    "--add-dir",
    o.cwd,
    // ponytail: --sandbox omitted until an interactive mapping is verified.
  ],
  configEnv: (dir): Record<string, string> => (dir ? { HOME: dir } : {}),
  instructionFile: "GEMINI.md",
  submitSequence: "\r",
  sessionDir: (dir) => path.join(dir ?? os.homedir(), ".gemini"),
  harvest: () => ({}),
  sessionInfoPrompt: (file) =>
    `thông tin session này; ghi kết quả vào ${file} dạng JSON hợp lệ với các field ` +
    '{"conversationId":"...","model":"...","workspace":"...","artifactDirectory":"..."}; ' +
    "conversationId phải là Conversation ID đầy đủ nếu có; artifactDirectory phải là Artifact Directory đầy đủ nếu có; chỉ ghi file JSON.",
};
