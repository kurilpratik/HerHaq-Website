import { db } from "./db.js";

/**
 * ABCDE1234F becomes AB****34F: enough to recognise a PAN you already know,
 * useless to anyone who does not.
 */
export function maskPan(pan) {
  if (!pan) return null;
  const value = String(pan).trim();
  if (value.length <= 4) return "*".repeat(value.length);
  return `${value.slice(0, 2)}${"*".repeat(value.length - 4)}${value.slice(-2)}`;
}

/** The allowlist row for an email, or null. Inactive rows do not count. */
export async function findAdmin(email) {
  const sql = db();
  const rows = await sql.query(
    "select email, name, active from admin_users where email = $1 and active = true",
    [String(email).toLowerCase()],
  );
  return rows[0] || null;
}

/** Note that an admin was seen. Best effort -- never block a request on it. */
export async function touchAdmin(email) {
  try {
    const sql = db();
    await sql.query(
      "update admin_users set last_seen_at = now() where email = $1",
      [String(email).toLowerCase()],
    );
  } catch (error) {
    console.error("admin last_seen_at update failed:", error.message);
  }
}

/**
 * The caller's IP. Netlify sets x-nf-client-connection-ip; x-forwarded-for is
 * the fallback and its first entry is the client. Both are headers, so both
 * are spoofable by anyone talking to the function directly -- this is a note
 * in an audit trail, not an access control.
 */
export function clientIp(request) {
  const direct = request.headers.get("x-nf-client-connection-ip");
  if (direct) return direct;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return null;
}

/**
 * Append one row to admin_audit.
 *
 * Throws on failure, and callers that are about to show or export donor data
 * must let it. An audit log that quietly drops entries is worse than no audit
 * log, because it reads as a complete record of who saw what. If the write
 * cannot happen the view does not happen either.
 *
 * Sign-in and sign-out call this through recordAuditQuietly instead: a failed
 * audit write there would lock the dashboard behind a login that can never
 * complete, and the session itself is the weaker thing to lose.
 */
export async function recordAudit({
  adminEmail = null,
  action,
  detail = null,
  rowCount = null,
  request = null,
}) {
  const sql = db();
  await sql.query(
    `insert into admin_audit (admin_email, action, detail, row_count, ip, user_agent)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      adminEmail,
      action,
      detail ? JSON.stringify(detail) : null,
      rowCount,
      request ? clientIp(request) : null,
      request ? request.headers.get("user-agent") : null,
    ],
  );
}

/** recordAudit for the paths where losing the entry beats losing the request. */
export async function recordAuditQuietly(entry) {
  try {
    await recordAudit(entry);
  } catch (error) {
    console.error(
      `admin_audit write failed for ${entry.action}:`,
      error.message,
    );
  }
}

export const AUDIT_PAGE_SIZE = 100;

/** One page of the audit log, newest first, optionally filtered by action. */
export async function fetchAuditPage({
  action = "",
  limit = AUDIT_PAGE_SIZE,
  offset = 0,
}) {
  const sql = db();
  const where = action ? "where action = $1" : "";
  const params = action ? [action] : [];

  const rows = await sql.query(
    `select id, admin_email, action, detail, row_count, ip, user_agent, created_at
       from admin_audit
       ${where}
      order by created_at desc, id desc
      limit $${params.length + 1} offset $${params.length + 2}`,
    [...params, limit, offset],
  );

  const totals = await sql.query(
    `select count(*)::int as matched from admin_audit ${where}`,
    params,
  );

  return { rows, matched: totals[0]?.matched ?? 0 };
}

/** The distinct actions present in the log, for the filter. */
export async function fetchAuditActions() {
  const sql = db();
  const rows = await sql.query(
    "select action, count(*)::int as count from admin_audit group by action order by action",
  );
  return rows;
}
