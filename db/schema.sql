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
