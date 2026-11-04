#!/usr/bin/env node
// Prints an OWNER_PASSWORD_HASH for the owner's password.
// The password is read from stdin so it does not end up in shell history.
// Keep the format and iteration count in sync with src/lib/session.ts.
import { pbkdf2Sync, randomBytes } from "node:crypto";

const ITERATIONS = 100_000;

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const password = Buffer.concat(chunks)
  .toString("utf8")
  .replace(/\r?\n$/, "");

if (!password) {
  console.error("No password received on stdin.");
  process.exit(1);
}

const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256");
console.log(`pbkdf2-sha256$${ITERATIONS}$${salt.toString("base64")}$${hash.toString("base64")}`);
