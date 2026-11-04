import { OWNER_EMAIL, OWNER_PASSWORD_HASH, SESSION_SECRET } from "astro:env/server";
import { createSessionToken, isSessionTokenValid, SESSION_TTL_MS, verifyPassword } from "./session";

export const SESSION_COOKIE = "myportfelik_session";
export const SESSION_MAX_AGE_SECONDS = SESSION_TTL_MS / 1000;

export interface OwnerUser {
  email: string;
}

/** Returns a session token when the credentials belong to the owner, otherwise null. Fails closed when unconfigured. */
export async function createOwnerSession(email: string, password: string): Promise<string | null> {
  if (!OWNER_EMAIL || !OWNER_PASSWORD_HASH || !SESSION_SECRET) return null;
  const emailMatches = email.trim().toLowerCase() === OWNER_EMAIL.trim().toLowerCase();
  // Verify the password either way so response timing does not reveal whether the email matched.
  const passwordMatches = await verifyPassword(password, OWNER_PASSWORD_HASH);
  if (!emailMatches || !passwordMatches) return null;
  return createSessionToken(SESSION_SECRET);
}

/** Resolves the owner from a session cookie value. Returns null for missing, forged, or expired sessions. */
export async function getSessionUser(cookieValue: string | undefined): Promise<OwnerUser | null> {
  if (!OWNER_EMAIL || !SESSION_SECRET || !cookieValue) return null;
  const valid = await isSessionTokenValid(SESSION_SECRET, cookieValue);
  return valid ? { email: OWNER_EMAIL } : null;
}

export function isAuthConfigured(): boolean {
  return Boolean(OWNER_EMAIL && OWNER_PASSWORD_HASH && SESSION_SECRET);
}
