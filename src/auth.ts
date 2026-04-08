import { randomBytes, timingSafeEqual } from "node:crypto";
import { TOKEN_BYTES } from "./constants.js";

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function validateToken(
  candidate: string | null,
  expected: string,
): boolean {
  if (!candidate) return false;
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}
