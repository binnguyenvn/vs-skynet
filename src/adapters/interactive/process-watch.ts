import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface ProcessRow {
  pid: number;
  ppid: number;
  comm: string;
}

// ponytail: macOS/Linux only (`ps -Ao`). Add a Windows backend if this mode ships there.
export async function hasLiveDescendant(pid: number, matchName: string): Promise<boolean> {
  const { stdout } = await execFileAsync("ps", ["-Ao", "pid,ppid,comm"]);
  const rows = stdout.trim().split("\n").slice(1).map(parseRow).filter(isRow);

  const queue = [pid];
  const seen = new Set<number>();
  while (queue.length) {
    const current = queue.shift()!;
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    for (const row of rows) {
      if (row.ppid !== current) {
        continue;
      }
      if (row.comm.includes(matchName)) {
        return true;
      }
      queue.push(row.pid);
    }
  }
  return false;
}

function parseRow(line: string): ProcessRow | undefined {
  const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
  if (!match) {
    return undefined;
  }
  return { pid: Number(match[1]), ppid: Number(match[2]), comm: match[3] };
}

function isRow(row: ProcessRow | undefined): row is ProcessRow {
  return row !== undefined;
}
