import type { TerminalTransport } from "../../adapters/interactive/types";

export interface RecordedCall {
  method: "show" | "sendText" | "sendSequence" | "dispose";
  args: unknown[];
}

export class FakeTerminalTransport implements TerminalTransport {
  readonly calls: RecordedCall[] = [];
  pid: number | undefined = 4242;
  private readonly closeListeners: Array<(exitCode: number | undefined) => void> = [];

  show(preserveFocus: boolean): void {
    this.calls.push({ method: "show", args: [preserveFocus] });
  }

  sendText(text: string, addNewLine: boolean): void {
    this.calls.push({ method: "sendText", args: [text, addNewLine] });
  }

  async sendSequence(sequence: string): Promise<void> {
    this.calls.push({ method: "sendSequence", args: [sequence] });
  }

  async processId(): Promise<number | undefined> {
    return this.pid;
  }

  onDidClose(listener: (exitCode: number | undefined) => void): { dispose(): void } {
    this.closeListeners.push(listener);
    return {
      dispose: () => {
        const index = this.closeListeners.indexOf(listener);
        if (index !== -1) {
          this.closeListeners.splice(index, 1);
        }
      },
    };
  }

  dispose(): void {
    this.calls.push({ method: "dispose", args: [] });
  }

  simulateClose(exitCode?: number): void {
    this.closeListeners.forEach((listener) => listener(exitCode));
  }
}
