import { useJamStore, type JamConnection } from '../stores/jamStore';

export interface JamStatus {
  active: boolean;
  /** People in the room, at least 1 (yourself) once active. */
  count: number;
  isHost: boolean;
  connection: JamConnection;
  live: boolean;
  /** "Mendengarkan bersama" / "Menyambung…" / "Menyambung ulang…" */
  statusText: string;
  /** "3 pendengar" / "Baru kamu" */
  peopleText: string;
  /** "Host" / "Tamu" */
  roleLabel: string;
  /** One sentence for screen readers: "Jam, 3 pendengar, kamu host." */
  summary: string;
}

/** Everything the "you are in a Jam" indicators show, from the one place that knows it. */
export function useJamStatus(): JamStatus {
  const role = useJamStore((state) => state.role);
  const memberCount = useJamStore((state) => state.memberCount);
  const isHost = useJamStore((state) => state.isCreator);
  const connection = useJamStore((state) => state.connection);

  const count = Math.max(memberCount, 1);
  const peopleText = count <= 1 ? 'Baru kamu' : `${count} pendengar`;
  const statusText = connection === 'live' ? 'Mendengarkan bersama' : connection === 'reconnecting' ? 'Menyambung ulang…' : 'Menyambung…';
  return {
    active: role === 'jam',
    count,
    isHost,
    connection,
    live: connection === 'live',
    statusText,
    peopleText,
    roleLabel: isHost ? 'Host' : 'Tamu',
    summary: `Jam, ${statusText}, ${peopleText}, kamu ${isHost ? 'host' : 'tamu'}`,
  };
}
