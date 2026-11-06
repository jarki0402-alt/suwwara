import type { Dictionary } from '../i18n';

/**
 * English for the server area: the Indonesian `message`s the backend sends (server/src/routes/session.ts,
 * server/src/auth/*.ts), translated on the client (src/auth/authApi.ts SERVER_MESSAGES). Key = the server's text exactly.
 */
export const server: Dictionary = {
  'Silakan masuk dulu.': 'Please sign in first.',
  'Layanan sedang tidak tersedia.': 'The service is unavailable right now.',
  'Layanan sedang tidak tersedia. Coba lagi sebentar.': 'The service is unavailable right now. Try again in a moment.',
  'Ganti kata sandi sementara dulu.': 'Change your temporary password first.',
  'Khusus admin.': 'Admins only.',
  'Isi nama pengguna dan kata sandi.': 'Enter your username and password.',
  'Nama pengguna atau kata sandi salah.': 'Wrong username or password.',
  'Kata sandi saat ini salah.': 'The current password is wrong.',
  'Terlalu banyak percobaan. Coba lagi dalam {n} menit.': { one: 'Too many attempts. Try again in {n} minute.', other: 'Too many attempts. Try again in {n} minutes.' },
  'Kata sandi minimal {n} karakter.': 'The password needs at least {n} characters.',
  'Kata sandi maksimal {n} karakter.': 'The password can have at most {n} characters.',
};
