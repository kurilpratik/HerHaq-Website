# Backend architecture and operations

How the donation backend is put together, why it is put together that way, and
what to do when something breaks. Written November 2026, after moving the
database off Supabase and the API off Render.

## At a glance

| Concern | Choice | Notes |
| --- | --- | --- |
| Site + API | Astro 5, `output: "server"`, `@astrojs/netlify` | One deploy, one repo |
| Hosting | Netlify | Functions do not spin down |
| Database | Neon Postgres 18 | Project `herhaq` (`rapid-river-81005603`), `aws-ap-southeast-1` |
| DB driver | `@neondatabase/serverless` | Queries over HTTP, no pool |
| Payments | Paytm, production gateway | `paytmchecksum` for signing |
| Correctness backstop | `scripts/reconcile-donations.js` | Polls Paytm for dropped callbacks |

There is no separate backend service. The API lives in the same Astro project
as the website and deploys with it.

## Request topology

One Netlify function is generated at build time into
`.netlify/v1/functions/ssr`. It declares:

```js
export const config = { path: '/*', preferStatic: true }
```

`preferStatic` means Netlify serves a file from `dist/` when one exists at that
path and only invokes the function otherwise. So:

| Path | Served by |
| --- | --- |
| `/`, `/about`, `/donate`, `/team`, `/others/*`, ... | Static HTML on the CDN |
| `/api/*` | SSR function |
| `/payment-status` | SSR function (reads `?status=`) |

The thirteen content pages declare `export const prerender = true`.
`payment-status.astro` declares `prerender = false` because it reads
`Astro.url.searchParams`, which has no meaning at build time. **Any new page
that reads request-time data — query string, cookies, headers, session — must
declare `prerender = false`.**

The function bundle still contains the prerendered page modules. That is a
build artifact of the prerender step; they are never routed to.

## Repository layout

```
astro.config.mjs                       adapter + dotenv (see Decisions)
db/schema.sql                          canonical schema, apply with psql
scripts/reconcile-donations.js         npm run reconcile
src/lib/db.js                          lazy Neon client
src/lib/paytm.js                       config, signing, order status
src/lib/http.js                        json() response helper
src/pages/api/ping.js                  GET  health check
src/pages/api/newsletter/subscribe.js  POST (see 80G and known gaps)
src/pages/api/paytm/initiate.js        POST create order, hand off to Paytm
src/pages/api/paytm/callback.js        POST Paytm returns the donor here
src/pages/api/paytm/status.js          POST query one order
src/scripts/donation.js                client-side donation form logic
```

## Environment variables

Set these in Netlify (Site configuration, then Environment variables).
Locally they come from `.env`.

| Variable | Used by | Required |
| --- | --- | --- |
| `DATABASE_URL` | `src/lib/db.js`, reconcile script | Yes |
| `PAYTM_MERCHANT_ID` | Paytm routes | Yes |
| `PAYTM_MERCHANT_KEY` | Paytm routes, checksum signing | Yes |
| `PAYTM_WEBSITE` | `initiate` | Yes (`DEFAULT` in production) |
| `PAYTM_TXN_URL` | `initiate` | Yes |
| `PAYTM_STATUS_URL` | `callback`, `status`, reconcile | Yes |
| `PUBLIC_SITE_URL` | callback URL and redirect origin | Yes |
| `RECONCILE_STALE_MINUTES` | reconcile script | No (default 15) |
| `RECONCILE_AUDIT_FILE` | reconcile script | No |

`PAYTM_CHANNEL_ID`, `PAYTM_INDUSTRY_TYPE` and `FRONTEND_URL` appear in
`.env.example` but nothing reads them. They are leftovers from the Express
service and can be deleted.

Note that `.env.example` is listed in `.gitignore`, so it does not travel with
the repo. That is almost certainly unintentional — an example env file is
normally the one file you do commit. This table is the real reference until
that is fixed.

## The donation flow

1. Donor submits the form on `/donate`. `src/scripts/donation.js` POSTs to
   `/api/paytm/initiate` (same origin, relative path).
2. `initiate` validates, generates an order id, **inserts the row as
   `INITIATED`**, then calls Paytm's `initiateTransaction` and returns a
   `txnToken`.
3. The browser loads Paytm's checkout script and the donor pays on Paytm's
   hosted page.
