import postgres from 'postgres';
import { SCHEMA_SQL } from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set — the backend now requires Postgres (see docker-compose.yml).');
}

export const sql = postgres(connectionString, { max: 5 });

/** Applies SCHEMA_SQL (idempotent CREATE TABLE IF NOT EXISTS) — called once at boot in index.ts. */
export async function migrate(): Promise<void> {
  await sql.unsafe(SCHEMA_SQL);
}
