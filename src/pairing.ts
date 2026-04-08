import { randomInt, timingSafeEqual } from "node:crypto";

const CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CODE_LENGTH = 6;
const PAIRING_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export type PairingCodeChangeReason = "expired" | "verified";

export interface PairingManager {
  getCode(): string;
  verify(input: string): PairingResult;
}

export interface PairingResult {
  ok: boolean;
  error?: "expired" | "invalid";
}

export function createPairingManager(
  onCodeChanged?: (code: string, reason: PairingCodeChangeReason) => void,
): PairingManager {
  let current = newChallenge();

  function rotateCode(reason: PairingCodeChangeReason): void {
    current = newChallenge();
    onCodeChanged?.(current.code, reason);
  }

  function getCurrentCode(): string {
    if (current.expiresAt <= Date.now()) {
      rotateCode("expired");
    }

    return current.code;
  }

  return {
    getCode: () => getCurrentCode(),
    verify: (input) => {
      const now = Date.now();
      if (current.expiresAt <= now) {
        rotateCode("expired");
        return { ok: false, error: "expired" };
      }

      const normalized = input.trim().toUpperCase();
      if (!isMatchingCode(normalized, current.code)) {
        current.attemptsRemaining -= 1;
        if (current.attemptsRemaining <= 0) {
          rotateCode("expired");
          return { ok: false, error: "expired" };
        }
        return { ok: false, error: "invalid" };
      }

      rotateCode("verified");
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
    code += CODE_CHARS[randomInt(CODE_CHARS.length)];
  }
  return code;
}

function isMatchingCode(candidate: string, expected: string): boolean {
  if (candidate.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}
