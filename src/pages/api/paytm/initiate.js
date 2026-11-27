import { db } from "../../../lib/db.js";
import { json } from "../../../lib/http.js";
import { paytmConfig, sign, siteOrigin } from "../../../lib/paytm.js";

export const prerender = false;

export const POST = async ({ request }) => {
  try {
    const body = await request.json();
    const { amount, email, phone, name, address, pan, nationality, country } =
      body || {};

    if (!amount || !email || !phone || !name) {
      return json({ success: false, message: "Missing required fields" }, 400);
    }

    const orderId = `DON_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    // Record the order before handing off to Paytm. This ordering is what
    // guarantees every Paytm order has a local row, which is what makes
    // reconciliation by polling our own rows complete. Do not reverse it.
    const sql = db();
    await sql`
      insert into donations
        (order_id, name, email, phone, amount,
         address, pan, nationality, country, status)
      values
        (${orderId}, ${name}, ${email}, ${phone}, ${amount},
         ${address || null}, ${pan || null}, ${nationality || null},
         ${country || null}, 'INITIATED')
    `;

    const cfg = paytmConfig();
    const paytmBody = {
      requestType: "Payment",
      mid: cfg.mid,
      websiteName: cfg.website,
      orderId,
      callbackUrl: `${siteOrigin(request)}/api/paytm/callback`,
      txnAmount: { value: amount.toString(), currency: "INR" },
      userInfo: {
        custId: email,
        email,
        mobile: phone,
        name,
      },
    };

    const signature = await sign(paytmBody, cfg.key);
    const response = await fetch(
      `${cfg.txnUrl}?mid=${cfg.mid}&orderId=${orderId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: paytmBody, head: { signature } }),
      },
    );
    const data = await response.json();

    if (data?.body?.txnToken) {
      return json({
        success: true,
        orderId,
        txnToken: data.body.txnToken,
        amount,
        mid: cfg.mid,
      });
    }

    console.error("Paytm initiation rejected:", data);
    return json(
      {
        success: false,
        message: "Failed to initiate transaction",
        error: data,
      },
      500,
    );
  } catch (error) {
    console.error("Paytm initiation error:", error);
    return json(
      {
        success: false,
        message: "Server error during transaction initiation",
        error: error.message,
      },
      500,
    );
  }
};
