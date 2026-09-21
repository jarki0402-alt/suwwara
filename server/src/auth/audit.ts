import { sql } from '../db/client';

const KEEP_DAYS = 90;

/** Fire-and-forget: a failure to write the log must never fail the request it describes. */
export function audit(event: string, fields: { accountId?: string | null; username?: string | null; ip?: string | null; detail?: string | null } = {}): void {
  void sql`
    insert into audit_log (event, account_id, username, ip, detail)
    values (${event}, ${fields.accountId ?? null}, ${fields.username ?? null}, ${fields.ip ?? null}, ${fields.detail ?? null})
  `.catch(() => {});
}

/** Called at start and daily: old log rows and expired sessions do not accumulate (CLAUDE.md rule 1, in the database). */
export async function pruneAuthTables(): Promise<void> {
  try {
    await sql`delete from audit_log where at < now() - make_interval(days => ${KEEP_DAYS})`;
    await sql`delete from sessions where expires_at < now()`;
  } catch {
    // best-effort
  }
}
setInterval(() => void pruneAuthTables(), 24 * 60 * 60 * 1000).unref();
