import * as pty from "node-pty";

export interface PtyHandle {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (exitCode: number) => void): void;
  kill(): void;
}

export function spawnPty(shell?: string, cols = 80, rows = 24): PtyHandle {
  const resolvedShell = shell || process.env.SHELL || "/bin/bash";

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }

  const proc = pty.spawn(resolvedShell, [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: process.env.HOME || "/",
    env,
  });

  return {
    write: (data) => proc.write(data),
    resize: (c, r) => proc.resize(c, r),
    onData: (cb) => {
      proc.onData(cb);
    },
    onExit: (cb) => {
      proc.onExit(({ exitCode }) => cb(exitCode));
    },
    kill: () => proc.kill(),
  };
}
