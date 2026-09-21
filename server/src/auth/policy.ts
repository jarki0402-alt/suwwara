/**
 * What differs between an admin account and an ordinary one. The admin can do everything, is signed in on few devices and
 * rarely, so it gets the stricter rules: a shorter session and a longer password. Pure, so it is tested without a database.
 */
export type Role = 'admin' | 'user';

export const SESSION_DAYS: Record<Role, number> = { admin: 7, user: 90 };
export const MIN_PASSWORD_LENGTH: Record<Role, number> = { admin: 12, user: 8 };
export const MAX_PASSWORD_LENGTH = 128;

export function passwordProblem(password: unknown, role: Role): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH[role]) return `Kata sandi minimal ${MIN_PASSWORD_LENGTH[role]} karakter.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Kata sandi maksimal ${MAX_PASSWORD_LENGTH} karakter.`;
  return null;
}
