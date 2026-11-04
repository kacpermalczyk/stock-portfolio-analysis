import { env } from "cloudflare:workers";

/** Local SQLite database provided by the D1 binding (`DB` in wrangler.jsonc). */
export function getDb(): D1Database {
  return env.DB;
}
