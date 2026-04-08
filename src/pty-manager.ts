import * as pty from "node-pty";

export interface PtyHandle {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (exitCode: number) => void): void;
  kill(): void;
}

export function spawnPty(shell?: string, cols = 80, rows = 24): PtyHandle {
  const resolvedShell =
    shell || process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }

  // Suppress macOS "default shell is now zsh" nag when using bash
  if (process.platform === "darwin") {
    env.BASH_SILENCE_DEPRECATION_WARNING = "1";
  }

  // Set a cleaner prompt if the user doesn't have one customized
  if (!env.PS1 || env.PS1 === "\\s-\\v\\$ ") {
    env.PS1 = "\\[\\033[1;36m\\]\\W\\[\\033[0m\\] \\$ ";
  }

  const proc = pty.spawn(resolvedShell, [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: process.cwd(),
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
