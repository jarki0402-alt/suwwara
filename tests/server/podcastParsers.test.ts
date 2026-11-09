import { describe, expect, it } from 'vitest';
import { parseChannelHits, parseChannelPage, parseDuration, parseFeed, parseVideoResults } from '../../server/src/podcast/youtubeClient';
import { isFinishedAt } from '../../src/podcast/podcastStore';

// Shapes trimmed from real youtube.com answers (2026-11, Nadia Omara's channel), kept to the fields the parsers read.
const lockup = (id: string, title: string, badge: string | null, extra: Record<string, unknown> = {}) => ({
  richItemRenderer: {
    content: {
      lockupViewModel: {
        contentId: id,
        contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
        contentImage: {
          thumbnailViewModel: {
            overlays: badge ? [{ thumbnailBottomOverlayViewModel: { badges: [{ thumbnailBadgeViewModel: { text: badge } }] } }] : [],
          },
        },
        metadata: {
          lockupMetadataViewModel: {
            title: { content: title },
            metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: '5,4 jt x ditonton' } }, { text: { content: '23 jam yang lalu' } }] }] } },
          },
        },
        ...extra,
      },
    },
  },
});

describe('podcast YouTube parsers', () => {
  it('reads durations in both the Indonesian and English page formats', () => {
    expect(parseDuration('33.23')).toBe(2003);
    expect(parseDuration('2.41.11')).toBe(9671);
    expect(parseDuration('33:23')).toBe(2003);
    expect(parseDuration('LIVE')).toBe(0);
  });

  it('keeps listenable videos and drops live, members-only and Shorts-length ones', () => {
    const page = parseChannelPage(
      {
        header: {
          pageHeaderViewModel: {
            title: { dynamicTextViewModel: { text: { content: 'Nadia Omara' } } },
            metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: '@NadiaOmaraa' } }, { text: { content: '18,6 jt subscriber' } }] }] } },
          },
        },
        contents: [
          lockup('Jr2AVxsP3Vk', 'LANTAI DUA - KHW PART 403', '33.23'),
          lockup('live0000000', 'Live now', null),
          lockup('member00000', 'Members only', '41.02', { badges: [{ badgeViewModel: { badgeStyle: 'BADGE_MEMBERS_ONLY' } }] }),
          lockup('short000000', 'A short', '0.45'),
        ],
      },
      'UCbX_TueacKEifdw8lAjARNQ',
    );
    expect(page.name).toBe('Nadia Omara');
    expect(page.handle).toBe('@NadiaOmaraa');
    expect(page.subscribers).toBe('18,6 jt subscriber');
    expect(page.episodes.map((e) => e.id)).toEqual(['Jr2AVxsP3Vk']);
    expect(page.episodes[0]).toMatchObject({ durationSec: 2003, publishedText: '23 jam yang lalu', channelName: 'Nadia Omara' });
  });

  it('reads channel search hits whichever field YouTube put the handle in', () => {
    const hits = parseChannelHits({
      contents: [
        { channelRenderer: { channelId: 'UCbX_TueacKEifdw8lAjARNQ', title: { simpleText: 'Nadia Omara' }, subscriberCountText: { simpleText: '@NadiaOmaraa' }, videoCountText: { simpleText: '18,6 jt subscriber' } } },
        { channelRenderer: { channelId: 'not-a-channel', title: { simpleText: 'x' } } },
      ],
    });
    expect(hits).toEqual([expect.objectContaining({ id: 'UCbX_TueacKEifdw8lAjARNQ', handle: '@NadiaOmaraa', subscribers: '18,6 jt subscriber' })]);
  });

  it('drops Shorts from video search and from the RSS feed', () => {
    const results = parseVideoResults({
      contents: [
        { videoRenderer: { videoId: 'Vto2kgrhVHM', title: { runs: [{ text: 'PULANG - KHW PART 400' }] }, lengthText: { simpleText: '2.41.11' } } },
        { videoRenderer: { videoId: 'short000000', title: { runs: [{ text: 'short' }] }, lengthText: { simpleText: '0.30' } } },
      ],
    });
    expect(results.map((r) => r.id)).toEqual(['Vto2kgrhVHM']);

    const feed = parseFeed(`<feed><author><name>Nadia Omara &amp; Co</name></author>
      <entry><yt:videoId>Jr2AVxsP3Vk</yt:videoId><yt:channelId>UCbX_TueacKEifdw8lAjARNQ</yt:channelId><title>LANTAI DUA</title>
        <link rel="alternate" href="https://www.youtube.com/watch?v=Jr2AVxsP3Vk"/><published>2026-11-08T12:00:10+00:00</published></entry>
      <entry><yt:videoId>short000000</yt:videoId><title>s</title><link rel="alternate" href="https://www.youtube.com/shorts/short000000"/></entry>
    </feed>`);
    expect(feed).toEqual([expect.objectContaining({ id: 'Jr2AVxsP3Vk', channelName: 'Nadia Omara & Co', publishedAt: '2026-11-08T12:00:10+00:00' })]);
  });
});

describe('podcast progress', () => {
  it('counts an episode heard in its last minute or last 5%', () => {
    expect(isFinishedAt(1950, 2003)).toBe(true); // 53s left
    expect(isFinishedAt(9200, 9671)).toBe(true); // 95%
    expect(isFinishedAt(600, 2003)).toBe(false);
    expect(isFinishedAt(10, 0)).toBe(false);
  });
});
