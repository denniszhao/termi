const CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CODE_LENGTH = 6;
const PAIRING_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export interface PairingManager {
  getCode(): string;
  verify(input: string): PairingResult;
}

export interface PairingResult {
  ok: boolean;
  error?: "expired" | "invalid";
}

export function createPairingManager(onCodeChanged?: (code: string) => void): PairingManager {
  let current = newChallenge();

  function rotateCode(): void {
    current = newChallenge();
    onCodeChanged?.(current.code);
  }

  return {
    getCode: () => current.code,
    verify: (input) => {
      const now = Date.now();
      if (current.expiresAt <= now) {
        rotateCode();
        return { ok: false, error: "expired" };
      }

      const normalized = input.trim().toUpperCase();
      if (normalized !== current.code) {
        current.attemptsRemaining -= 1;
        if (current.attemptsRemaining <= 0) {
          rotateCode();
          return { ok: false, error: "expired" };
        }
        return { ok: false, error: "invalid" };
      }

      rotateCode();
      return { ok: true };
    },
  };
}

function newChallenge() {
  return {
    code: generatePairingCode(),
    expiresAt: Date.now() + PAIRING_TTL_MS,
    attemptsRemaining: MAX_ATTEMPTS,
  };
}

function generatePairingCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}
