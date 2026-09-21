import { randomUUID } from 'node:crypto';
import { sql } from '../db/client';
import { generatePassword, hashPassword, USERNAME_PATTERN } from './password';
import { passwordProblem } from './policy';

export function normalizeUsername(raw: unknown): string | null {
  const username = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return USERNAME_PATTERN.test(username) ? username : null;
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
 * First boot with login switched on: there is nobody who could sign in, so the admin is created here — an account of its
 * own, EMPTY, that opens the admin console and cannot play music. Whoever also listens gets a separate ordinary account,
 * which the admin creates (adopting the pre-login library if there is one — see the legacy accounts in routes/admin.ts).
 * Credentials come from ADMIN_USERNAME / ADMIN_PASSWORD (12+ characters for an admin); without a usable password one is
 * generated and printed once.
 */
export async function bootstrapAdmin(): Promise<void> {
  const [{ count }] = await sql<{ count: string }[]>`select count(*) from users`;
  if (Number(count) > 0) return;

  const username = normalizeUsername(process.env.ADMIN_USERNAME ?? 'admin') ?? 'admin';
  const configured = process.env.ADMIN_PASSWORD;
  const problem = configured ? passwordProblem(configured, 'admin') : null;
  const generated = !configured || problem !== null;
  const password = generated ? generatePassword() : configured;

  await createUser({ username, password, role: 'admin', mustChangePassword: generated });

  if (configured && problem) {
    // eslint-disable-next-line no-console
    console.warn(`[auth] ADMIN_PASSWORD ignored: ${problem}`);
  }
  // eslint-disable-next-line no-console
  console.log(
    generated
      ? `[auth] Admin "${username}" created. Temporary password (shown once, must be changed at first sign-in): ${password}`
      : `[auth] Admin "${username}" created from ADMIN_USERNAME / ADMIN_PASSWORD.`,
  );
}
