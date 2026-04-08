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
    cookies[key] = decodeURIComponent(value);
  }

  return cookies;
}

export function serializeCookie(name: string, value: string, maxAgeSeconds: number): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Strict",
    "Secure",
  ].join("; ");
}

