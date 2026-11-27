# The admin dashboard

`/admin`, the donations console: who can open it, what it does, and why it is
built the way it is. Split out of `ARCHITECTURE.md`, which covers the donation
flow, the reconciler and the rest of the backend.

The admin is optional. With none of its variables set, the public site and the
donation flow are unaffected and `/admin/login` simply says it is not
configured.

## Setting it up

### 1. A Google OAuth client

A free Google account is enough. There is no billing account, no card, and no
verification review: the only scopes requested are `openid`, `email` and
`profile`, which Google exempts from verification for sign-in.

In the Google Cloud Console, create a project, then **APIs and Services ->
Credentials -> Create credentials -> OAuth client ID -> Web application**.
Register both redirect URIs, exactly:

```
http://localhost:4321/api/admin/auth/google/callback
https://herhaq.com/api/admin/auth/google/callback
```

Leave the consent screen in **Testing** and list each admin as a test user, up
to a hundred. Google then refuses every other account before our allowlist is
consulted at all, which makes it a second lock rather than a formality. The
seven-day authorisation expiry that Testing imposes does not apply here,
because it governs stored refresh tokens and this never asks for one.

If Her Haq has Google Workspace, through Google for Nonprofits or otherwise,
the consent screen can be set to **Internal** instead. Google then refuses
every account outside the organisation's own domain, and the allowlist narrows
it to specific people inside.

### 2. Environment

| Variable | Notes |
| --- | --- |
| `ADMIN_SESSION_SECRET` | At least 32 characters. A **different** value per environment, or a cookie minted on a laptop works in production. |
| `ADMIN_SESSION_HOURS` | Optional, default 12. |
| `GOOGLE_OAUTH_CLIENT_ID` | From the client above. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | From the client above. |

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

`.env.example` carries the same set with instructions, and
`docs/ARCHITECTURE.md` holds the authoritative table of every variable in the
project.

### 3. Tables

`admin_users` and `admin_audit` live in `db/schema.sql` alongside `donations`.

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

Both are per database branch, so `test` and `main` have **separate admin
lists**. Adding yourself locally does not let you into production.

### 4. Who gets in

```bash
npm run admins                              # list
npm run admins -- add pat@example.com "Pat" # allow
npm run admins -- disable pat@example.com   # revoke, keep the history
npm run admins -- enable pat@example.com    # restore
npm run admins -- remove pat@example.com    # delete the row
```

The script prints which database host it is about to change before it does
anything. There is deliberately no screen in the dashboard for granting
access: adding an admin should take a deliberate act on a machine with the
connection string, not a click by whoever is already signed in.

Disable is usually the right revocation. The row stays, so the audit log still
has a name to attach to past entries.

**Which database it changes** is whichever `DATABASE_URL` is in the
environment when you run it, and your local `.env` points at `test`. So the
commands above add a *test* admin. For a production one, two routes, and the
first is usually better:

1. **Neon Console, branch `main`, SQL Editor.** The production connection
   string never has to come near your laptop.

   ```sql
   insert into admin_users (email, name)
   values ('pat@example.com', 'Pat')
   on conflict (email) do update set active = true;
   ```

   The address must be lowercase. There is a check constraint on the column,
   so a capital letter is rejected rather than silently stored.

2. **A one-off variable in the shell**, then close that shell, because the
   connection string stays in its history:

   ```powershell
   $env:DATABASE_URL = "<main connection string>"; npm run admins -- add pat@example.com "Pat"
   ```

The script prints the database host before doing anything, and the host
differs per branch. Read that line and check it is the branch you meant.

## Deploying it

Order matters. The tables go in before the code, so the first page load after
a deploy is not an error.

### 1. Tables on the `main` branch

`main` has only `donations` and `successful_donations` until you do this.
`db/schema.sql` is idempotent, every statement is `if not exists` or `or
replace`, so running the whole file against production adds the two admin
tables and two indexes and touches nothing else.

`psql` is not installed on the machine this was built on, so the practical
route is the **Neon Console, project `herhaq`, branch `main`, SQL Editor**:
paste the contents of `db/schema.sql` and run it. With psql available:

```bash
psql "<main connection string>" -f db/schema.sql
```

**Never run `db/seed-test.sql` here.** That one is for the `test` branch.

### 2. Environment on Netlify

Site configuration, then Environment variables, scoped to the **Production**
context:

