import {
  findAdmin,
  recordAuditQuietly,
  touchAdmin,
} from "../../../../../lib/admin.js";
import {
  callbackUrl,
  exchangeCode,
  googleConfig,
  readIdTokenClaims,
} from "../../../../../lib/google-oauth.js";
import {
  SESSION_COOKIE,
  STATE_COOKIE,
  cookieOptions,
  createSessionValue,
  safeEquals,
  safeNext,
  sessionHours,
} from "../../../../../lib/session.js";

export const prerender = false;

/**
 * Where Google returns the admin.
 *
 * Google proving someone controls an email address is not permission to be
 * here. The allowlist decides that, and a refusal is recorded -- an attempt by
 * an address nobody granted is exactly the thing worth seeing in the audit
 * log later.
 */
export const GET = async ({ request, url, cookies, redirect }) => {
  const stateCookie = cookies.get(STATE_COOKIE)?.value;
  // One attempt per cookie, whatever happens next.
  cookies.delete(STATE_COOKIE, { path: "/" });

  // The donor-facing equivalent of this is Paytm's callback, where the status
  // field is donor-controlled and therefore ignored. Same instinct here: every
  // query parameter below arrived through a browser.
  const failure = url.searchParams.get("error");
  if (failure) {
    // access_denied is the ordinary "no thanks" on Google's consent screen.
    const reason = failure === "access_denied" ? "cancelled" : "google";
    return redirect(`/admin/login?denied=${reason}`, 302);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || !stateCookie) {
    return redirect("/admin/login?denied=state", 302);
  }

  const separator = stateCookie.indexOf(":");
  const expectedState =
    separator === -1 ? stateCookie : stateCookie.slice(0, separator);
  const next = safeNext(
    separator === -1
      ? "/admin"
      : decodeURIComponent(stateCookie.slice(separator + 1)),
  );

  if (!safeEquals(state, expectedState)) {
    return redirect("/admin/login?denied=state", 302);
  }

  let identity;
  try {
    const config = googleConfig();
    const tokens = await exchangeCode(config, {
      code,
      redirectUri: callbackUrl(request),
    });
    identity = readIdTokenClaims(tokens.id_token, config);
  } catch (error) {
    console.error("Google sign-in failed:", error.message);
    return redirect("/admin/login?denied=google", 302);
  }

  let admin;
  try {
    admin = await findAdmin(identity.email);
  } catch (error) {
    console.error("admin allowlist lookup failed:", error.message);
    return redirect("/admin/login?denied=unavailable", 302);
  }

  if (!admin) {
    await recordAuditQuietly({
      adminEmail: identity.email,
      action: "signin_denied",
      detail: {
        reason: "not_on_allowlist",
        hostedDomain: identity.hostedDomain,
      },
      request,
    });
    return redirect("/admin/login?denied=allowlist", 302);
  }

  cookies.set(
    SESSION_COOKIE,
    createSessionValue({
      email: admin.email,
      name: admin.name || identity.name,
    }),
    cookieOptions(url, sessionHours() * 60 * 60),
  );

  await touchAdmin(admin.email);
  await recordAuditQuietly({
    adminEmail: admin.email,
    action: "signin",
    detail: { hostedDomain: identity.hostedDomain },
    request,
  });

  return redirect(next, 302);
};
