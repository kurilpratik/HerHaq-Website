import { neon } from "@neondatabase/serverless";

let client;

/**
 * Neon client, created on first use rather than at import.
 *
 * With output: "server" every page renders through the same SSR function, so
 * throwing at import time over a missing DATABASE_URL would take the whole
 * site down -- not just the donation routes. Resolving lazily keeps a bad or
 * absent connection string contained to the requests that actually query.
 *
 * Queries run over HTTP, so there is no pool to manage or tear down.
 */
export function db() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Missing DATABASE_URL.");
    client = neon(url);
  }
  return client;
}