| Variable | Value |
| --- | --- |
| `ADMIN_SESSION_SECRET` | A **new** 32+ character value, not the one in your local `.env` |
| `GOOGLE_OAUTH_CLIENT_ID` | From the OAuth client |
| `GOOGLE_OAUTH_CLIENT_SECRET` | From the OAuth client |
| `ADMIN_SESSION_HOURS` | Optional, default 12 |

`DATABASE_URL` and `PUBLIC_SITE_URL` are already set for the donation flow.
Confirm `PUBLIC_SITE_URL` is exactly `https://herhaq.com`, because the Google
callback URL is built from it and Google matches redirect URIs byte for byte.

A different secret per environment is not pedantry: share one and a session
cookie minted on a laptop is valid in production.

Do not give any of these a `PUBLIC_` prefix. That prefix bundles a value into
client-side code, and Netlify's secrets scanner will fail the build if a
secret's value turns up in the build output.

### 3. The redirect URI

The OAuth client needs this registered, exactly:

```
https://herhaq.com/api/admin/auth/google/callback
```

If the consent screen is in Testing, every admin's address also has to be
listed under Test users, or Google refuses them before our allowlist is
consulted.

Deploy previews and branch deploys will **not** be able to sign in, because
their URLs are not registered. That is the right default: previews point at
the `test` branch and nobody needs the admin on them.

### 4. Deploy

Push to `main`. Netlify builds and the SSR function picks up the new routes.
Check `https://herhaq.com/admin/login` answers 200 rather than 404.

### 5. The first admin

Nobody can sign in until `admin_users` on `main` has a row. See **Who gets
in** above for the script, and the warning below about which database it
talks to.

### What goes wrong

| Symptom | Cause |
| --- | --- |
| `/admin/login` 404s after deploying | The build did not include the admin. Check the deploy log and that the commit really contains `src/pages/admin/`. |
| Sign-in loops back with `?denied=config` | `GOOGLE_OAUTH_CLIENT_ID` or `GOOGLE_OAUTH_CLIENT_SECRET` missing from the Production context. |
| `redirect_uri_mismatch` from Google | `PUBLIC_SITE_URL` does not match the registered URI, byte for byte. A trailing slash counts. |
| `?denied=unavailable` | The admin tables are not on `main`. Step 1 was skipped. |
| `?denied=allowlist` for everyone | Step 5 was skipped, or the rows were added to the `test` branch by mistake. |
| Everyone signed out after a deploy | `ADMIN_SESSION_SECRET` changed. Every existing cookie fails its signature check. Harmless, just sign in again. |

## How it works

`/admin` lists donations, filters them, exports them, and records who did so.
It is server-rendered with no client-side JavaScript at all: filters are a GET
form, sorting and paging are links, revealing a PAN is a round trip, and
signing out is a form POST. Donor records therefore never reach a browser
bundle, only rendered HTML.

There is no loading state, and that follows from the above rather than being
an oversight. Every interaction is a page navigation, so the only progress
indicator is the browser's own. It shows most on the first load after a quiet
spell: Neon scales the compute to zero after five minutes idle, so that
request waits for the database to wake with nothing on the page to say so.

Adding a spinner means adding the first client-side JavaScript to these pages,
and that is the property keeping donor records out of a browser bundle. The
trade was weighed and declined. If the wait ever becomes a real complaint,
look at the database end first: the five-minute scale-to-zero is a Neon plan
setting, not something this code controls.

## The gate is one file

`src/middleware.ts` guards every path under `/admin` and `/api/admin`. A page
added later is protected because of where it lives, not because somebody
remembered to add a check. Four paths are public by name: the login page and
the three auth routes.

Everything else behind the prefix needs a valid session cookie **and** a row in
`admin_users`, and the allowlist is read **on every request**, not just at
sign-in. That is what makes revocation work: the session cookie is stateless
and cannot be torn up server-side, so `npm run admins -- disable someone@x.com`
is what ends their access, on their next page load.

The thirteen public pages are prerendered, so the middleware also runs for them
at build time. It returns before touching the database for any path outside the
admin prefix, which is why the build never needs a connection.

## Sign-in

Google OAuth, authorization code flow, scopes `openid email profile` only.
That subset is exempt from Google's verification requirement, so there is no
review and no "unverified app" screen. Asking for anything more changes that.

The `id_token` signature is **not** verified, deliberately. The token comes
back over TLS from a server-to-server POST authenticated with our client
secret, never through a browser, and OpenID Connect Core 3.1.3.7 permits
skipping signature validation in exactly that case. The claims are still
checked: issuer, audience, expiry, and `email_verified`.

