#!/usr/bin/env bash
# Sets a new password for ANY user from the server itself — the way back in when the admin password is forgotten
# (there is no email reset). Signs that user out everywhere and makes them choose a new password at next sign-in.
#   ./scripts/reset-admin-password.sh                # user "admin"
#   ./scripts/reset-admin-password.sh fajar          # another username
# Prints the temporary password once.
set -euo pipefail

cd "$(dirname "$0")/.."
USERNAME="${1:-admin}"

docker compose exec -T -e RESET_USER="$USERNAME" backend node -e "
const { sql } = require('./dist/db/client');
const { generatePassword, hashPassword } = require('./dist/auth/password');
(async () => {
  const username = process.env.RESET_USER.trim().toLowerCase();
  const [user] = await sql\`select account_id from users where username = \${username}\`;
  if (!user) { console.error('Tidak ada pengguna bernama \"' + username + '\".'); process.exit(1); }
  const password = generatePassword();
  await sql\`update users set password_hash = \${await hashPassword(password)}, must_change_password = true, disabled = false where account_id = \${user.account_id}\`;
  await sql\`delete from sessions where account_id = \${user.account_id}\`;
  console.log('Kata sandi sementara untuk \"' + username + '\": ' + password);
  console.log('Masuk dengan itu; kamu akan diminta menggantinya. Semua perangkat pengguna ini dikeluarkan.');
  process.exit(0);
})().catch((error) => { console.error(error.message); process.exit(1); });
"
