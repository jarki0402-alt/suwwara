import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Song } from '../api/types';
import { generateId } from '../utils/idGen';

/**
 * A song as kept in a playlist or in Lagu Disukai: the song itself plus when it was put there. The timestamp lives on
 * the entry (not in a side table) so it travels with the playlist / liked list through account sync and merges without
 * the server or the sync code knowing about it. Songs saved before this existed have none — shown as "—", never a
 * made-up date.
 */
export type SavedSong = Song & { addedAt?: number };

export interface UserPlaylist {
  id: string;
  name: string;
  songs: SavedSong[];
  createdAt: number;
}

interface LibraryState {
  likedSongs: SavedSong[];
  playlists: UserPlaylist[];
  toggleLike: (song: Song) => void;
  isLiked: (songId: string) => boolean;
  createPlaylist: (name: string) => UserPlaylist;
  deletePlaylist: (playlistId: string) => void;
  renamePlaylist: (playlistId: string, name: string) => void;
  addSongToPlaylist: (playlistId: string, song: Song) => void;
  removeSongFromPlaylist: (playlistId: string, songId: string) => void;
}

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set, get) => ({
      likedSongs: [],
      playlists: [],

      toggleLike: (song) => {
        const { likedSongs } = get();
        const exists = likedSongs.some((s) => s.id === song.id);
        set({
          likedSongs: exists ? likedSongs.filter((s) => s.id !== song.id) : [{ ...song, addedAt: Date.now() }, ...likedSongs],
        });
      },

      isLiked: (songId) => get().likedSongs.some((s) => s.id === songId),

      createPlaylist: (name) => {
        const playlist: UserPlaylist = {
          id: generateId(),
          name: name.trim() || 'Playlist Baru',
          songs: [],
          createdAt: Date.now(),
        };
        set({ playlists: [playlist, ...get().playlists] });
        return playlist;
      },

      deletePlaylist: (playlistId) => {
        set({ playlists: get().playlists.filter((p) => p.id !== playlistId) });
      },

      renamePlaylist: (playlistId, name) => {
        set({
          playlists: get().playlists.map((p) => (p.id === playlistId ? { ...p, name: name.trim() || p.name } : p)),
        });
      },

      addSongToPlaylist: (playlistId, song) => {
        set({
          playlists: get().playlists.map((p) => {
            if (p.id !== playlistId) return p;
            if (p.songs.some((s) => s.id === song.id)) return p;
            return { ...p, songs: [...p.songs, { ...song, addedAt: Date.now() }] };
          }),
        });
      },

      removeSongFromPlaylist: (playlistId, songId) => {
        set({
          playlists: get().playlists.map((p) =>
            p.id === playlistId ? { ...p, songs: p.songs.filter((s) => s.id !== songId) } : p,
          ),
        });
      },
    }),
    { name: 'suwwara-library' },
  ),
);
