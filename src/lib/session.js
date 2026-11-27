import crypto from "node:crypto";

export const SESSION_COOKIE = "herhaq_admin";
export const STATE_COOKIE = "herhaq_admin_oauth_state";

const DEFAULT_HOURS = 12;

/**
 * Read at call time, not import time, for the same reason as db(): a missing
 * secret should break the admin routes, not every page on the site.
 */
function secret() {
  const value = process.env.ADMIN_SESSION_SECRET;
  if (!value) throw new Error("Missing ADMIN_SESSION_SECRET.");
  if (value.length < 32) {
    throw new Error("ADMIN_SESSION_SECRET must be at least 32 characters.");
  }
  return value;
}

function sign(payload) {
  return crypto
    .createHmac("sha256", secret())
    .update(payload)
    .digest("base64url");
}

/** Hours a session stays valid. */
export function sessionHours() {
  const configured = Number(process.env.ADMIN_SESSION_HOURS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_HOURS;
}

/**
 * Cookie value for a signed-in admin: `<claims>.<hmac>`.
 *
 * The session is stateless -- there is no sessions table, so a cookie cannot
 * be torn up server-side. Two things bound the damage: the short expiry, and
 * the middleware re-reading admin_users on every request, so setting a row to
 * active = false locks that person out on their next page load.
 */
export function createSessionValue({ email, name }) {
  const claims = {
    email,
    name: name || null,
    exp: Date.now() + sessionHours() * 60 * 60 * 1000,
  };
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** Claims from a cookie value, or null if it is absent, forged or expired. */
export function readSessionValue(value) {
  if (typeof value !== "string") return null;

  const separator = value.lastIndexOf(".");
  if (separator < 1) return null;

  const body = value.slice(0, separator);
  const signature = value.slice(separator + 1);

  let expected;
  try {
    expected = sign(body);
  } catch {
    // No secret configured. Treat every cookie as invalid rather than throwing
    // here, so a missing variable shows up as the login page and not a 500.
    return null;
  }

  // timingSafeEqual throws on a length mismatch, so check that first. Both
  // values are base64url of a SHA-256 digest, so a difference in length is
  // already proof of forgery.
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }

  let claims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!claims || typeof claims.email !== "string") return null;
  if (typeof claims.exp !== "number" || claims.exp <= Date.now()) return null;

  return claims;
}

/**
 * Cookie attributes. `secure` follows the request scheme so the same code
 * works on http://localhost:4321 and on https://herhaq.com -- a Secure cookie
 * is silently dropped over plain http, which looks exactly like a broken
 * login.
 *
 * SameSite=Lax, not Strict: the browser arrives at the OAuth callback from
 * accounts.google.com, and Strict would withhold the state cookie on that
 * top-level navigation and fail every sign-in.
 */
export function cookieOptions(url, maxAge) {
  return {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge,
  };
}

/** A random value for the OAuth `state` parameter. */
export function randomState() {
  return crypto.randomBytes(32).toString("base64url");
}

/** Constant-time string comparison, length mismatch included. */
export function safeEquals(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Where to send someone after sign-in. Only our own admin paths, so a crafted
 * ?next= cannot turn the login route into an open redirect to another site.
 */
export function safeNext(value) {
  if (typeof value !== "string") return "/admin";
  if (!value.startsWith("/admin")) return "/admin";
  // "//evil.example" is a protocol-relative URL, not a path.
  if (value.startsWith("//")) return "/admin";
  return value;
}
