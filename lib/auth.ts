// Per-user auth.
// Web UI: password checked against the `users` table → a signed, tamper-proof
// cookie carrying the user id. The cookie is signed with APP_PASSWORD as the
// server secret (no longer a login password — just the signing key), so
// middleware can validate it on the Edge with no DB call.
// Capture API: x-api-key. Per-user resolution lands in Phase 4; for now it
// still checks the single CAPTURE_API_KEY.
// Uses Web Crypto so it runs in both Node and Edge (middleware).

export const AUTH_COOKIE = "recipe_auth";

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The cookie value for a user: "<id>.<signature>". Tamper-proof — forging a
 * different id requires the APP_PASSWORD secret to produce a matching
 * signature, so a user can't rewrite the cookie to become someone else.
 */
export async function signUserCookie(userId: string): Promise<string> {
  const secret = process.env.APP_PASSWORD;
  if (!secret) throw new Error("APP_PASSWORD is not set");
  const sig = await sha256Hex(`recipe-app-v2:${userId}:${secret}`);
  return `${userId}.${sig}`;
}

/** Validates the signature and returns the user id, or null. No DB lookup. */
export async function userIdFromCookie(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const userId = token.slice(0, dot);
  return (await signUserCookie(userId)) === token ? userId : null;
}

/** The logged-in user's id from a request's cookie, or null. For API routes. */
export async function currentUserId(req: Request): Promise<string | null> {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`${AUTH_COOKIE}=([^;]+)`));
  return userIdFromCookie(match?.[1]);
}

export function apiKeyIsValid(req: Request): boolean {
  const key = req.headers.get("x-api-key");
  return !!key && key === process.env.CAPTURE_API_KEY;
}

/** For API routes: true if a valid session cookie or the capture API key. */
export async function requestIsAuthed(req: Request): Promise<boolean> {
  if (apiKeyIsValid(req)) return true;
  return (await currentUserId(req)) !== null;
}
