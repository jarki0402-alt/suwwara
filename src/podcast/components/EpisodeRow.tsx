import { useToast } from '../../components/Toast/ToastProvider';
import { OptionsMenu } from '../../components/OptionsMenu/OptionsMenu';
import { useT, t as translate } from '../../i18n/i18n';
import { useQueueStore } from '../../stores/queueStore';
import { useUiStore } from '../../stores/uiStore';
import { formatTime } from '../../utils/formatTime';
import { playEpisode, queueEpisode } from '../playEpisode';
import { usePodcastStore } from '../podcastStore';
import type { Episode } from '../types';
import styles from './Podcast.module.css';
import { useYtText } from '../ytText';

export function formatEpisodeLength(sec: number): string {
  if (!(sec > 0)) return '';
  const hours = Math.floor(sec / 3600);
  // Down, never up: "36 mnt" left of a 36:38 episode, not 37.
  const minutes = Math.floor((sec % 3600) / 60);
  return hours > 0 ? translate('{h} j {m} mnt', { h: hours, m: minutes }) : translate('{m} mnt', { m: Math.max(1, minutes) });
}

/** Called from a tap: plays, or explains why not (episodes are solo only, see playEpisode). */
export function usePlayEpisode() {
  const { showToast } = useToast();
  return (episode: Episode, from: Episode[]) => {
    if (!playEpisode(episode, from)) showToast(translate('Gagal memutar episode ini.'));
  };
}

/** The "⋯" of an episode: the podcast counterpart of SongMenu. */
export function EpisodeMenu({ episode }: { episode: Episode }) {
  const t = useT();
  const { showToast } = useToast();
  const isSaved = usePodcastStore((state) => state.isSaved(episode.id));
  const finished = usePodcastStore((state) => state.progress[episode.id]?.finished ?? false);
  const toggleSaved = usePodcastStore((state) => state.toggleSaved);
  const markFinished = usePodcastStore((state) => state.markFinished);
  const isQueued = usePodcastStore((state) => state.isQueued(episode.id));
  const removeFromQueue = usePodcastStore((state) => state.removeFromQueue);
  const openChannel = useUiStore((state) => state.openPodcastChannel);
  const url = `https://www.youtube.com/watch?v=${encodeURIComponent(episode.id)}`;

  const share = async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: episode.title, url });
        return;
      } catch {
        // dismissed: fall through to copying
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast(t('Tautan disalin.'));
    } catch {
      showToast(url);
    }
  };

  return (
    <OptionsMenu
      ariaLabel={t('Opsi untuk {name}', { name: episode.title })}
      items={[
        {
          key: 'queue',
          icon: isQueued ? 'trash' : 'play-next',
          label: isQueued ? t('Hapus dari antrean') : t('Tambahkan ke antrean'),
          onClick: () => {
            if (isQueued) removeFromQueue(episode.id);
            else showToast(queueEpisode(episode) === 'jam' ? t('Ditambahkan ke antrean Jam.') : t('Ditambahkan ke antrean podcast.'));
          },
        },
        {
          key: 'save',
          icon: isSaved ? 'check' : 'plus',
          label: isSaved ? t('Hapus dari simpanan') : t('Simpan untuk nanti'),
          onClick: () => {
            toggleSaved(episode);
            showToast(isSaved ? t('Dihapus dari simpanan.') : t('Disimpan untuk nanti.'));
          },
        },
        {
          key: 'heard',
          icon: finished ? 'refresh' : 'check',
          label: finished ? t('Tandai belum didengar') : t('Tandai sudah didengar'),
          onClick: () => markFinished(episode, !finished),
        },
        episode.channelId ? {
          key: 'channel',
          icon: 'artist',
          label: t('Buka channel'),
          separatorBefore: true,
          onClick: () => openChannel({ channelId: episode.channelId!, name: episode.channelName ?? undefined }),
        } : null,
        // For what needs the picture after all: the video itself, on YouTube (its bandwidth, not this server's).
        { key: 'youtube', icon: 'video', label: t('Buka di YouTube'), onClick: () => window.open(url, '_blank', 'noopener') },
        { key: 'share', icon: 'share', label: t('Bagikan'), onClick: () => void share() },
      ]}
    />
  );
}

interface EpisodeRowProps {
  episode: Episode;
  /** The list it is shown in: what "Berikutnya" offers after it. */
  list: Episode[];
  showChannel?: boolean;
}

export function EpisodeRow({ episode, list, showChannel = false }: EpisodeRowProps) {
  const t = useT();
  const yt = useYtText();
  const play = usePlayEpisode();
  const progress = usePodcastStore((state) => state.progress[episode.id]);
  const isCurrent = useQueueStore((state) => state.currentSong()?.id === episode.id);
  const duration = episode.durationSec || progress?.durationSec || 0;
  const fraction = progress && duration > 0 ? Math.min(1, progress.positionSec / duration) : 0;
  const remaining = progress && !progress.finished && duration > 0 ? duration - progress.positionSec : 0;
  const meta = [
    showChannel ? episode.channelName : null,
    episode.publishedText ? yt(episode.publishedText) : episode.publishedAt ? new Date(episode.publishedAt).toLocaleDateString() : null,
  ].filter(Boolean);

  return (
    <div className={[styles.episodeRow, isCurrent ? styles.episodeRowCurrent : ''].join(' ')}>
      <button type="button" className={styles.episodeMain} onClick={() => play(episode, list)}>
        <span className={styles.thumb}>
          <img src={episode.thumbnail} alt="" loading="lazy" decoding="async" />
          {duration > 0 && <span className={styles.durationBadge}>{formatTime(duration)}</span>}
          {fraction > 0 && (
            <span className={styles.thumbProgress} aria-hidden="true">
              <span style={{ width: `${(progress?.finished ? 1 : fraction) * 100}%` }} />
            </span>
          )}
        </span>
        <span className={styles.episodeText}>
          <span className={styles.episodeTitle}>{episode.title}</span>
          <span className={styles.episodeMeta}>
            {progress?.finished
              ? t('Sudah didengar')
              : remaining > 0
                ? t('Sisa {time}', { time: formatEpisodeLength(remaining) })
                : meta.join(' · ')}
          </span>
        </span>
      </button>
      <EpisodeMenu episode={episode} />
    </div>
  );
}
