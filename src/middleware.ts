import { defineMiddleware } from "astro:middleware";

import { findAdmin } from "./lib/admin.js";
import { SESSION_COOKIE, readSessionValue } from "./lib/session.js";

/**
 * One gate in front of everything under /admin and /api/admin, rather than a
 * check repeated at the top of each page. A page added later is protected
 * because of where it lives, not because somebody remembered.
 *
 * Paths that have to work *before* sign-in. Everything else behind the prefix
 * requires a valid session.
 */
const PUBLIC_PATHS = new Set([
  "/admin/login",
  "/api/admin/auth/google/start",
  "/api/admin/auth/google/callback",
  "/api/admin/auth/logout",
]);

function isGuarded(path: string) {
  return (
    path === "/admin" ||
    path.startsWith("/admin/") ||
    path.startsWith("/api/admin/")
  );
}

export const onRequest = defineMiddleware(async (context, next) => {
  // Trailing slashes are stripped so /admin/ and /admin are one path, and the
  // public list cannot be stepped around with /admin/login/.
  const path = context.url.pathname.replace(/\/+$/, "") || "/";

  // The thirteen public pages are prerendered, so this runs for them at build
  // time. Leaving early keeps the build away from the database entirely.
  if (!isGuarded(path)) return next();
  if (PUBLIC_PATHS.has(path)) return next();

  const isApi = path.startsWith("/api/admin/");
  const deny = (reason: string) => {
    if (isApi) {
      return new Response(JSON.stringify({ success: false, message: reason }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const target = new URLSearchParams();
    const wanted = context.url.pathname + context.url.search;
    if (wanted && wanted !== "/admin") target.set("next", wanted);
    if (reason) target.set("denied", reason);
    const query = target.toString();
    return context.redirect(`/admin/login${query ? "?" + query : ""}`, 302);
  };

  const claims = readSessionValue(context.cookies.get(SESSION_COOKIE)?.value);
  if (!claims) return deny("signin");

  // The allowlist is read on every request, not just at sign-in. The session
  // cookie is stateless and cannot be torn up server-side, so this is what
  // makes removing someone take effect: set active = false, or delete the row,
  // and their next page load is their last.
  let admin;
  try {
    admin = await findAdmin(claims.email);
  } catch (error) {
    console.error("admin allowlist lookup failed:", (error as Error).message);
    return new Response("Admin sign-in is unavailable.", { status: 503 });
  }

  if (!admin) {
    context.cookies.delete(SESSION_COOKIE, { path: "/" });
    return deny("revoked");
  }

  context.locals.admin = { email: admin.email, name: admin.name ?? null };
  return next();
});
