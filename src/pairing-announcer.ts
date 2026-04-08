export interface PairingCodeAnnouncer {
  announce(code: string): void;
}

export function createPairingCodeAnnouncer(
  onAnnounce: (code: string) => void,
): PairingCodeAnnouncer {
  let lastAnnouncedCode: string | null = null;

  return {
    announce(code: string): void {
      if (code === lastAnnouncedCode) {
        return;
      }

      lastAnnouncedCode = code;
      onAnnounce(code);
    },
  };
}
