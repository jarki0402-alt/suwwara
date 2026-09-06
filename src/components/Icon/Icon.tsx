export type IconName =
  | 'play'
  | 'pause'
  | 'next'
  | 'previous'
  | 'shuffle'
  | 'repeat'
  | 'repeat-one'
  | 'heart'
  | 'heart-filled'
  | 'search'
  | 'home'
  | 'library'
  | 'settings'
  | 'queue'
  | 'close'
  | 'chevron-down'
  | 'chevron-up'
  | 'chevron-left'
  | 'more'
  | 'plus'
  | 'trash'
  | 'volume'
  | 'volume-mute'
  | 'wifi-off'
  | 'check'
  | 'refresh'
  | 'pulse'
  | 'theme'
  | 'grip'
  | 'clock'
  | 'database'
  | 'download'
  | 'spinner';

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

function IconPaths({ name }: { name: IconName }) {
  switch (name) {
    case 'play':
      return <polygon points="8,5 19,12 8,19" fill="currentColor" />;
    case 'pause':
      return (
        <>
          <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
          <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
        </>
      );
    case 'next':
      return (
        <>
          <polygon points="5,4 15,12 5,20" fill="currentColor" />
          <rect x="17" y="4" width="2.5" height="16" fill="currentColor" />
        </>
      );
    case 'previous':
      return (
        <>
          <polygon points="19,4 9,12 19,20" fill="currentColor" />
          <rect x="4.5" y="4" width="2.5" height="16" fill="currentColor" />
        </>
      );
    case 'shuffle':
      // Feather Icons "shuffle" (feathericons.com, MIT).
      return (
        <>
          <polyline points="16,3 21,3 21,8" stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          <line x1="4" y1="20" x2="21" y2="3" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
          <polyline points="21,16 21,21 16,21" stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          <line x1="15" y1="15" x2="21" y2="21" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
          <line x1="4" y1="4" x2="9" y2="9" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
        </>
      );
    case 'repeat':
      // Feather Icons "repeat" (feathericons.com, MIT).
      return (
        <>
          <polyline points="17,1 21,5 17,9" stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3 11V9a4 4 0 0 1 4-4h14" stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          <polyline points="7,23 3,19 7,15" stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M21 13v2a4 4 0 0 1-4 4H3" stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
    case 'repeat-one':
      // Same "repeat" glyph with a "1" badge to mark single-track repeat.
      return (
        <>
          <polyline points="17,1 21,5 17,9" stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3 11V9a4 4 0 0 1 4-4h14" stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          <polyline points="7,23 3,19 7,15" stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M21 13v2a4 4 0 0 1-4 4H3" stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          <text x="12" y="15.5" fontSize="8" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none">
            1
          </text>
        </>
      );
    case 'heart':
      // Feather Icons "heart" (feathericons.com, MIT).
      return (
        <path
          d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
          stroke="currentColor"
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case 'heart-filled':
      return (
        <path
          d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
          fill="currentColor"
        />
      );
    case 'search':
      // Feather Icons "search" (feathericons.com, MIT).
      return (
        <>
          <circle cx="11" cy="11" r="8" stroke="currentColor" fill="none" strokeWidth={2} />
          <line x1="21" y1="21" x2="16.65" y2="16.65" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
        </>
      );
    case 'home':
      // Feather Icons "home" (feathericons.com, MIT).
      return (
        <>
          <path
            d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
            stroke="currentColor"
            fill="none"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline points="9,22 9,12 15,12 15,22" stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
    case 'library':
      // Feather Icons "music" (feathericons.com, MIT) — fits a song collection tab better than a bookshelf glyph.
      return (
        <>
          <path d="M9 18V5l12-2v13" stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="6" cy="18" r="3" stroke="currentColor" fill="none" strokeWidth={2} />
          <circle cx="18" cy="16" r="3" stroke="currentColor" fill="none" strokeWidth={2} />
        </>
      );
    case 'settings':
      // Feather Icons "sliders" (feathericons.com, MIT).
      return (
        <>
          <line x1="4" y1="21" x2="4" y2="14" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
          <line x1="4" y1="10" x2="4" y2="3" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
          <line x1="12" y1="21" x2="12" y2="12" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
          <line x1="12" y1="8" x2="12" y2="3" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
          <line x1="20" y1="21" x2="20" y2="16" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
          <line x1="20" y1="12" x2="20" y2="3" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
          <line x1="1" y1="14" x2="7" y2="14" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
          <line x1="9" y1="8" x2="15" y2="8" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
          <line x1="17" y1="16" x2="23" y2="16" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
        </>
      );
    case 'theme':
      return (
        <>
          <circle cx="12" cy="12" r="9" stroke="currentColor" fill="none" strokeWidth={2} />
          <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" />
        </>
      );
    case 'grip':
      return (
        <>
          <circle cx="9" cy="6" r="1.5" fill="currentColor" />
          <circle cx="9" cy="12" r="1.5" fill="currentColor" />
          <circle cx="9" cy="18" r="1.5" fill="currentColor" />
          <circle cx="15" cy="6" r="1.5" fill="currentColor" />
          <circle cx="15" cy="12" r="1.5" fill="currentColor" />
          <circle cx="15" cy="18" r="1.5" fill="currentColor" />
        </>
      );
    case 'queue':
      return (
        <>
          <line x1="8" y1="6" x2="21" y2="6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
          <line x1="8" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
          <line x1="8" y1="18" x2="21" y2="18" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
          <circle cx="3.5" cy="6" r="1.2" fill="currentColor" />
          <circle cx="3.5" cy="12" r="1.2" fill="currentColor" />
          <circle cx="3.5" cy="18" r="1.2" fill="currentColor" />
        </>
      );
    case 'close':
      return (
        <>
          <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
          <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
        </>
      );
    case 'chevron-down':
      return <polyline points="6,9 12,15 18,9" stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />;
    case 'chevron-up':
      return <polyline points="6,15 12,9 18,15" stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />;
    case 'chevron-left':
      return <polyline points="15,6 9,12 15,18" stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />;
    case 'more':
      return (
        <>
          <circle cx="5" cy="12" r="1.5" fill="currentColor" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
          <circle cx="19" cy="12" r="1.5" fill="currentColor" />
        </>
      );
    case 'plus':
      return (
        <>
          <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
          <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
        </>
      );
    case 'trash':
      return (
        <>
          <path d="M4 7h16" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
          <path d="M9 7V4h6v3" stroke="currentColor" fill="none" strokeWidth={2} strokeLinejoin="round" />
          <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" stroke="currentColor" fill="none" strokeWidth={2} strokeLinejoin="round" />
        </>
      );
    case 'volume':
      return (
        <>
          <path d="M4 9v6h4l5 4V5L8 9H4z" stroke="currentColor" fill="currentColor" strokeLinejoin="round" />
          <path d="M16.5 8.5a5 5 0 0 1 0 7" stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" />
        </>
      );
    case 'volume-mute':
      return (
        <>
          <path d="M4 9v6h4l5 4V5L8 9H4z" stroke="currentColor" fill="currentColor" strokeLinejoin="round" />
          <line x1="19" y1="9" x2="23" y2="15" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
          <line x1="23" y1="9" x2="19" y2="15" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
        </>
      );
    case 'wifi-off':
      return (
        <>
          <line x1="2" y1="2" x2="22" y2="22" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
          <path d="M8.5 16.5a5 5 0 0 1 7 0" stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" />
          <path d="M5 12.5a10 10 0 0 1 3-2" stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" />
          <path d="M16 10.5a10 10 0 0 1 3 2" stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" />
          <circle cx="12" cy="19" r="1" fill="currentColor" />
        </>
      );
    case 'check':
      return <polyline points="5,13 10,18 19,7" stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />;
    case 'refresh':
      return (
        <>
          <path d="M4 4v5h5" stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M20 20v-5h-5" stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5.5 9a7 7 0 0 1 12-3.5L20 8" stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" />
          <path d="M18.5 15a7 7 0 0 1-12 3.5L4 16" stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" />
        </>
      );
    case 'pulse':
      return (
        <>
          <rect x="4" y="8" width="3" height="8" rx="1.5" fill="currentColor" />
          <rect x="10.5" y="5" width="3" height="14" rx="1.5" fill="currentColor" />
          <rect x="17" y="7" width="3" height="10" rx="1.5" fill="currentColor" />
        </>
      );
    case 'clock':
      return (
        <>
          <circle cx="12" cy="12" r="8" stroke="currentColor" fill="none" strokeWidth={2} />
          <polyline points="12,7 12,12 16,14" stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
    case 'database':
      return (
        <>
          <ellipse cx="12" cy="6" rx="8" ry="3" stroke="currentColor" fill="none" strokeWidth={2} />
          <path d="M4 6v12c0 1.66 3.58 3 8 3s8-1.34 8-3V6" stroke="currentColor" fill="none" strokeWidth={2} />
          <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" stroke="currentColor" fill="none" strokeWidth={2} />
        </>
      );
    case 'download':
      return (
        <>
          <path d="M12 3v12" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
          <polyline points="7,10 12,15 17,10" stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 19h14" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
        </>
      );
    case 'spinner':
      return (
        <circle
          cx="12"
          cy="12"
          r="9"
          stroke="currentColor"
          fill="none"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray="42 100"
        />
      );
    default:
      return null;
  }
}

export function Icon({ name, size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <IconPaths name={name} />
    </svg>
  );
}
