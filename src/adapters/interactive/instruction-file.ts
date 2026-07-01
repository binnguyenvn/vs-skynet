import * as fs from "node:fs/promises";
import * as path from "node:path";
import { readFileIfExists } from "./fs-helpers";

const BEGIN = "<!-- skynet-interactive:BEGIN -->";
const END = "<!-- skynet-interactive:END -->";

export async function bootstrapInstructionFile(
  cwd: string,
  fileName: string,
  mailboxRelativeDir: string
): Promise<void> {
  const filePath = path.join(cwd, fileName);
  const stripped = stripBlock(await readFileIfExists(filePath));
  const block = `${BEGIN}\n${protocolText(mailboxRelativeDir)}\n${END}`;
  await fs.writeFile(filePath, stripped.length ? `${stripped}\n\n${block}\n` : `${block}\n`);
}

export async function teardownInstructionFile(cwd: string, fileName: string): Promise<void> {
  const filePath = path.join(cwd, fileName);
  const existing = await readFileIfExists(filePath);
  if (!existing) {
    return;
  }
  const stripped = stripBlock(existing);
  if (stripped.length) {
    await fs.writeFile(filePath, `${stripped}\n`);
  } else {
    await fs.rm(filePath, { force: true });
  }
}

function protocolText(mailboxRelativeDir: string): string {
  return [
    `For each ${mailboxRelativeDir}/inbox/turn-N.md I give you: do the work it asks, then write`,
    `${mailboxRelativeDir}/outbox/turn-N.json before you stop, matching the same N:`,
    `- Pausing / need the next instruction -> {"status":"paused","summary":"<what you did>"}`,
    `- Whole task complete -> {"status":"done","summary":"...","filesTouched":["..."]}`,
    `- Unrecoverable error -> {"status":"error","reason":"..."}`,
    "",
    "Never delete inbox files. Write the outbox file in a single operation as the",
    "last action of a turn (write turn-N.json.tmp, then rename to turn-N.json)",
    "so the orchestrator rarely sees a half-written file.",
  ].join("\n");
}

function stripBlock(text: string): string {
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start === -1 || end === -1) {
    return text.trim();
  }
  return (text.slice(0, start) + text.slice(end + END.length)).replace(/\n{3,}/g, "\n\n").trim();
}
