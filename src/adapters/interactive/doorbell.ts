import type { TerminalTransport } from "./types";

export async function ring(
  transport: TerminalTransport,
  pingLine: string,
  submitSequence: string
): Promise<void> {
  transport.show(false);
  transport.sendText(pingLine, false);
  await transport.sendSequence(submitSequence);
}
