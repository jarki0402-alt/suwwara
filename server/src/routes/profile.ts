import { Router } from 'express';
import { sql } from '../db/client';
import { mergeProfile, sanitizeProfile, type Profile } from '../library/profileMerge';

export const profileRouter = Router();

async function load(accountId: string): Promise<Profile> {
  const [row] = await sql<{ history: unknown; cleared_at: string; weekly: unknown; daily: unknown }[]>`
    select history, cleared_at, weekly, daily from profiles where account_id = ${accountId}
  `;
  return sanitizeProfile(row ? { history: row.history, clearedAt: Number(row.cleared_at), weekly: row.weekly, daily: row.daily } : {});
}

profileRouter.get('/profile', async (req, res) => {
  try {
    res.json(await load(req.session!.accountId));
  } catch (error) {
    res.status(502).json({ error: 'Failed to load the profile.', message: (error as Error).message });
  }
});

/** Merges what this device knows into the account's profile and answers with the result, which the device then adopts. */
profileRouter.put('/profile', async (req, res) => {
  const accountId = req.session!.accountId;
  try {
    const merged = mergeProfile(await load(accountId), sanitizeProfile(req.body));
    await sql`
      insert into profiles (account_id, history, cleared_at, weekly, daily, updated_at)
      values (${accountId}, ${sql.json(merged.history as never)}, ${merged.clearedAt}, ${merged.weekly ? sql.json(merged.weekly as never) : null}, ${merged.daily ? sql.json(merged.daily as never) : null}, now())
      on conflict (account_id) do update set history = excluded.history, cleared_at = excluded.cleared_at,
        weekly = excluded.weekly, daily = excluded.daily, updated_at = now()
    `;
    res.json(merged);
  } catch (error) {
    res.status(502).json({ error: 'Failed to save the profile.', message: (error as Error).message });
  }
});
