import postgres from 'postgres';
import { SCHEMA_SQL } from './schema';

// Built from discrete PG* fields (not a single postgres://user:pass@host URL) —
// a password containing URL-reserved characters (#, %, @, etc.) silently breaks
// URL parsing before it ever reaches Postgres. Passing an options object instead
// sidesteps that entirely, regardless of what characters end up in the password.
const host = process.env.PGHOST;
const password = process.env.PGPASSWORD;
if (!host || !password) {
  throw new Error('PGHOST/PGPASSWORD are not set — the backend now requires Postgres (see docker-compose.yml).');
}

export const sql = postgres({
  host,
  port: Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || 'suwwara',
  username: process.env.PGUSER || 'suwwara',
  password,
  max: 5,
});

/** Applies SCHEMA_SQL (idempotent CREATE TABLE IF NOT EXISTS) — called once at boot in index.ts. */
export async function migrate(): Promise<void> {
  await sql.unsafe(SCHEMA_SQL);
}