Google proving someone controls an address is not permission to be here. The
allowlist decides that, and a refusal is written to `admin_audit` as
`signin_denied`. Keep the consent screen in **Testing** with each admin listed
as a test user, and Google refuses everyone else before we are consulted at
all.

The session cookie is HMAC-SHA256 over the claims, `HttpOnly`, `SameSite=Lax`,
`Secure` on https, twelve hours by default. `SameSite=Strict` would break
sign-in, because the browser arrives at the callback from accounts.google.com.

## The audit log fails closed

Viewing donor records and exporting them only happen if the `admin_audit` row
can be written first. If that insert fails, the page shows an error and the
rows are not rendered. An audit log that quietly drops entries is worse than
none, because it reads as a complete account of who saw what.

Two paths are deliberately the other way round, through `recordAuditQuietly`:
sign-in and sign-out, where a failed write would lock the dashboard behind a
login that can never complete, and the audit page itself, which is the page you
need in order to discover that audit writes are failing.

Logged actions: `signin`, `signin_denied`, `signout`, `view_donations`,
`reveal_pan`, `export_csv`, `view_audit`. A retired `export_10bd` also appears
in older entries, from a Form 10BD export that was removed in November 2026.

## PAN and the export

PAN is masked to `AB****34F` by default. Revealing it is a separate request
that logs `reveal_pan`, rather than something the page hands over silently.

One export, "Download these rows". It honours whatever the filter bar is set
to and carries the whole donation row, PAN and address included.

It quotes cells and prefixes a `'` to any value starting with `=`, `+`, `-` or
`@`. Excel and Google Sheets execute such a cell when the file is opened, and
every name and address in this table was typed into a public form by someone
we do not know.

## Dates and the financial year

`ARCHITECTURE.md` explains under **Decisions** why every date in this project
is grouped through `Asia/Kolkata`. The admin is where that decision is most
visible.

The list filters on IST calendar days and the exports print IST, converting
through `Asia/Kolkata` on both bounds. The seed data contains a 02:00 IST
1 April donation precisely so this stays provable: if it ever shows up under
the previous financial year, the conversion has been dropped somewhere.

## The files

| Path | What it holds |
| --- | --- |
| `src/middleware.ts` | The gate. One place. |
| `src/lib/session.js` | Signed session cookie, state nonce, redirect safety |
| `src/lib/google-oauth.js` | Authorize URL, code exchange, `id_token` claims |
| `src/lib/admin.js` | Allowlist, audit writes, PAN masking and validation |
| `src/lib/donations.js` | Filters, paging, IST and rupee formatting |
| `src/pages/admin/login.astro` | Sign-in page and every refusal message |
| `src/pages/admin/index.astro` | Donations list |
| `src/pages/admin/audit.astro` | Audit log |
| `src/pages/api/admin/auth/` | Google start, callback, logout |
| `src/pages/api/admin/export.csv.js` | The CSV export |
| `src/layouts/AdminLayout.astro` | Admin chrome, no public styles |
| `src/styles/admin.css` | Admin stylesheet, separate on purpose |
| `scripts/manage-admins.js` | `npm run admins` |
| `db/seed-test.sql` | Fake donations for the `test` branch |

## When something is wrong

| Symptom | Likely cause |
| --- | --- |
| `/admin/login` says it is not set up | `GOOGLE_OAUTH_CLIENT_ID` or `GOOGLE_OAUTH_CLIENT_SECRET` missing from the environment. |
| Google returns `redirect_uri_mismatch` | The URI on the OAuth client does not match `PUBLIC_SITE_URL` plus `/api/admin/auth/google/callback`, byte for byte. A trailing slash counts. |
| "That Google account is not on the admin list" | No `admin_users` row, or `active = false`. Check which branch `DATABASE_URL` points at: `test` and `main` hold separate lists. |
| Google refuses before our page is reached | The consent screen is in Testing and that address is not a listed test user. |
| "That sign-in attempt expired or did not match" | The state cookie is gone: more than ten minutes passed, or cookies are blocked, or the sign-in started on a different host than it finished on. |
| Signed in, then bounced to login on the next click | The `admin_users` row was disabled or deleted. That is the gate working. |
| "This view was not shown" | The `admin_audit` insert failed. Donor rows are not rendered without one. Check the database, then `/admin/audit`, which is deliberately still readable. |
| Everyone is signed out after a deploy | `ADMIN_SESSION_SECRET` changed. Every existing cookie fails its signature check. |

What is deliberately not built yet, 80G receipt marking included, is listed
under **Not yet built** in `docs/ARCHITECTURE.md`.

