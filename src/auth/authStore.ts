import { create } from 'zustand';
import { clearRuntimeCaches } from '../pwa/storageEstimate';
import { checkSession, requestLogin, requestLogout, requestPasswordChange, type ActionResult, type AuthUser } from './authApi';

export type AuthStatus = 'checking' | 'signed-out' | 'signed-in';

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  /** True when the server could not be reached and the app is showing what this device already knew. */
  offline: boolean;
}

export const useAuthStore = create<AuthState>(() => ({ status: 'checking', user: null, offline: false }));

// The last user this device knew, so a device that starts offline still opens (and so a DIFFERENT user signing in
// here is noticed — see signIn).
const LAST_USER_KEY = 'suwwara-last-user';
const KEEP_KEYS = new Set(['suwwara-settings', 'suwwara-device-id', LAST_USER_KEY]);

function readLastUser(): AuthUser | null {
  try {
    return JSON.parse(localStorage.getItem(LAST_USER_KEY) ?? 'null') as AuthUser | null;
  } catch {
    return null;
  }
}

function writeLastUser(user: AuthUser): void {
  try {
    localStorage.setItem(LAST_USER_KEY, JSON.stringify({ username: user.username, role: user.role, mustChangePassword: false }));
  } catch {
    // private mode — only costs the offline start
  }
}

/**
 * Everything that belongs to the person, not the device: library, queue, history, mixes, Jam. Device settings (cache
 * limit, data saver, volume, theme) and the device id stay. Without this, signing in as someone else on the same browser
 * would merge the previous person's playlists into the new account through library sync.
 */
function wipeLocalUserData(): void {
  try {
    for (const key of Object.keys(localStorage)) if (!KEEP_KEYS.has(key)) localStorage.removeItem(key);
  } catch {
    // nothing to wipe
  }
}

async function resetAndReload(): Promise<void> {
  wipeLocalUserData();
  await clearRuntimeCaches().catch(() => {});
  window.location.reload();
}

/** Called once at start: asks the server who this browser is. */
export async function initAuth(): Promise<void> {
  const check = await checkSession();
  if (check.kind === 'signed-in') {
    writeLastUser(check.user);
    useAuthStore.setState({ status: 'signed-in', user: check.user, offline: false });
  } else if (check.kind === 'signed-out') {
    useAuthStore.setState({ status: 'signed-out', user: null, offline: false });
  } else {
    const known = readLastUser();
    useAuthStore.setState(known ? { status: 'signed-in', user: known, offline: true } : { status: 'signed-out', user: null, offline: true });
  }
}

export async function signIn(username: string, password: string): Promise<ActionResult> {
  const result = await requestLogin(username, password);
  if (!result.ok || !result.user) return result;
  const previous = readLastUser();
  if (previous && previous.username !== result.user.username) {
    writeLastUser(result.user);
    await resetAndReload(); // a different person: start clean rather than merge someone else's data in
    return result;
  }
  writeLastUser(result.user);
  useAuthStore.setState({ status: 'signed-in', user: result.user, offline: false });
  return result;
}

export async function changePassword(current: string, next: string): Promise<ActionResult> {
  const result = await requestPasswordChange(current, next);
  if (result.ok && result.user) useAuthStore.setState({ user: result.user });
  return result;
}

export async function signOut(): Promise<void> {
  await requestLogout();
  try {
    localStorage.removeItem(LAST_USER_KEY);
  } catch {
    // ignore
  }
  await resetAndReload();
}

/** An API answered 401: the session is gone (expired, revoked, disabled). Back to the sign-in page; nothing is wiped. */
export function notifyUnauthorized(status: number): void {
  if (status === 401 && useAuthStore.getState().status === 'signed-in') useAuthStore.setState({ status: 'signed-out', offline: false });
}