4. Paytm sends the donor's browser to `/api/paytm/callback` as a form POST.
5. `callback` verifies the checksum, then **queries Paytm's status API** for
   the authoritative outcome, writes it to the row, and redirects the donor to
   `/payment-status`.

Order ids look like `DON_<epoch_ms>_<0-9999>` and are unique in the database.

Statuses: `INITIATED` on creation, then whatever Paytm reports —
`TXN_SUCCESS`, `TXN_FAILURE`, `PENDING`, or `UNKNOWN` if the response carries
no `resultStatus`.

### Two things about step 4 that matter

**The callback is a browser redirect, not a server-to-server webhook.** The
server only learns the outcome because the donor's browser tells it. It does
not arrive if the donor closes the tab, loses signal, or their phone sleeps
during the redirect. No amount of uptime fixes that.

**The status field in the callback is donor-controlled input.** It travels
through their browser. `callback` therefore ignores it and asks Paytm directly.
Keep it that way.

## Why the reconciler exists

Because step 4 is unreliable, the only mechanism that is *guaranteed* to get
the right answer is asking Paytm. `scripts/reconcile-donations.js` polls every
row still in `INITIATED` or `PENDING` past a staleness threshold and writes
back Paytm's verdict.

This is complete coverage, because of an invariant worth protecting: **the
insert happens before the Paytm call.** A Paytm order therefore cannot exist
without a local row, so polling our own non-terminal rows cannot miss
anything. If anyone ever "optimises" that insert to happen after the gateway
call, this guarantee is gone.

Paytm's order status API is read-only. Running the reconciler moves no money
and is safe at any time.

```bash
npm run reconcile              # dry run, writes nothing, prints a diff
npm run reconcile -- --apply   # write the corrections
```

Set `RECONCILE_AUDIT_FILE` to a path to save every raw gateway response, which
is worth doing whenever you pass `--apply`.

