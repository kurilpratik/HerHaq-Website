import { db } from "./db.js";

/** Paytm's resultStatus values, plus our own INITIATED. */
export const STATUSES = [
  "TXN_SUCCESS",
  "TXN_FAILURE",
  "PENDING",
  "INITIATED",
  "UNKNOWN",
];

/**
 * Sortable columns, as a whitelist mapping a query-string value to SQL.
 * Nothing from the request is ever interpolated into a statement.
 */
const SORT_COLUMNS = {
  date: "created_at",
  amount: "amount",
  name: "lower(name)",
  status: "status",
};

export const PAGE_SIZE = 50;

/** India's financial year runs 1 April to 31 March. */
export function financialYearOf(date) {
  const year = date.getUTCFullYear();
  // getUTCMonth is zero-based, so 3 is April.
  return date.getUTCMonth() >= 3 ? year : year - 1;
}

/** "2026-27" for the year starting April 2026. */
export function financialYearLabel(startYear) {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** First and last IST dates of a financial year, as YYYY-MM-DD. */
export function financialYearRange(startYear) {
  return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` };
}

function cleanDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value : "";
}

/** Read the filter set out of a URL's query string, discarding anything odd. */
export function parseFilters(searchParams) {
  const status = searchParams.get("status") || "";
  const sort = searchParams.get("sort") || "date";
  const page = Math.max(
    1,
    Number.parseInt(searchParams.get("page") || "1", 10) || 1,
  );

  return {
    status: STATUSES.includes(status) ? status : "",
    from: cleanDate(searchParams.get("from")),
    to: cleanDate(searchParams.get("to")),
    q: (searchParams.get("q") || "").trim().slice(0, 100),
    sort: Object.hasOwn(SORT_COLUMNS, sort) ? sort : "date",
    dir: searchParams.get("dir") === "asc" ? "asc" : "desc",
    page,
  };
}

/** The filters as a query string, for links and for the audit detail. */
export function filtersToQuery(filters, overrides = {}) {
  const merged = { ...filters, ...overrides };
  const params = new URLSearchParams();
  for (const key of ["status", "from", "to", "q", "sort", "dir"]) {
    if (merged[key]) params.set(key, merged[key]);
  }
  if (merged.page && merged.page > 1) params.set("page", String(merged.page));
  if (merged.reveal) params.set("reveal", "1");
  return params.toString();
}

/** True when any filter is narrowing the list. */
export function filtersAreActive(filters) {
  return Boolean(filters.status || filters.from || filters.to || filters.q);
}

/**
 * Build the WHERE clause shared by the list, the totals and the exports.
 *
 * Dates arrive as IST calendar days and created_at is timestamptz stored in
 * UTC, so each bound is converted through Asia/Kolkata rather than compared
 * directly. A donation at 02:00 IST on 1 April is 20:30 UTC on 31 March;
 * comparing in UTC files it under the previous financial year, which is the
 * wrong tax filing. The upper bound is exclusive of the *next* IST midnight,
 * which is what makes `to` an inclusive day.
 */
function buildWhere(filters) {
  const clauses = [];
  const params = [];
  const placeholder = () => "$" + params.length;

  if (filters.status) {
    params.push(filters.status);
    clauses.push("status = " + placeholder());
  }
  if (filters.from) {
    params.push(filters.from);
    clauses.push(
      "created_at >= ((" +
        placeholder() +
        "::date)::timestamp at time zone 'Asia/Kolkata')",
    );
  }
  if (filters.to) {
    params.push(filters.to);
    clauses.push(
      "created_at < (((" +
        placeholder() +
        "::date) + 1)::timestamp at time zone 'Asia/Kolkata')",
    );
  }
  if (filters.q) {
    // Leading wildcard, so the lower(name) and lower(email) indexes cannot be
    // used and this is a sequential scan. Fine at a few thousand donations;
    // revisit with pg_trgm if the table ever gets genuinely large.
    params.push("%" + filters.q.toLowerCase() + "%");
    const p = placeholder();
    clauses.push(
      `(lower(name) like ${p} or lower(email) like ${p}` +
        ` or lower(order_id) like ${p} or phone like ${p})`,
    );
  }

  return {
    sql: clauses.length ? "where " + clauses.join(" and ") : "",
    params,
  };
}

/** One page of donations, plus what the filters match in total. */
export async function fetchDonations(
  filters,
  { limit = PAGE_SIZE, offset = 0 } = {},
) {
  const sql = db();
  const where = buildWhere(filters);
  const column = SORT_COLUMNS[filters.sort];
  const limitAt = "$" + (where.params.length + 1);
  const offsetAt = "$" + (where.params.length + 2);

  const rows = await sql.query(
    `select id, order_id, name, email, phone, amount, address, pan,
            nationality, country, status, txn_id, created_at
       from donations
       ${where.sql}
      order by ${column} ${filters.dir}, created_at desc
      limit ${limitAt} offset ${offsetAt}`,
    [...where.params, limit, offset],
  );

  const totals = await sql.query(
    `select count(*)::int as matched,
            coalesce(sum(amount) filter (where status = 'TXN_SUCCESS'), 0)::float
              as raised
       from donations
       ${where.sql}`,
    where.params,
  );

  return {
    rows,
    matched: totals[0]?.matched ?? 0,
    raised: totals[0]?.raised ?? 0,
  };
}

/** Every row the filters match, for an export. No pagination. */
export async function fetchDonationsForExport(filters) {
  const sql = db();
  const where = buildWhere(filters);
  const column = SORT_COLUMNS[filters.sort];

  return sql.query(
    `select order_id, name, email, phone, amount, address, pan,
            nationality, country, status, txn_id, created_at
       from donations
       ${where.sql}
      order by ${column} ${filters.dir}, created_at desc`,
    where.params,
  );
}

/** Counts by status across the whole table, for the filter bar. */
export async function fetchStatusCounts() {
  const sql = db();
  const rows = await sql.query(
    "select status, count(*)::int as count from donations group by status",
  );
  const counts = {};
  for (const row of rows) counts[row.status] = row.count;
  return counts;
}

/** A timestamptz as an IST date and time, for display. */
export function formatIst(value) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

/** Rupees, grouped Indian-style. */
export function formatRupees(amount) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(amount));
}
