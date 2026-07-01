// Uniformly single-quotes every argv token before joining. A quoted flag
// behaves identically to an unquoted one in a POSIX shell.
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildLaunchCommand(binary: string, argv: string[]): string {
  return [binary, ...argv.map(shellQuote)].join(" ");
}
