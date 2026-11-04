import { describe, expect, it } from "vitest";
import { pbkdf2Sync } from "node:crypto";
import { createSessionToken, hashPassword, isSessionTokenValid, SESSION_TTL_MS, verifyPassword } from "../session";

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const stored = await hashPassword("correct horse");
    expect(await verifyPassword("correct horse", stored)).toBe(true);
    expect(await verifyPassword("wrong", stored)).toBe(false);
  });

  it("accepts hashes produced by scripts/hash-password.mjs (same format)", async () => {
    const salt = Buffer.from("0123456789abcdef");
    const hash = pbkdf2Sync("owner-pass", salt, 100_000, 32, "sha256");
    const stored = `pbkdf2-sha256$100000$${salt.toString("base64")}$${hash.toString("base64")}`;
    expect(await verifyPassword("owner-pass", stored)).toBe(true);
    expect(await verifyPassword("other", stored)).toBe(false);
  });

  it("rejects malformed stored hashes", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "md5$1$aa$bb")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2-sha256$abc$aa$bb")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2-sha256$1000$!!!$!!!")).toBe(false);
  });
});

describe("session tokens", () => {
  const secret = "test-secret";

  it("accepts a fresh token and rejects it after expiry", async () => {
    const now = 1_000_000;
    const token = await createSessionToken(secret, now);
    expect(await isSessionTokenValid(secret, token, now + 1)).toBe(true);
    expect(await isSessionTokenValid(secret, token, now + SESSION_TTL_MS)).toBe(false);
  });

  it("rejects tokens signed with another secret", async () => {
    const token = await createSessionToken(secret);
    expect(await isSessionTokenValid("other-secret", token)).toBe(false);
  });

  it("rejects tampered payloads and malformed tokens", async () => {
    const token = await createSessionToken(secret);
    const [, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ exp: Date.now() + 10 * SESSION_TTL_MS })).toString("base64url");
    expect(await isSessionTokenValid(secret, `${forged}.${signature}`)).toBe(false);
    expect(await isSessionTokenValid(secret, "")).toBe(false);
    expect(await isSessionTokenValid(secret, "a.b.c")).toBe(false);
    expect(await isSessionTokenValid(secret, "not base64!.sig")).toBe(false);
  });
});
