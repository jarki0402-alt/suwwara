/**
 * Resolves once the first profile sync of this session has finished (or failed). The daily/weekly mixes wait for it
 * before generating one, so a second device adopts the mix the first one already published instead of making its own.
 * Never blocks for long: callers race it against a short timeout.
 */
let markReady: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  markReady = resolve;
});

export const markProfileReady = (): void => markReady();

export function profileReady(timeoutMs = 1500): Promise<void> {
  return Promise.race([ready, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
}
