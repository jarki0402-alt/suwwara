import { ConfirmPairSheet } from '../components/ConfirmPairSheet/ConfirmPairSheet';
import { JamSheet } from '../components/JamSheet/JamSheet';
import { JoinJamSheet } from '../components/JoinJamSheet/JoinJamSheet';
import { PairDeviceSheet } from '../components/PairDeviceSheet/PairDeviceSheet';
import { useJamSync } from '../jam/useJamSync';
import { PlaybackProvider } from '../playback/PlaybackContext';
import { useUiStore } from '../stores/uiStore';
import { NowPlayingView } from '../views/now-playing/NowPlayingView';
import styles from './AppShell.module.css';
import { BottomNav } from './BottomNav';
import { MiniPlayer } from './MiniPlayer';
import { ViewRouter } from './ViewRouter';

export function AppShell() {
  useJamSync();
  const isJamSheetOpen = useUiStore((state) => state.isJamSheetOpen);
  const closeJamSheet = useUiStore((state) => state.closeJamSheet);
  const joinJamRoomId = useUiStore((state) => state.joinJamRoomId);
  const closeJoinJamSheet = useUiStore((state) => state.closeJoinJamSheet);
  const isPairingSheetOpen = useUiStore((state) => state.isPairingSheetOpen);
  const closePairingSheet = useUiStore((state) => state.closePairingSheet);
  const incomingPairCode = useUiStore((state) => state.incomingPairCode);
  const closeIncomingPair = useUiStore((state) => state.closeIncomingPair);

  return (
    <PlaybackProvider>
      <div className={styles.shell}>
        <main className={styles.content}>
          <ViewRouter />
        </main>
        <MiniPlayer />
        <BottomNav />
        <NowPlayingView />
        <JamSheet isOpen={isJamSheetOpen} onClose={closeJamSheet} />
        {joinJamRoomId && <JoinJamSheet isOpen roomId={joinJamRoomId} onClose={closeJoinJamSheet} />}
        <PairDeviceSheet isOpen={isPairingSheetOpen} onClose={closePairingSheet} />
        {incomingPairCode && <ConfirmPairSheet isOpen code={incomingPairCode} onClose={closeIncomingPair} />}
      </div>
    </PlaybackProvider>
  );
}
