import { describe, expect, it } from 'vitest';
import { buildImportPayload, csvFilesFromZip, playlistFromCsv, playlistNameFromFile } from '../../src/import/exportifyFile';

const HEADER =
  'Track URI,ISRC,Track Name,Album Name,Artist Name(s),Release Date,Duration (ms),Popularity,Explicit,Added By,Added At,Genres,Record Label,Danceability,Energy,Key,Loudness,Mode,Speechiness,Acousticness,Instrumentalness,Liveness,Valence,Tempo,Time Signature';

// Rows as Exportify writes them, including a track Spotify deleted (empty name, 0 ms) and a missing ISRC ("undefined").
const CSV = [
  HEADER,
  'spotify:track:6qn9YLKt13AGvpq9jfO8py,USUM71115507,"We Found Love","Talk That Talk","Rihanna;Calvin Harris",2011-11-18,215226,87,false,u,2026-01-04T13:23:03Z,"edm","Def Jam Recordings",0.7,0.7,1,-4,1,0.03,0.02,0.001,0.1,0.6,128,4',
  'spotify:track:7pYfyrMNPn3wtoCyqcTVoI,USUM71109132,"Moves Like Jagger - Studio Recording From ""The Voice"" Performance","Hands All Over","Maroon 5;Christina Aguilera",2010,201493,84,false,u,2026-01-05T06:57:49Z,"pop","Interscope",0.7,0.7,11,-4,0,0.04,0.01,0,0.3,0.6,128,4',
  'spotify:track:2E532ozrMbRXwuZkpoegUP,,"","happy","",2019-07-05,0,0,false,u,2021-11-08T04:45:32Z,"","Marshal XP",0.7,0.4,3,-11,1,0.02,0.5,0.03,0.1,0.7,88,4',
  'spotify:track:0lks2Kt9veMOFEAPN0fsqN,undefined,"Lily","Different World","Alan Walker;K-391;Emelie Hollow",2018-12-14,195840,74,false,u,2026-01-05T06:07:58Z,"","Kreatell Music",0.4,0.6,6,-5,0,0.05,0.19,0,0.18,0.46,151,4',
  'spotify:local:Artist:Album:Song:200,undefined,"Song","Album","Artist",undefined,200000,0,false,u,2026-01-05T06:07:58Z,"","undefined",,,,,,,,,,,,',
].join('\n');

function storedZip(files: { name: string; text: string }[]): ArrayBuffer {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = enc.encode(file.name);
    const data = enc.encode(file.text);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const dir = new Uint8Array(46 + name.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint32(20, data.length, true);
    dv.setUint32(24, data.length, true);
    dv.setUint16(28, name.length, true);
    dv.setUint32(42, offset, true);
    dir.set(name, 46);
    parts.push(local, data);
    central.push(dir);
    offset += local.length + data.length;
  }
  const dirSize = central.reduce((n, d) => n + d.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, dirSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out.buffer;
}

describe('Exportify files', () => {
  it('reads tracks, skipping deleted tracks and local files, keyed by ISRC or else the URI', () => {
    const playlist = playlistFromCsv("10's_vibe.csv", `﻿${CSV}`);
    expect(playlist?.name).toBe("10's vibe");
    expect(playlist?.kind).toBe('playlist');
    expect(playlist?.skipped).toBe(2);
    expect(playlist?.tracks.map((t) => t.key)).toEqual(['USUM71115507', 'USUM71109132', 'spotify:track:0lks2Kt9veMOFEAPN0fsqN']);
    expect(playlist?.tracks[1]).toMatchObject({
      name: 'Moves Like Jagger - Studio Recording From "The Voice" Performance',
      artists: ['Maroon 5', 'Christina Aguilera'],
      durationSec: 201,
      addedAt: Date.parse('2026-01-05T06:57:49Z'),
    });
  });

  it('names playlists from their file names and recognises liked songs and saved albums', () => {
    expect(playlistNameFromFile('Top_Songs_-_Global.csv')).toBe('Top Songs - Global');
    expect(playlistNameFromFile('calm_.csv')).toBe('calm');
    expect(playlistFromCsv('Liked_Songs.csv', CSV)?.kind).toBe('liked');
    expect(playlistFromCsv('Saved_Albums.csv', CSV)?.kind).toBe('savedAlbums');
    expect(playlistFromCsv('notes.csv', 'a,b\n1,2')).toBeNull();
  });

  it('reads the CSVs out of a stored ZIP like the one Exportify makes', async () => {
    const files = await csvFilesFromZip(storedZip([{ name: 'Liked_Songs.csv', text: CSV }, { name: 'calm.csv', text: HEADER }]));
    expect(files.map((f) => f.name)).toEqual(['Liked_Songs.csv', 'calm.csv']);
    expect(files[0].text).toBe(CSV);
  });

  it('sends each song once, liked songs first, with every playlist pointing at it', () => {
    const liked = playlistFromCsv('Liked_Songs.csv', CSV)!;
    const other = playlistFromCsv('calm.csv', CSV)!;
    const payload = buildImportPayload([liked, other]);
    expect(payload.tracks).toHaveLength(3);
    expect(payload.playlists.map((p) => [p.name, p.liked, p.items.length])).toEqual([
      ['Liked Songs', true, 3],
      ['calm', false, 3],
    ]);
  });
});
