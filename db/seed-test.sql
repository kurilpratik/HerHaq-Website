-- Fake donations for the Neon `test` branch, so the admin dashboard has
-- something to render and its filters, pagination and financial-year grouping
-- can actually be exercised.
--
--   psql "$DATABASE_URL" -f db/seed-test.sql
--
-- NEVER run this against `main`. Check which branch the connection string
-- points at first; docs/ARCHITECTURE.md has the table.
--
-- Deterministic: every value derives from the row number, so re-running
-- produces the same data. Every seeded row's order_id starts DON_SEED_ and the
-- script deletes those first, so it is safe to re-run and cannot touch a real
-- donation (real ids are DON_<epoch_ms>_<n>).

begin;

delete from donations where order_id like 'DON_SEED_%';

-- 80 rows from May 2025 to November 2026, one every ~7 days, so the set spans
-- the 1 April financial-year boundary and two reporting years.
insert into donations (
  order_id, name, email, phone, amount,
  address, pan, nationality, country,
  status, txn_id, created_at, updated_at
)
select
  'DON_SEED_' || lpad(n::text, 4, '0'),
  nm,
  lower(replace(nm, ' ', '.')) || '@example.com',
  '9' || lpad(((n * 8675309) % 1000000000)::text, 9, '0'),
  amt,
  -- one row in five has no address at all, which is what makes it unreceiptable
  case when n % 5 = 0 then null
       else street || ', ' || city || ' ' || (110001 + (n * 37) % 800)::text
  end,
  case
    -- the form only asks for PAN above 2,000 rupees
    when amt < 2000 and n % 3 = 0 then null
    -- one deliberately malformed PAN: eight characters, wrong shape. The
    -- client-side regex is /^[A-Z0-9]+$/, which accepts this.
    when n = 17 then 'ABCD1234'
    else chr(65 + n % 26) || chr(65 + (n * 3) % 26) || chr(65 + (n * 7) % 26)
      || chr(65 + (n * 11) % 26) || chr(65 + (n * 5) % 26)
      || lpad(((n * 1234) % 10000)::text, 4, '0')
      || chr(65 + (n * 13) % 26)
  end,
  'Indian',
  'India',
  st,
  case when st = 'TXN_SUCCESS'
       then '2026' || lpad((100000 + n)::text, 11, '0')
       else null end,
  ts, ts
from (
  select
    n,
    (array[
      'Aarav Sharma','Priya Nair','Rohan Mehta','Ananya Iyer','Imran Qureshi',
      'Kavya Reddy','Siddharth Bose','Meera Pillai','Arjun Kulkarni','Fatima Shaikh',
      'Nikhil Verma','Sanya Chopra','Vikram Rao','Tanvi Deshpande','Aditya Menon',
      'Ishita Ghosh','Rahul Joshi','Neha Bhatt','Karan Malhotra','Divya Krishnan'
    ])[1 + n % 20] as nm,
    (array[
      '12 MG Road','44 Civil Lines','7 Park Street','221 Shivaji Nagar','9 Anna Salai'
    ])[1 + n % 5] as street,
    (array[
      'Delhi','Mumbai','Pune','Chennai','Bengaluru','Kolkata','Jaipur','Lucknow'
    ])[1 + n % 8] as city,
    (array[100, 250, 500, 1000, 1500, 2100, 2500, 5000, 7500, 11000])[1 + (n * 7) % 10] as amt,
    -- roughly the real distribution the reconciler found: ~65% success
    (array[
      'TXN_SUCCESS','TXN_SUCCESS','TXN_SUCCESS','TXN_SUCCESS','TXN_SUCCESS',
      'TXN_SUCCESS','TXN_SUCCESS','TXN_SUCCESS','TXN_SUCCESS','TXN_SUCCESS',
      'TXN_SUCCESS','TXN_SUCCESS','TXN_SUCCESS','TXN_FAILURE','TXN_FAILURE',
      'TXN_FAILURE','TXN_FAILURE','INITIATED','PENDING','UNKNOWN'
    ])[1 + (n * 3) % 20] as st,
    timestamptz '2025-05-02 09:15:00+05:30' + (n * interval '7 days 3 hours 11 minutes') as ts
  from generate_series(1, 80) as n
) generated;

-- Edge cases worth having on hand, each one a thing that has or could bite.

