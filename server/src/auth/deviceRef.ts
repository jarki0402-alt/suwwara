import { createHash } from 'node:crypto';

/** A device id is a credential, so it never leaves the server. Clients see this stable, non-reversible reference instead. */
export function deviceRef(deviceId: string): string {
  return createHash('sha256').update(deviceId).digest('hex').slice(0, 12);
}

/** The device id from `Authorization: Bearer <id>` (deviceAuth has already validated it exists). */
export function bearerDeviceId(req: { headers: { authorization?: string } }): string {
  return (req.headers.authorization ?? '').slice('Bearer '.length).trim();
}
