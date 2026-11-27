/**
 * Manage who can sign in to /admin.
 *
 * Google OAuth proves that someone controls an email address. The
 * admin_users table decides whether that address is allowed in, and this is
 * how rows get there. There is deliberately no screen in the dashboard for
 * granting access: adding an admin should take a deliberate act on a machine
 * with the connection string, not a click by whoever is already signed in.
 *
 *   npm run admins                              # list
 *   npm run admins -- add pat@example.com "Pat" # allow
 *   npm run admins -- disable pat@example.com   # revoke, keep the history
 *   npm run admins -- enable pat@example.com    # restore
 *   npm run admins -- remove pat@example.com    # delete the row
 *
 * Disable is usually the right revocation: the row stays, so the audit log
 * still has a name to attach to past entries. Either way the change takes
 * effect on that person's next page load, because src/middleware.ts reads
 * this table on every request.
 *
 * Env: DATABASE_URL. Check which branch it points at before adding anyone,
 * and remember the `test` and `main` branches hold separate admin lists.
 */
import dotenv from "dotenv";
import { db } from "../src/lib/db.js";

dotenv.config();

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL.");
  process.exit(1);
}

const [command = "list", rawEmail, rawName] = process.argv.slice(2);
const email = rawEmail ? rawEmail.trim().toLowerCase() : null;

/** Which database this is about to change. Worth printing every time. */
function target() {
  try {
    return new URL(process.env.DATABASE_URL).host;
  } catch {
    return "an unreadable DATABASE_URL";
  }
}

function needEmail() {
  if (!email) {
    console.error(`Usage: npm run admins -- ${command} <email>`);
    process.exit(1);
  }
  if (!EMAIL_SHAPE.test(email)) {
    console.error(`"${email}" does not look like an email address.`);
    process.exit(1);
  }
  return email;
}

async function list() {
  const sql = db();
  const rows = await sql.query(
    `select email, name, active, added_at, last_seen_at
       from admin_users order by active desc, email`,
  );

  if (rows.length === 0) {
    console.log("No admins. Nobody can sign in to /admin yet.");
    console.log(
      'Add the first one: npm run admins -- add you@example.com "Your Name"',
    );
    return;
  }

  console.log(`${rows.length} admin ${rows.length === 1 ? "row" : "rows"}:`);
  for (const row of rows) {
    const seen = row.last_seen_at
      ? new Date(row.last_seen_at).toISOString().slice(0, 16).replace("T", " ")
      : "never";
    console.log(
      `  ${row.active ? "allowed " : "disabled"}  ${row.email.padEnd(32)} ` +
        `${(row.name || "").padEnd(20)} last seen ${seen} UTC`,
    );
  }
}

async function add() {
  const sql = db();
  const name = rawName ? rawName.trim() : null;
  const rows = await sql.query(
    `insert into admin_users (email, name)
          values ($1, $2)
     on conflict (email) do update
            set name = coalesce(excluded.name, admin_users.name),
                active = true
      returning email, name, active`,
    [needEmail(), name],
  );
  const row = rows[0];
  console.log(
    `${row.email} can now sign in${row.name ? ` (${row.name})` : ""}.`,
  );
}

async function setActive(active) {
  const sql = db();
  const rows = await sql.query(
    "update admin_users set active = $2 where email = $1 returning email",
    [needEmail(), active],
  );
  if (rows.length === 0) {
    console.error(`${email} is not in admin_users.`);
    process.exit(1);
  }
  console.log(
    active
      ? `${email} can sign in again.`
      : `${email} is revoked, and loses access on their next page load.`,
  );
}

async function remove() {
  const sql = db();
  const rows = await sql.query(
    "delete from admin_users where email = $1 returning email",
    [needEmail()],
  );
  if (rows.length === 0) {
    console.error(`${email} is not in admin_users.`);
    process.exit(1);
  }
  console.log(
    `${email} deleted. Past audit entries keep the address, but there is no ` +
      `row to attach a name to any more; disable is usually better.`,
  );
}

const COMMANDS = {
  list,
  add,
  enable: () => setActive(true),
  disable: () => setActive(false),
  remove,
};

const run = COMMANDS[command];
if (!run) {
  console.error(`Unknown command "${command}".`);
  console.error("Try: list, add, enable, disable, remove");
  process.exit(1);
}

console.log(`Database: ${target()}`);

try {
  await run();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
