import { db } from "../../../lib/db.js";
import {
  PaytmChecksum,
  fetchOrderStatus,
  paytmConfig,
  siteOrigin,
} from "../../../lib/paytm.js";

export const prerender = false;

/**
 * Paytm returns the donor here. Note this is a BROWSER redirect (a form POST
 * from the donor's browser), not a server-to-server webhook -- so it does not
 * arrive if the donor closes the tab. The scheduled reconciler in
 * scripts/reconcile-donations.js is what makes the outcome eventually correct.
 */
export const POST = async ({ request, redirect }) => {
  const origin = siteOrigin(request);

  try {
    const form = await request.formData();
    const payload = Object.fromEntries(form.entries());
    const { ORDERID, CHECKSUMHASH } = payload;

    // verifySignature deletes CHECKSUMHASH from what it is given, so hand it
    // a copy and keep the original intact for logging
    const isValid = await PaytmChecksum.verifySignature(
      { ...payload },
      paytmConfig().key,
      CHECKSUMHASH,
    );
    if (!isValid) {
      return new Response("Checksum verification failed", { status: 400 });
    }

    // Never trust the redirect's own STATUS field -- it reaches us via the
    // donor's browser. Ask Paytm directly.
    const result = await fetchOrderStatus(paytmConfig(), ORDERID);
    console.log("Paytm status response after callback:", result);

    if (result.body && result.body.resultInfo) {
      const sql = db();
      await sql`
        update donations
           set status         = ${result.body.resultInfo.resultStatus || "UNKNOWN"},
               txn_id         = ${result.body.txnId || null},
               paytm_response = ${JSON.stringify(result.body)}::jsonb,
               updated_at     = now()
         where order_id = ${ORDERID}
      `;
    }

    const status = result?.body?.resultInfo?.resultStatus || "UNKNOWN";
    return redirect(`${origin}/payment-status?status=${status}`, 302);
  } catch (error) {
    console.error("Payment verification failed:", error);
    return new Response("Payment verification failed", { status: 500 });
  }
};
