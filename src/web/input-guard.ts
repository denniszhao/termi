interface CreateTerminalInputGuardOptions {
  onBlockedExitAttempt: () => void;
  onInput: (data: string) => void;
}

export interface TerminalInputGuard {
  send(data: string): void;
}

const REMOTE_EXIT_SEQUENCE = "\x04";

export function createTerminalInputGuard(
  options: CreateTerminalInputGuardOptions,
): TerminalInputGuard {
  const { onBlockedExitAttempt, onInput } = options;

  return {
    send: (data) => {
      if (data === REMOTE_EXIT_SEQUENCE) {
        onBlockedExitAttempt();
        return;
      }

      onInput(data);
    },
  };
}
