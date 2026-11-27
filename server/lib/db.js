import dotenv from "dotenv";
import { neon } from "@neondatabase/serverless";

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL.");
}

// Queries go over HTTP rather than a pooled TCP connection, so there is no
// pool to keep warm and nothing to tear down. This is also what lets the same
// data layer run unchanged if the backend moves to a serverless runtime.
export const sql = neon(databaseUrl);
