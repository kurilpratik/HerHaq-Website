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

`.env.example` carries this same set with instructions; it is committed, so
keep the two in step when a variable is added or retired.

`PAYTM_CHANNEL_ID`, `PAYTM_INDUSTRY_TYPE` and `FRONTEND_URL` are leftovers
from the Express service — nothing reads them, and they are gone from
`.env.example`. `PROXY_SECRET`, `APPS_SCRIPT_URL` and `PUBLIC_SHEET_ENDPOINT`
survive in some local `.env` files and in a `netlify.toml` comment, but no
code in this repo reads them either.

### Which database

The Neon project `herhaq` (`rapid-river-81005603`) has two branches:

| Branch | Contents | `DATABASE_URL` belongs in |
| --- | --- | --- |
| `main` | production donations | Netlify, Production context only |
| `test` | schema only, no rows | local `.env`, deploy previews, branch deploys |

`test` was created schema-only, so it has never held donor data. Reset it with
`psql "$DATABASE_URL" -f db/schema.sql` when it gets messy. Scope the Netlify
variable per deploy context so a preview build cannot write to `main`.

## The donation flow

1. Donor submits the form on `/donate`. `src/scripts/donation.js` POSTs to
   `/api/paytm/initiate` (same origin, relative path).
2. `initiate` validates, generates an order id, **inserts the row as
   `INITIATED`**, then calls Paytm's `initiateTransaction` and returns a
   `txnToken`.
3. The browser opens Paytm's checkout and the donor pays on Paytm's hosted
   page. The checkout script was already downloaded on page load, so this
   needs no network round trip of its own.
4. Paytm sends the donor's browser to `/api/paytm/callback` as a form POST.
5. `callback` verifies the checksum, then **queries Paytm's status API** for
   the authoritative outcome, writes it to the row, and redirects the donor to
   `/payment-status`.

Order ids look like `DON_<epoch_ms>_<0-9999>` and are unique in the database.

Statuses: `INITIATED` on creation, then whatever Paytm reports —
`TXN_SUCCESS`, `TXN_FAILURE`, `PENDING`, or `UNKNOWN` if the response carries
no `resultStatus`.

### The submit button in step 3 is a lock, not a label

Between the donor's click and the Paytm modal appearing there are two waits:
the `initiate` round trip, and Paytm's checkout bundle downloading from their
CDN. For as long as either is in flight the Donate button must stay disabled,
because the form is live and a second click means a **second order id, a
second `INITIATED` row, and a second Paytm order** — orders the reconciler
will later have to chase and resolve as abandoned.

So exactly one thing owns the button at a time, and on the success path
`donation.js` never hands it back:

| State | Label | Released by |
| --- | --- | --- |
| `initiate` in flight | `Processing...` | failure paths only |
| checkout bundle loading | `Processing...` | load error or timeout |
| modal opening and open | `Opening Paytm...` | `notifyMerchant` |

`notifyMerchant` re-enables it on `APP_CLOSED` (donor dismissed the modal) and
on `PAYMENT_ERROR`. On a completed payment nothing re-enables it, which is
correct — Paytm navigates the whole page away to the callback.

**Do not add a `finally` that resets the button.** There was one, and because
appending the `<script>` tag returns immediately while its `onload` fires
later, it ran on the success path too: the button went `Processing...` →
`Donate`, enabled, for the entire length of the CDN download, then
`Opening Paytm...`, then the modal. Donors read the bounce back to `Donate` as
a failure. Every state change now sits on a path that owns it.

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

**Paytm's checkout script loads on page load, not on submit.** The bundle
depends on nothing from the order — only `init(config)` needs the order id and
token — so there is no reason to make the donor wait for it after they have
already committed. Loading it on submit put the whole CDN download inside the
checkout flow, where it is dead time in front of someone holding a card.
Loading it on page load moves that download to a moment when the donor is
still typing. The cost is that everyone who opens `/donate` fetches it,
including people who never donate. That trade is worth it on this page in
particular, where intent is high. To bill it to the engaged instead, call
`loadPaytmCheckout()` from a `focusin` listener on the form rather than at
module scope; the memoisation makes it safe to call from anywhere, any number
of times.

**The loader is memoised and its failure is cached as a miss.** One promise
serves every caller, so a retry after a failed `initiate` cannot append a
second `<script>` tag or open a second checkout. On error or timeout the
cached promise is cleared, so the next submit retries the download instead of
awaiting a promise that has already rejected.

**The loader resolves on `CheckoutJS.onLoad`, not on the tag's `onload`.**
CheckoutJS carries on initialising after the script tag reports loaded, so the
tag firing is not a signal that `init` can be called. The 15-second timeout
exists because `onLoad` is Paytm's callback, not ours: if it never fires, the
donor gets a retryable error rather than a button stuck on `Processing...`
forever.

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

- **Nov 2026 — checkout button states.** The Donate button fell back to its
  default enabled state mid-flow, between `initiate` returning and Paytm's
  checkout bundle finishing its download, because a `finally` block reset it on
  the success path as well as the failure ones. Donors saw the button go back
  to `Donate` and read it as a failed attempt. The window was also genuinely
  clickable, which means duplicate orders were possible for the whole life of
  the bug: a second click fired a second `initiate` and created a second
  `INITIATED` row. Whether any donor actually did this has not been checked —
  look for rows sharing an email within a few seconds of each other before
  treating the historical abandonment rate as donor behaviour.
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
