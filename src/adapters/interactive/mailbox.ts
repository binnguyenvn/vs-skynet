import * as fs from "node:fs/promises";
import * as path from "node:path";
import { readFileIfExists } from "./fs-helpers";

export class Mailbox {
  readonly relativeDir: string;
  readonly dir: string;

  constructor(cwd: string, workerId: string) {
    this.relativeDir = `.skynet/${workerId}`;
    this.dir = path.join(cwd, ".skynet", workerId);
  }

  async ensureDirs(): Promise<void> {
    await fs.mkdir(path.join(this.dir, "inbox"), { recursive: true });
    await fs.mkdir(path.join(this.dir, "outbox"), { recursive: true });
  }

  async ensureGitignored(cwd: string): Promise<void> {
    const gitignorePath = path.join(cwd, ".gitignore");
    const existing = await readFileIfExists(gitignorePath);
    if (existing.split("\n").some((line) => line.trim() === ".skynet/")) {
      return;
    }
    const prefix = existing.length && !existing.endsWith("\n") ? `${existing}\n` : existing;
    await fs.writeFile(gitignorePath, `${prefix}.skynet/\n`);
  }

  async writeInbox(turn: number, text: string): Promise<void> {
    await fs.writeFile(path.join(this.dir, "inbox", `turn-${turn}.md`), text);
  }

  async tryReadOutbox(turn: number): Promise<unknown> {
    try {
      return JSON.parse(await fs.readFile(path.join(this.dir, "outbox", `turn-${turn}.json`), "utf8"));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && !(err instanceof SyntaxError)) {
        throw err;
      }
      return undefined;
    }
  }

  async dispose(): Promise<void> {
    await fs.rm(this.dir, { recursive: true, force: true });
  }
}
