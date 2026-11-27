import { siteOrigin } from "./paytm.js";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const ISSUERS = ["accounts.google.com", "https://accounts.google.com"];

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

/** Read at call time, not import time -- see db() and paytmConfig(). */
export function googleConfig() {
  return {
    clientId: required("GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: required("GOOGLE_OAUTH_CLIENT_SECRET"),
  };
}

/**
 * The redirect URI, which must match one registered on the OAuth client in
 * Google Cloud byte for byte. Built from PUBLIC_SITE_URL rather than the
 * inbound request, for the reason siteOrigin() documents.
 */
export function callbackUrl(request) {
  return `${siteOrigin(request)}/api/admin/auth/google/callback`;
}

/**
 * Where to send the browser to start sign-in.
 *
 * Scopes are openid, email and profile only. That subset is exempt from
 * Google's verification requirement, so the consent screen never shows an
 * "unverified app" warning and no review is needed. Asking for anything more
 * changes that.
 *
 * No access_type=offline: a refresh token would let us call Google later on
 * the admin's behalf, which this never does. We want one assertion of who
 * they are, and then our own session cookie.
 */
export function authorizeUrl({ clientId }, { redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    // Always offer the account chooser. Admins signing in on a shared machine
    // should not be silently logged in as whoever used it last.
    prompt: "select_account",
  });
  return `${AUTHORIZE_URL}?${params}`;
}

/** Exchange an authorization code for Google's token response. */
export async function exchangeCode(
  { clientId, clientSecret },
  { code, redirectUri },
) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      payload?.error_description || payload?.error || response.status;
    throw new Error(`Google token exchange failed: ${detail}`);
  }
  if (!payload?.id_token)
    throw new Error("Google token response carried no id_token.");
  return payload;
}

/**
 * Claims from an id_token received directly from Google's token endpoint.
 *
 * The signature is not verified, and that is deliberate rather than an
 * omission. This token did not travel through the donor's -- or anyone's --
 * browser: it came back over TLS from a server-to-server POST to
 * oauth2.googleapis.com that was authenticated with our client secret.
 * OpenID Connect Core section 3.1.3.7 explicitly permits skipping signature
 * validation in exactly that case. The alternative is a JWKS fetch and a
 * crypto dependency to re-prove something TLS already proved.
 *
 * What does still have to be checked is the content, because a token can be
 * well-signed and still not be for us:
 *
 *   iss   must be Google
 *   aud   must be *our* client id, not another app's
 *   exp   must be in the future
 *   email must be present and verified
 */
export function readIdTokenClaims(idToken, { clientId }) {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Malformed id_token.");

  let claims;
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("Unreadable id_token payload.");
  }

  if (!ISSUERS.includes(claims.iss)) {
    throw new Error(`Unexpected id_token issuer: ${claims.iss}`);
  }
  if (claims.aud !== clientId) {
    throw new Error("id_token was not issued for this client.");
  }
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) {
    throw new Error("id_token has expired.");
  }
  if (!claims.email) {
    throw new Error("id_token carried no email address.");
  }
  // Google sends false for an unverified address on a self-signup domain.
  // Such an address proves nothing about who is signing in.
  if (claims.email_verified === false) {
    throw new Error("Google has not verified that email address.");
  }

  return {
    email: String(claims.email).toLowerCase(),
    name: claims.name || null,
    hostedDomain: claims.hd || null,
  };
}
