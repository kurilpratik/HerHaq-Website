/**
 * Reconcile donations stuck in INITIATED or PENDING against Paytm's record.
 *
 * Paytm notifies us of an outcome by POSTing to /api/paytm/callback. If that
 * POST fails -- the host was asleep, redeploying, or briefly down -- the
 * payment completes at Paytm but our row never leaves INITIATED. The donor is
 * charged, we have no record, and they get no 80G receipt.
 *
 * The order status API is read-only: it reports what Paytm holds and moves no
 * money. This script is therefore safe to run at any time, and safe to run on
 * a schedule.
 *
 *   npm run reconcile              # dry run, writes nothing
 *   npm run reconcile -- --apply  # write the corrections
 *
 * Env: PAYTM_MERCHANT_ID, PAYTM_MERCHANT_KEY, PAYTM_STATUS_URL, DATABASE_URL
 */
import dotenv from "dotenv";
import fs from "node:fs";
import PaytmChecksum from "paytmchecksum";
import { db } from "../src/lib/db.js";

dotenv.config();

const MID = process.env.PAYTM_MERCHANT_ID;
const KEY = process.env.PAYTM_MERCHANT_KEY;
const STATUS_URL =
  process.env.PAYTM_STATUS_URL ||
  "https://secure.paytmpayments.com/v3/order/status";

const APPLY = process.argv.includes("--apply");
const STALE_MINUTES = Number(process.env.RECONCILE_STALE_MINUTES || 15);
const GAP_MS = 200; // be polite to the gateway
const AUDIT = process.env.RECONCILE_AUDIT_FILE || null;

if (!MID || !KEY) {
  console.error("Missing PAYTM_MERCHANT_ID or PAYTM_MERCHANT_KEY.");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function askPaytm(orderId) {
  const body = { mid: MID, orderId };
  const signature = await PaytmChecksum.generateSignature(
    JSON.stringify(body),
    KEY,
  );
  const res = await fetch(STATUS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body, head: { signature } }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from status API`);
  return res.json();
}

const sql = db();

const stale = await sql`
  select order_id, status, amount, created_at
    from donations
   where status in ('INITIATED', 'PENDING')
     and created_at < now() - make_interval(mins => ${STALE_MINUTES})
   order by created_at asc
`;

console.log(
  `${stale.length} row(s) older than ${STALE_MINUTES}m in INITIATED/PENDING`,
);
console.log(APPLY ? "mode: APPLY (will write)\n" : "mode: DRY RUN (no writes)\n");

const plan = [];
const errors = [];
const audit = [];

for (const row of stale) {
  let result;
  try {
    result = await askPaytm(row.order_id);
  } catch (e) {
    errors.push({ order_id: row.order_id, error: e.message });
    await sleep(GAP_MS);
    continue;
  }
  audit.push({ order_id: row.order_id, response: result });

  const info = result?.body?.resultInfo ?? {};
  const paytmStatus = info.resultStatus ?? "NO_STATUS";
  const paytmAmount = result?.body?.txnAmount;

  plan.push({
    order_id: row.order_id,
    stored: row.status,
    paytm: paytmStatus,
    msg: info.resultMsg ?? "",
    code: info.resultCode ?? "",
    amount: Number(row.amount),
    paytm_amount: paytmAmount != null ? Number(paytmAmount) : null,
    txn_id: result?.body?.txnId ?? null,
    body: result?.body ?? null,
    changes: paytmStatus !== "NO_STATUS" && paytmStatus !== row.status,
    amount_mismatch:
      paytmAmount != null && Number(paytmAmount) !== Number(row.amount),
  });

  await sleep(GAP_MS);
}

if (AUDIT) {
  fs.writeFileSync(AUDIT, audit.map((a) => JSON.stringify(a)).join("\n"));
  console.log(`raw gateway responses written to ${AUDIT}\n`);
}

// ---- report ----
const pad = (s, n) => String(s).padEnd(n);
console.log(
  pad("ORDER_ID", 24),
  pad("AMT", 8),
  pad("STORED", 11),
  pad("PAYTM SAYS", 18),
  "NOTE",
);
console.log("-".repeat(90));
for (const p of plan) {
  console.log(
    pad(p.order_id, 24),
    pad("₹" + p.amount, 8),
    pad(p.stored, 11),
    pad(p.paytm, 18),
    [
      p.changes ? "CHANGE" : "no change",
      p.amount_mismatch ? `AMOUNT MISMATCH (paytm ₹${p.paytm_amount})` : "",
      p.msg,
    ]
      .filter(Boolean)
      .join(" | "),
  );
}

const byVerdict = {};
for (const p of plan) byVerdict[p.paytm] = (byVerdict[p.paytm] || 0) + 1;

const changes = plan.filter((p) => p.changes);
const newlySuccessful = changes.filter((p) => p.paytm === "TXN_SUCCESS");
const money = newlySuccessful.reduce((a, p) => a + p.amount, 0);

console.log("\n--- summary ---");
console.log("queried:", plan.length, "| errors:", errors.length);
console.log("paytm verdicts:", JSON.stringify(byVerdict));
console.log("rows needing change:", changes.length);
console.log(
  `UNRECORDED SUCCESSFUL PAYMENTS: ${newlySuccessful.length} worth ₹${money}`,
);
if (plan.some((p) => p.amount_mismatch))
  console.log("!! amount mismatches present -- inspect before applying");
if (errors.length) console.log("errors:", JSON.stringify(errors, null, 2));

// ---- write ----
if (!APPLY) {
  console.log("\nDry run. Re-run with --apply to write these corrections.");
  process.exit(0);
}
if (!changes.length) {
  console.log("\nNothing to write.");
  process.exit(0);
}

await sql.transaction(
  changes.map(
    (p) => sql`
      update donations
         set status         = ${p.paytm},
             txn_id         = ${p.txn_id},
             paytm_response = ${JSON.stringify(p.body)}::jsonb,
             updated_at     = now()
       where order_id = ${p.order_id}
         and status in ('INITIATED', 'PENDING')
    `,
  ),
);
console.log(`\nApplied ${changes.length} correction(s).`);
