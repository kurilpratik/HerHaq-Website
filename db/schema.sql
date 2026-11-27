-- Her Haq donations schema (Neon / Postgres)
--
-- Mirrors the original Supabase schema, which was created by hand in the
-- dashboard and never checked in. Apply with:
--   psql "$DATABASE_URL" -f server/db/schema.sql

create table if not exists donations (
  id              uuid          primary key default gen_random_uuid(),

  -- our reference, sent to Paytm as orderId
  order_id        text          not null unique,

  -- donor details collected by the form
  name            text          not null,
  email           text          not null,
  phone           text          not null,
  amount          numeric(12, 2) not null check (amount > 0),
  address         text,
  pan             text,
  nationality     text,
  country         text,

  -- lifecycle: INITIATED on handoff to Paytm, then Paytm's resultStatus
  -- (TXN_SUCCESS / TXN_FAILURE / PENDING / UNKNOWN) once the callback lands
  status          text          not null default 'INITIATED',
  txn_id          text,
  paytm_response  jsonb,

  -- tightened from the Supabase original, where both were nullable; every
  -- migrated row had values and the app always sets them
  created_at      timestamptz   not null default now(),
  updated_at      timestamptz   not null default now()
);

-- order_id already has a unique index; these cover the reporting reads
create index if not exists donations_created_at_idx on donations (created_at desc);
create index if not exists donations_status_idx     on donations (status);

-- carried over from Supabase, where it existed as a view
create or replace view successful_donations as
  select * from donations where status = 'TXN_SUCCESS';

-- ---------------------------------------------------------------------------
-- Admin dashboard
-- ---------------------------------------------------------------------------

-- Who may sign in to /admin. Google OAuth proves someone controls an email
-- address; this table decides whether that address is allowed in. Sign-in is
-- refused for any address absent here, so adding an admin is a deliberate
-- database write rather than a config change.
--
-- Emails are stored lowercase. Google returns them lowercase for Gmail, but
-- Workspace domains can return mixed case, and a case-sensitive primary key
-- would silently let the same person in twice.
create table if not exists admin_users (
  email         text          primary key check (email = lower(email)),
  name          text,
  active        boolean       not null default true,
  added_at      timestamptz   not null default now(),
  last_seen_at  timestamptz
);

-- Every view of donor data and every export, including refused sign-ins.
--
-- Donor rows carry name, email, phone, address and PAN; this is the record of
-- who looked at them. Append-only by convention -- nothing in the application
-- updates or deletes from here.
create table if not exists admin_audit (
  id            bigserial     primary key,
  admin_email   text,
  action        text          not null,
  detail        jsonb,
  row_count     integer,
  ip            text,
  user_agent    text,
  created_at    timestamptz   not null default now()
);

create index if not exists admin_audit_created_at_idx on admin_audit (created_at desc);
create index if not exists admin_audit_email_idx      on admin_audit (admin_email);

-- The donations list filters on status and orders by created_at (both already
-- indexed) and searches name, email and order_id. This covers the search.
create index if not exists donations_email_idx on donations (lower(email));
create index if not exists donations_name_idx  on donations (lower(name));
