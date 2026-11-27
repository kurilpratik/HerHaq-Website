import {
  authorizeUrl,
  callbackUrl,
  googleConfig,
} from "../../../../../lib/google-oauth.js";
import {
  STATE_COOKIE,
  cookieOptions,
  randomState,
  safeNext,
} from "../../../../../lib/session.js";

export const prerender = false;

/**
 * Hand the browser to Google.
 *
 * The `state` nonce and the page the admin was trying to reach travel together
 * in one short-lived cookie. State is what proves the callback belongs to a
 * sign-in this site started; keeping `next` beside it rather than in the URL
 * means Google never sees which page was wanted.
 */
export const GET = async ({ request, url, cookies, redirect }) => {
  let config;
  try {
    config = googleConfig();
  } catch (error) {
    console.error("Google OAuth is not configured:", error.message);
    return redirect("/admin/login?denied=config", 302);
  }

  const state = randomState();
  const next = safeNext(url.searchParams.get("next"));

  cookies.set(
    STATE_COOKIE,
    `${state}:${encodeURIComponent(next)}`,
    // Ten minutes: long enough to pick an account and type a password, short
    // enough that an abandoned attempt leaves nothing lying around.
    cookieOptions(url, 600),
  );

  return redirect(
    authorizeUrl(config, { redirectUri: callbackUrl(request), state }),
    302,
  );
};