## Running locally

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # emits dist/ and .netlify/v1/functions/ssr
```

`npm run dev` serves everything on demand, so prerendering is not exercised
locally. Use `npm run build` to see the static and on-demand split.

Do not exercise `/api/paytm/initiate` casually. `.env` points at the
**production** gateway, so each call creates a real Paytm order, which then
shows up as an abandoned donation. `/api/paytm/status` is read-only and safe
to call freely.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `Wrong URL scheme or missing user, host or database` | `DATABASE_URL` holds the whole `.env` line including the `DATABASE_URL=` prefix, or is wrapped in quotes. Netlify stores the value literally. |
| `Missing PAYTM_MERCHANT_ID` from an API route, but pages still load | Variable absent from the environment. The containment is deliberate — see Decisions. |
| Donations stuck in `INITIATED` | Callbacks are being dropped. Run the reconciler, then work out why. |
| Donor charged with no record | Same cause. The reconciler recovers it. |
| Paytm status API reports no record for an order | Row was created locally but the donor never reached the gateway. |
| Whole site returns 500 after a deploy | Something now throws at module load. Config reads are lazy specifically to prevent this; check anything newly added at import time. |
| Env var works on Netlify but not locally | `.env` is only loaded via `astro.config.mjs`. See Decisions. |

## Database

Neon project `herhaq` (`rapid-river-81005603`), Postgres 18, database
`herhaq`, branch `main`, region `aws-ap-southeast-1`. Singapore, because Neon
has no Mumbai region.

The free plan is permanent. Compute scales to zero after five minutes idle and
resumes on connect in well under a second. Unlike Supabase's free tier, the
project is not paused or removed for inactivity.

`db/schema.sql` is canonical. Apply it with:

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

One table, `donations`, plus a `successful_donations` view over
`status = 'TXN_SUCCESS'`. The primary key is `uuid`, not a sequence.

`src/lib/db.js` exports `db()`, not a client — call it to get the `sql` tagged
template. Queries run over HTTP, so there is nothing to pool or close, and the
same code runs unchanged on Node or on a serverless runtime.

## Decisions and their reasons

**Config resolves on first use, not at import.** `db()` and `paytmConfig()`
read the environment when called. Under `output: "server"` every page renders
through one SSR function, so throwing at import over a missing variable would
take the entire website down, not just the donation routes. Verified: with
`PAYTM_MERCHANT_ID` absent, `/api/ping` still answers 200.

**`astro.config.mjs` calls `dotenv.config()`.** Vite exposes `.env` only
through `import.meta.env`, but the API routes and the reconcile script share
`process.env` so they can share one code path. The config runs in the same
Node process as the dev server and the build, so loading `.env` there fixes
local runs. On Netlify there is no `.env` file, and dotenv does not override
existing values, so deployed configuration always wins.

**The callback URL comes from `PUBLIC_SITE_URL`.** The Express version built
it as `req.protocol + "s"`, which only produced `https` by accident of
Render's proxy.

**The adapter is imported from `@astrojs/netlify`.** The `/functions` subpath
is deprecated in v6 and warns on every build.

**Dates are grouped in IST.** `created_at` is `timestamptz` stored in UTC, and
India's financial year runs 1 April to 31 March. A donation at 02:00 IST on
1 April is 20:30 UTC on 31 March, so grouping in UTC puts it in the wrong
financial year and the wrong tax filing. Always convert:
`created_at at time zone 'Asia/Kolkata'`.

## 80G and Form 10BD

Donors claiming a deduction need a receipt, and the organisation files Form
10BD annually and issues Form 10BE certificates. Those filings need donor
**name, address and PAN** — address included.

The form currently collects PAN only above 2,000 rupees and treats address as
optional, so a significant share of successful donations cannot be receipted
as recorded. Check the data before promising anyone a certificate.

`src/scripts/donation.js` validates PAN as `/^[A-Z0-9]+$/` — any length, any
arrangement. Real PANs are exactly `[A-Z]{5}[0-9]{4}[A-Z]`. This has already
let at least one malformed PAN into the data.

`/api/newsletter/subscribe` validates its input and then only logs it. It has
never persisted a subscriber, and that behaviour was carried over unchanged
from the Express version rather than silently fixed.

## History

- **Nov 2026 — Supabase to Neon.** The Supabase free tier pauses a project
  after 7 days of inactivity, taking the donation flow down with it. Worth
  knowing for next time: a *paused* Supabase project loses its DNS entirely,
  so its hostname returns NXDOMAIN and looks indistinguishable from a deleted
  one. All 77 rows were migrated and reconciled field by field.
- **Nov 2026 — reconciliation.** Found **11 successful payments worth 5,582
  rupees** that Paytm had taken but the database never recorded, because
  callbacks were dropped. Seven of the eight real ones fell in 26–29 July.
  Recorded donations went from 41,484 to 47,066 rupees, and the true success
  rate from 51% to 65%.
- **Nov 2026 — Render to Netlify.** Render's free tier spun down after 15
  minutes idle, so the first donor after a quiet spell waited roughly 50
  seconds on `/api/paytm/initiate` before the Paytm checkout could even be
  requested.

## Not yet built

- **Scheduled reconciliation.** The script exists but nothing runs it. It
  belongs in `netlify/functions/` as its own file exporting
  `export const config = { schedule: "*/15 * * * *" }`. The Astro adapter owns
  `.netlify/v1/functions`; user functions coexist in `netlify/functions`.
  Needs a bounded polling window and attempt tracking before running
  unattended, so it does not re-ask about orders settled months ago.
- **Resolve on the status page.** `/payment-status` should look the order up by
  id and resolve it on the spot if still `INITIATED`, turning the donor's own
  page load into a reconciliation trigger. Catches most dropped callbacks in
  seconds rather than minutes.
- **Idempotency guards.** `callback` updates unconditionally. Once the
  reconciler runs on a schedule, both can write the same row — the callback
  should only transition out of `INITIATED` or `PENDING`, as the reconciler
  already does.
- **Record callback receipt separately from the verdict.** `callback` queries
  the status API before writing anything, so if that query fails a
  successfully delivered callback is lost entirely. Recording "Paytm contacted
  us about this order" first would preserve the strongest available signal
  that a donor paid.
- **Admin dashboard.** Google OAuth against an allowlist table, gated in
  `src/middleware.ts` rather than per page, server-rendered so donor data
  never reaches a client bundle, with PAN masked by default and an audit log
  of views and exports. Receipt marking needs gapless per-financial-year
  numbering and should be treated as irreversible: void and reissue rather
  than un-mark.
