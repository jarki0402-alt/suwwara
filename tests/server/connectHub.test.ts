// Imports backend code (server/src) — see the note in tests/server/priorityLimiter.test.ts.
import { describe, expect, it } from 'vitest';
import type { Response } from 'express';
import { connectDevice, notifyLibraryChanged, sendCommand, updateDeviceState, type DeviceState } from '../../server/src/connect/connectHub';

/** A stand-in for an SSE response that just records what was written and whether it was ended. */
function fakeResponse() {
  const writes: string[] = [];
  let ended = false;
  const res = { write: (chunk: string) => (writes.push(chunk), true), end: () => void (ended = true) } as unknown as Response;
  return { res, writes, isEnded: () => ended };
}

const playing = (song = 's1'): DeviceState => ({ song: { id: song, name: song, artist: 'A', image: '' }, isPlaying: true, positionSec: 0, durationSec: 200, volume: 1, canSetVolume: true, followingRef: null, inJam: false });
const commandsIn = (writes: string[]) => writes.filter((chunk) => chunk.startsWith('event: command')).map((chunk) => JSON.parse(chunk.split('data: ')[1]));

let account = 0;
const newAccount = () => `acct-${(account += 1)}`;

describe('connectHub', () => {
  it('lets one device command another and refuses a device that is offline', () => {
    const id = newAccount();
    const phone = fakeResponse();
    connectDevice(id, 'phone', 'iPhone', 'phone', phone.res);
    connectDevice(id, 'mac', 'Mac', 'desktop', fakeResponse().res);

    expect(sendCommand(id, 'mac', 'phone', 'pause', null)).toBe(true);
    expect(commandsIn(phone.writes)).toEqual([{ from: 'mac', type: 'pause', payload: null }]);
    expect(sendCommand(id, 'mac', 'nobody', 'pause', null)).toBe(false);
  });

  it('never delivers a command across accounts', () => {
    const a = newAccount();
    const b = newAccount();
    const other = fakeResponse();
    connectDevice(a, 'x', 'X', 'desktop', fakeResponse().res);
    connectDevice(b, 'y', 'Y', 'desktop', other.res);
    expect(sendCommand(a, 'x', 'y', 'pause', null)).toBe(false);
    expect(commandsIn(other.writes)).toEqual([]);
  });

  it('pauses the device that was playing when another one starts (one device plays at a time)', () => {
    const id = newAccount();
    const phone = fakeResponse();
    connectDevice(id, 'phone', 'iPhone', 'phone', phone.res);
    connectDevice(id, 'mac', 'Mac', 'desktop', fakeResponse().res);

    updateDeviceState(id, 'phone', playing('a'));
    expect(commandsIn(phone.writes)).toEqual([]);

    updateDeviceState(id, 'mac', playing('b'));
    expect(commandsIn(phone.writes)).toEqual([{ from: 'mac', type: 'pause', payload: { reason: 'takeover' } }]);
  });

  it('does not fire the takeover again for a device that is merely still playing', () => {
    const id = newAccount();
    const phone = fakeResponse();
    connectDevice(id, 'phone', 'iPhone', 'phone', phone.res);
    connectDevice(id, 'mac', 'Mac', 'desktop', fakeResponse().res);
    updateDeviceState(id, 'phone', playing('a'));
    updateDeviceState(id, 'mac', playing('b'));
    updateDeviceState(id, 'mac', playing('b')); // a heartbeat, not a new start
    expect(commandsIn(phone.writes)).toHaveLength(1);
  });

  it('keeps the device asked to play most recently when a stale one wakes up still "playing"', () => {
    const id = newAccount();
    const phone = fakeResponse();
    const tablet = fakeResponse();
    connectDevice(id, 'phone', 'Android', 'phone', phone.res);
    connectDevice(id, 'tablet', 'Tablet', 'tablet', tablet.res);

    updateDeviceState(id, 'phone', { ...playing('a'), playIntentAgeMs: 0 });
    updateDeviceState(id, 'tablet', { ...playing('b'), playIntentAgeMs: 0 }); // tapped on the tablet: phone told to pause
    expect(commandsIn(phone.writes)).toHaveLength(1);

    // The phone, frozen meanwhile, wakes and reports playing again: its ask is ten minutes old.
    updateDeviceState(id, 'phone', { ...playing('a'), playIntentAgeMs: 600_000 });
    expect(commandsIn(tablet.writes)).toEqual([]);
    expect(commandsIn(phone.writes)).toHaveLength(2);
  });

  it('treats a reconnect that lost its state as the same old ask, not a new start', () => {
    const id = newAccount();
    const tablet = fakeResponse();
    connectDevice(id, 'tablet', 'Tablet', 'tablet', tablet.res);
    updateDeviceState(id, 'tablet', { ...playing('b'), playIntentAgeMs: 5_000 });
    // A phone whose stream dropped and reopened (state gone) and that was last asked to play an hour ago.
    connectDevice(id, 'phone', 'Android', 'phone', fakeResponse().res);
    updateDeviceState(id, 'phone', { ...playing('a'), playIntentAgeMs: 3_600_000 });
    expect(commandsIn(tablet.writes)).toEqual([]);
  });

  it('pauses the older device when someone really does start on another one', () => {
    const id = newAccount();
    const tablet = fakeResponse();
    connectDevice(id, 'tablet', 'Tablet', 'tablet', tablet.res);
    connectDevice(id, 'phone', 'Android', 'phone', fakeResponse().res);
    updateDeviceState(id, 'tablet', { ...playing('b'), playIntentAgeMs: 60_000 });
    updateDeviceState(id, 'phone', { ...playing('a'), playIntentAgeMs: 10 });
    expect(commandsIn(tablet.writes)).toEqual([{ from: 'phone', type: 'pause', payload: { reason: 'takeover' } }]);
  });

  it('replaces a device that reconnects and caps how many streams one account can hold', () => {
    const id = newAccount();
    const first = fakeResponse();
    connectDevice(id, 'phone', 'iPhone', 'phone', first.res);
    connectDevice(id, 'phone', 'iPhone', 'phone', fakeResponse().res);
    expect(first.isEnded()).toBe(true);

    const streams = Array.from({ length: 10 }, (_, index) => fakeResponse());
    streams.forEach((stream, index) => connectDevice(id, `d${index}`, `D${index}`, 'desktop', stream.res));
    expect(streams.filter((stream) => stream.isEnded()).length).toBeGreaterThan(0); // the oldest were dropped
  });

  it('tells the account\'s other devices about a library change, but not the one that made it', () => {
    const id = newAccount();
    const phone = fakeResponse();
    const mac = fakeResponse();
    connectDevice(id, 'phone', 'iPhone', 'phone', phone.res);
    connectDevice(id, 'mac', 'Mac', 'desktop', mac.res);
    notifyLibraryChanged(id, 'mac', 7);
    expect(phone.writes.some((chunk) => chunk.startsWith('event: library') && chunk.includes('"version":7'))).toBe(true);
    expect(mac.writes.some((chunk) => chunk.startsWith('event: library'))).toBe(false);
  });
});
