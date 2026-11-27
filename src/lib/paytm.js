import PaytmChecksum from "paytmchecksum";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

/**
 * Read at call time, not import time, for the same reason as db(): a missing
 * Paytm variable should break the donation routes, not every page on the site.
 */
export function paytmConfig() {
  return {
    mid: required("PAYTM_MERCHANT_ID"),
    key: required("PAYTM_MERCHANT_KEY"),
    website: process.env.PAYTM_WEBSITE || "DEFAULT",
    txnUrl:
      process.env.PAYTM_TXN_URL ||
      "https://secure.paytmpayments.com/theia/api/v1/initiateTransaction",
    statusUrl:
      process.env.PAYTM_STATUS_URL ||
      "https://secure.paytmpayments.com/v3/order/status",
  };
}

/**
 * Absolute origin for callback URLs. Express derived this from the inbound
 * request as `req.protocol + "s"`, which only produced https by accident of
 * Render's proxy; prefer the configured site URL and fall back to the request.
 */
export function siteOrigin(request) {
  const configured = process.env.PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  return new URL(request.url).origin;
}

/** Sign a Paytm request body. */
export function sign(body, key) {
  return PaytmChecksum.generateSignature(JSON.stringify(body), key);
}

/** Ask Paytm for the authoritative status of an order. Read-only. */
export async function fetchOrderStatus({ mid, key, statusUrl }, orderId) {
  const body = { mid, orderId };
  const signature = await sign(body, key);
  const response = await fetch(statusUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body, head: { signature } }),
  });
  return response.json();
}

export { PaytmChecksum };
