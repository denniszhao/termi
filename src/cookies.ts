export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) {
    return {};
  }

  const entries = header.split(";").map((part) => part.trim()).filter(Boolean);
  const cookies: Record<string, string> = {};

  for (const entry of entries) {
    const index = entry.indexOf("=");
    if (index <= 0) {
      continue;
    }
    const key = entry.slice(0, index).trim();
    const value = entry.slice(index + 1).trim();
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      // Ignore malformed cookie values instead of failing the entire request.
    }
  }

  return cookies;
}

export function serializeCookie(name: string, value: string, maxAgeSeconds?: number): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Secure",
  ];

  if (maxAgeSeconds !== undefined) {
    const expiresAt = new Date(Date.now() + (maxAgeSeconds * 1000)).toUTCString();
    parts.splice(2, 0, `Max-Age=${maxAgeSeconds}`, `Expires=${expiresAt}`);
  }

  return parts.join("; ");
}
