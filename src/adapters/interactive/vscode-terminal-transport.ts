import * as vscode from "vscode";
import type { TerminalFactory, TerminalTransport } from "./types";

export class VscodeTerminalTransport implements TerminalTransport {
  private readonly closeListeners: Array<(exitCode: number | undefined) => void> = [];
  private readonly closeSub: vscode.Disposable;

  constructor(private readonly terminal: vscode.Terminal) {
    this.closeSub = vscode.window.onDidCloseTerminal((closed) => {
      if (closed === this.terminal) {
        this.closeListeners.forEach((listener) => listener(closed.exitStatus?.code));
      }
    });
  }

  show(preserveFocus: boolean): void {
    this.terminal.show(preserveFocus);
  }

  sendText(text: string, addNewLine: boolean): void {
    this.terminal.sendText(text, addNewLine);
  }

  async sendSequence(sequence: string): Promise<void> {
    await vscode.commands.executeCommand("workbench.action.terminal.sendSequence", { text: sequence });
  }

  async processId(): Promise<number | undefined> {
    return this.terminal.processId;
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
    this.closeSub.dispose();
    this.terminal.dispose();
  }
}

export class VscodeTerminalFactory implements TerminalFactory {
  create(opts: { name: string; cwd: string; env: Record<string, string> }): TerminalTransport {
    return new VscodeTerminalTransport(vscode.window.createTerminal(opts));
  }
}
