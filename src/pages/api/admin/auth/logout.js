import { recordAuditQuietly } from "../../../../lib/admin.js";
import { SESSION_COOKIE, readSessionValue } from "../../../../lib/session.js";

export const prerender = false;

/**
 * Sign out. POST only, so that nothing which merely renders a URL -- an
 * <img src>, a link preview, a prefetch -- can end somebody's session.
 */
export const POST = async ({ request, cookies, redirect }) => {
  const claims = readSessionValue(cookies.get(SESSION_COOKIE)?.value);
  cookies.delete(SESSION_COOKIE, { path: "/" });

  if (claims) {
    await recordAuditQuietly({
      adminEmail: claims.email,
      action: "signout",
      request,
    });
  }

  return redirect("/admin/login?signedout=1", 302);
};