-- 02:00 IST on 1 April 2026 is 20:30 UTC on 31 March. Grouped in UTC this
-- lands in the wrong financial year and the wrong tax filing; grouped in IST
-- it is the first donation of FY 2026-27. If the dashboard ever shows this in
-- 2025-26, the `at time zone 'Asia/Kolkata'` conversion has been dropped.
insert into donations (order_id, name, email, phone, amount, address, pan, nationality, country, status, txn_id, created_at, updated_at)
values
  ('DON_SEED_FY_FIRST', 'Lakshmi Subramanian', 'lakshmi.s@example.com', '9810000001', 3000,
   '18 Besant Nagar, Chennai 600090', 'AKLPS4821M', 'Indian', 'India',
   'TXN_SUCCESS', '20260000000900001', '2026-03-31 20:30:00+00', '2026-03-31 20:30:00+00'),

  -- 23:30 IST on 31 March 2026: the last donation of FY 2025-26, and the pair
  -- to the row above. The two are four and a half hours apart and belong to
  -- different financial years.
  ('DON_SEED_FY_LAST', 'Gaurav Saxena', 'gaurav.saxena@example.com', '9810000002', 2500,
   '3 Hazratganj, Lucknow 226001', 'BKTPS9034L', 'Indian', 'India',
   'TXN_SUCCESS', '20260000000900002', '2026-03-31 18:00:00+00', '2026-03-31 18:00:00+00'),

  -- A double-click pair: same donor, two order ids eleven seconds apart, both
  -- stranded in INITIATED. This is the shape the November 2026 button bug left
  -- in the data, and what to look for before reading the abandonment rate as
  -- donor behaviour.
  ('DON_SEED_DUP_A', 'Sneha Pandey', 'sneha.pandey@example.com', '9810000003', 1000,
   '88 Gomti Nagar, Lucknow 226010', null, 'Indian', 'India',
   'INITIATED', null, '2026-07-14 05:21:04+00', '2026-07-14 05:21:04+00'),
  ('DON_SEED_DUP_B', 'Sneha Pandey', 'sneha.pandey@example.com', '9810000003', 1000,
   '88 Gomti Nagar, Lucknow 226010', null, 'Indian', 'India',
   'INITIATED', null, '2026-07-14 05:21:15+00', '2026-07-14 05:21:15+00'),

  -- The worst case for Form 10BD: a large successful donation with neither
  -- address nor PAN, so it cannot be receipted as recorded.
  ('DON_SEED_NO_80G', 'Mohammed Ashraf', 'm.ashraf@example.com', '9810000004', 25000,
   null, null, 'Indian', 'India',
   'TXN_SUCCESS', '20260000000900004', '2026-09-02 11:45:00+00', '2026-09-02 11:45:00+00'),

  -- An apostrophe and a non-ASCII character, because both end up in CSV
  -- exports and in HTML.
  ('DON_SEED_QUOTES', 'Zoya D''Souza-Fernandes', 'zoya.dsouza@example.com', '9810000005', 5100,
   'Flat 2B, "Sea Breeze", Bandra, Mumbai 400050', 'CQRPD1178K', 'Indian', 'India',
   'TXN_SUCCESS', '20260000000900005', '2026-10-19 14:02:00+00', '2026-10-19 14:02:00+00'),

  -- A foreign donor: not eligible for 80G, and a reminder that `country` is
  -- free text collected from the form.
  ('DON_SEED_FOREIGN', 'Helen Whitcombe', 'helen.w@example.com', '447700900123', 8000,
   '14 Marlborough Road, London', null, 'British', 'United Kingdom',
   'TXN_SUCCESS', '20260000000900006', '2026-11-08 08:30:00+00', '2026-11-08 08:30:00+00');

commit;

-- A name shaped like a spreadsheet formula, with a comma and a quote in it.
-- Donor names come from a public form, and Excel and Sheets execute a cell
-- beginning with = + - or @ the moment the CSV is opened. The export guards
-- this; this row is how you check that it still does.
insert into donations (order_id, name, email, phone, amount, address, pan, nationality, country, status, txn_id, created_at, updated_at)
values
  ('DON_SEED_CSV_INJ', '=HYPERLINK("http://evil.example","Click"), "quoted"', 'csv.test@example.com', '9810000007', 1100,
   '=1+1, Delhi', null, 'Indian', 'India',
   'TXN_SUCCESS', '20260000000900007', '2026-11-10 09:00:00+00', '2026-11-10 09:00:00+00');
