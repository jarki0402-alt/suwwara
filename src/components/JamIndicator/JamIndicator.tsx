import type { CSSProperties } from 'react';
import { copyJamLink } from '../../jam/shareJam';
import { useJamStatus } from '../../jam/useJamStatus';
import { useJamStore } from '../../stores/jamStore';
import { useUiStore } from '../../stores/uiStore';
import { Icon } from '../Icon/Icon';
import { useToast } from '../Toast/ToastProvider';
import styles from './JamIndicator.module.css';

/**
 * The people in the room as overlapping avatars. The server only tells us HOW MANY are listening, not who, so these are
 * anonymous silhouettes — the first (you) in the brand gradient, the rest in their own tints so they read as different
 * people. Past `max`, the last slot becomes a "+N" chip. Ring colour comes from `--jam-ring` on whatever holds it, so
 * the overlap cut-out matches that surface.
 */
export function JamAvatars({ count, size = 28, max = 4 }: { count: number; size?: number; max?: number }) {
  const shown = count > max ? max - 1 : count;
  const extra = count - shown;
  return (
    <span className={styles.avatars} style={{ '--avatar-size': `${size}px` } as CSSProperties} aria-hidden="true">
      {Array.from({ length: shown }, (_, index) => (
        <span key={index} className={[styles.avatar, styles[`tint${index % 5}`]].join(' ')}>
          <Icon name="artist" size={Math.round(size * 0.58)} />
        </span>
      ))}
      {extra > 0 && <span className={[styles.avatar, styles.avatarMore].join(' ')}>+{extra}</span>}
    </span>
  );
}

/**
 * Phone: a pill in the top-right corner, on every screen while you are in a Jam — the phone has no sidebar or top
 * bar to hold it. Tapping it opens the Jam sheet (share link, leave). Hidden on desktop, where JamSidebarCard does this.
 */
export function JamPill() {
  const jam = useJamStatus();
  const openJamSheet = useUiStore((state) => state.openJamSheet);
  if (!jam.active) return null;

  return (
    <button type="button" className={[styles.pill, jam.live ? '' : styles.pillWarn].join(' ')} onClick={openJamSheet} aria-label={`${jam.summary}. Ketuk untuk mengelola.`}>
      {jam.live ? (
        <>
          <JamAvatars count={jam.count} size={20} max={3} />
          <span className={styles.pillLabel}>Jam</span>
        </>
      ) : (
        <>
          <Icon name="wifi-off" size={14} />
          <span className={styles.pillLabel}>{jam.statusText}</span>
        </>
      )}
    </button>
  );
}

/**
 * Desktop: a card in the sidebar, under the menu — always visible, never over content. Says what this is (Jam, and your
 * role in it), who is in it, and puts the two things you do with a Jam one click away: invite someone, or manage it
 * (full link, leave, end). Hidden on phones (see JamPill).
 */
export function JamSidebarCard() {
  const jam = useJamStatus();
  const roomId = useJamStore((state) => state.roomId);
  const openJamSheet = useUiStore((state) => state.openJamSheet);
  const { showToast } = useToast();
  if (!jam.active) return null;

  const handleInvite = async () => {
    if (!roomId) return;
    if (await copyJamLink(roomId)) showToast('Link Jam disalin — kirim ke temanmu.');
    else showToast('Gagal menyalin link.', { type: 'error' });
  };

  return (
    <section className={[styles.card, jam.live ? '' : styles.cardWarn].join(' ')} aria-label={jam.summary}>
      <div className={styles.cardHead}>
        <span className={styles.cardBadge}>
          <Icon name="users" size={16} />
        </span>
        <span className={styles.cardHeadText}>
          <span className={styles.cardTitleRow}>
            <span className={styles.cardTitle}>Jam</span>
            <span className={styles.cardRole}>{jam.roleLabel}</span>
          </span>
          <span className={styles.cardStatus}>
            {!jam.live && <Icon name="wifi-off" size={12} />}
            {jam.statusText}
          </span>
        </span>
      </div>

      <div className={styles.cardPeople}>
        <JamAvatars count={jam.count} size={26} />
        <span className={styles.cardPeopleText}>{jam.peopleText}</span>
      </div>

      <div className={styles.cardActions}>
        <button type="button" className={styles.cardPrimary} onClick={() => void handleInvite()}>
          <Icon name="share" size={14} />
          Undang
        </button>
        <button type="button" className={styles.cardSecondary} onClick={openJamSheet}>
          Kelola
        </button>
      </div>
    </section>
  );
}
