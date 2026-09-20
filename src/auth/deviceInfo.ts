export interface DeviceInfo {
  name: string;
  kind: 'phone' | 'tablet' | 'desktop';
}

/** A human name for this device, derived from what the browser reveals — shown in Settings -> Perangkat. */
export function describeThisDevice(): DeviceInfo {
  const ua = navigator.userAgent;
  const isIPad = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (/iPhone|iPod/.test(ua)) return { name: 'iPhone', kind: 'phone' };
  if (isIPad) return { name: 'iPad', kind: 'tablet' };
  if (/Android/.test(ua)) return { name: /Mobile/.test(ua) ? 'Android' : 'Tablet Android', kind: /Mobile/.test(ua) ? 'phone' : 'tablet' };

  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Komputer';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return { name: browser ? `${os} (${browser})` : os, kind: 'desktop' };
}
