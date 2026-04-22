// netlify/functions/submit-donation.js
const fetch = require("node-fetch"); // Netlify functions support fetch natively in newer runtimes; require may work too.

exports.handler = async function (event, context) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    // Read env vars (configure these in Netlify Settings → Build & deploy → Environment)
    const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL; // the Web App URL you copied
    const PROXY_SECRET = process.env.PROXY_SECRET; // must match the Apps Script PROXY_SECRET

    if (!APPS_SCRIPT_URL || !PROXY_SECRET) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Server misconfigured" }),
      };
    }

    // Parse incoming body (Netlify provides event.body as string)
    const payload = JSON.parse(event.body);

    // Optional server-side validation
    if (!payload.name || !payload.email || !payload.phone) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing required fields" }),
      };
    }

    // Forward to Apps Script
    const response = await fetch(
      APPS_SCRIPT_URL + "?_secret=" + encodeURIComponent(PROXY_SECRET),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // You can also pass the secret as a header, but Apps Script's e.postData.headers availability may be limited.
          "x-proxy-secret": PROXY_SECRET,
        },
        body: JSON.stringify(payload),
      },
    );

    const text = await response.text();

    if (!response.ok) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "Upstream error", details: text }),
      };
    }

    return { statusCode: 200, body: JSON.stringify({ status: "ok" }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
