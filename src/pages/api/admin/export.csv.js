import { recordAudit } from "../../../lib/admin.js";
import {
  fetchDonationsForExport,
  parseFilters,
} from "../../../lib/donations.js";

export const prerender = false;

const istDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const istTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * One CSV cell.
 *
 * Two separate problems are handled here. The ordinary one is quoting: a comma,
 * quote or newline inside a value has to be escaped or it breaks the column
 * count. The less obvious one is formula injection: Excel and Google Sheets
 * execute a cell that begins with =, +, - or @ when the file is opened, and
 * every name, address and email in this export was typed into a public form by
 * someone we do not know. Prefixing an apostrophe makes the spreadsheet treat
 * it as text.
 */
function csvCell(value) {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRows(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

/** Everything on the donation row, which is what reconciliation work needs. */
function fullExport(rows) {
  const header = [
    "order_id",
    "date_ist",
    "time_ist",
    "name",
    "email",
    "phone",
    "amount_inr",
    "status",
    "txn_id",
    "address",
    "pan",
    "nationality",
    "country",
  ];

  const body = rows.map((row) => [
    row.order_id,
    istDate.format(new Date(row.created_at)),
    istTime.format(new Date(row.created_at)),
    row.name,
    row.email,
    row.phone,
    row.amount,
    row.status,
    row.txn_id,
    row.address,
    row.pan,
    row.nationality,
    row.country,
  ]);

  return csvRows([header, ...body]);
}

export const GET = async ({ request, url, locals }) => {
  // The middleware has already refused anyone without a session, so locals
  // always carries the admin by the time this runs.
  const admin = locals.admin;

  const filters = parseFilters(url.searchParams);

  let rows;
  try {
    rows = await fetchDonationsForExport(filters);
  } catch (error) {
    console.error("admin export query failed:", error.message);
    return new Response("The donations could not be read.", { status: 503 });
  }

  // Fail closed, as on the list page: an export of donor records is the thing
  // most worth having a record of, so no log entry means no file.
  try {
    await recordAudit({
      adminEmail: admin.email,
      action: "export_csv",
      detail: {
        status: filters.status || null,
        from: filters.from || null,
        to: filters.to || null,
        q: filters.q || null,
      },
      rowCount: rows.length,
      request,
    });
  } catch (error) {
    console.error("admin_audit write failed, export refused:", error.message);
    return new Response(
      "This export was not produced, because it could not be written to the audit log.",
      { status: 503 },
    );
  }

  const body = fullExport(rows);
  const name = `herhaq-donations-${istDate.format(new Date())}.csv`;

  return new Response(
    // Byte order mark, so Excel opens it as UTF-8 rather than guessing a
    // codepage and mangling every non-ASCII name.
    `﻿${body}\r\n`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    },
  );
};
