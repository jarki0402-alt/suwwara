import { randomUUID } from 'node:crypto';
import { sql } from '../db/client';
import { generatePassword, hashPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, USERNAME_PATTERN } from './password';

export function normalizeUsername(raw: unknown): string | null {
  const username = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return USERNAME_PATTERN.test(username) ? username : null;
}

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) return `Kata sandi minimal ${MIN_PASSWORD_LENGTH} karakter.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Kata sandi maksimal ${MAX_PASSWORD_LENGTH} karakter.`;
  return null;
}

export class UsernameTakenError extends Error {}

/** A new account with its user. `accountId` lets bootstrap attach the admin to an account that already has data. */
export async function createUser(params: { username: string; password: string; role?: 'admin' | 'user'; mustChangePassword?: boolean; accountId?: string }): Promise<string> {
  const accountId = params.accountId ?? randomUUID();
  const passwordHash = await hashPassword(params.password);
  try {
    await sql.begin(async (tx) => {
      await tx`insert into accounts (id) values (${accountId}) on conflict do nothing`;
      await tx`
        insert into users (account_id, username, password_hash, role, must_change_password)
        values (${accountId}, ${params.username}, ${passwordHash}, ${params.role ?? 'user'}, ${params.mustChangePassword ?? true})
      `;
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new UsernameTakenError();
    throw error;
  }
  return accountId;
}

/**
 * First boot with login switched on: there is nobody who could sign in, so the admin is created here. It attaches to the
 * existing account with the biggest library — the owner's own, with their playlists — instead of an empty new one.
 * Credentials come from ADMIN_USERNAME / ADMIN_PASSWORD; without a password one is generated and printed once.
 */
export async function bootstrapAdmin(): Promise<void> {
  const [{ count }] = await sql<{ count: string }[]>`select count(*) from users`;
  if (Number(count) > 0) return;

  const username = normalizeUsername(process.env.ADMIN_USERNAME ?? 'admin') ?? 'admin';
  const configured = process.env.ADMIN_PASSWORD;
  const generated = !configured || passwordProblem(configured) !== null;
  const password = generated ? generatePassword() : configured;

  const [biggest] = await sql<{ account_id: string }[]>`
    select account_id from library_snapshots
    order by jsonb_array_length(liked_songs) + jsonb_array_length(playlists) desc, updated_at desc limit 1
  `;
  await createUser({ username, password, role: 'admin', mustChangePassword: generated, accountId: biggest?.account_id });

  // eslint-disable-next-line no-console
  console.log(
    generated
      ? `[auth] Admin "${username}" created. Temporary password (shown once, must be changed at first sign-in): ${password}`
      : `[auth] Admin "${username}" created from ADMIN_USERNAME / ADMIN_PASSWORD.`,
  );
}
