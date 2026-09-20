import { useEffect, useRef } from 'react';
import { ConfirmPairSheet } from '../components/ConfirmPairSheet/ConfirmPairSheet';
import { JamSheet } from '../components/JamSheet/JamSheet';
import { LinkDeviceSheet } from '../components/LinkDeviceSheet/LinkDeviceSheet';
import { ScanLinkSheet } from '../components/ScanLinkSheet/ScanLinkSheet';
import { JoinJamSheet } from '../components/JoinJamSheet/JoinJamSheet';
import { PairDeviceSheet } from '../components/PairDeviceSheet/PairDeviceSheet';
import { useJamSync } from '../jam/useJamSync';
import { PlaybackProvider, usePlayback } from '../playback/PlaybackContext';
import { useUiStore } from '../stores/uiStore';
import { NowPlayingView } from '../views/now-playing/NowPlayingView';
import styles from './AppShell.module.css';
import { BottomNav } from './BottomNav';
import { MiniPlayer } from './MiniPlayer';
import { ViewRouter } from './ViewRouter';

export function AppShell() {
  useJamSync();

  return (
    <PlaybackProvider>
      <ShellBody />
    </PlaybackProvider>
  );
}

/**
 * Split out from AppShell because it needs usePlayback() (currentSong) to
 * know whether to reserve room for the desktop Now Playing side panel — that
 * hook only works inside PlaybackProvider, which AppShell itself renders.
 */
function ShellBody() {
  const isJamSheetOpen = useUiStore((state) => state.isJamSheetOpen);
  const closeJamSheet = useUiStore((state) => state.closeJamSheet);
  const joinJamRoomId = useUiStore((state) => state.joinJamRoomId);
  const closeJoinJamSheet = useUiStore((state) => state.closeJoinJamSheet);
  const isPairingSheetOpen = useUiStore((state) => state.isPairingSheetOpen);
  const closePairingSheet = useUiStore((state) => state.closePairingSheet);
  const incomingPairCode = useUiStore((state) => state.incomingPairCode);
  const closeIncomingPair = useUiStore((state) => state.closeIncomingPair);
  const isNowPlayingOpen = useUiStore((state) => state.isNowPlayingOpen);
  const linkSheet = useUiStore((state) => state.linkSheet);
  const linkPrefillCode = useUiStore((state) => state.linkPrefillCode);
  const closeLinkSheet = useUiStore((state) => state.closeLinkSheet);
  const currentView = useUiStore((state) => state.currentView);
  const detailDepth = useUiStore((state) => state.detailStack.length);
  const { currentSong } = usePlayback();

  // On desktop, Now Playing renders as a docked side panel (not a fullscreen
  // takeover) — the main content column needs to shrink to make room for it
  // instead of sitting underneath. Mobile ignores this entirely (Now Playing
  // stays a fullscreen sheet there, see NowPlayingView.module.css), so this
  // class is a no-op below the desktop breakpoint.
  const showNowPlayingPanel = isNowPlayingOpen && currentSong !== null;

  // <main> is the one scroll container shared by every menu, so without this a menu
  // opened after scrolling deep into another one starts from that same offset — the
  // fresh view then appears already scrolled past its own header.
  const contentRef = useRef<HTMLElement>(null);
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [currentView, detailDepth]);

  return (
    <div className={styles.shell}>
      <main ref={contentRef} className={[styles.content, showNowPlayingPanel ? styles.contentWithPanel : ''].join(' ')}>
        <ViewRouter />
      </main>
      <MiniPlayer />
      <BottomNav />
      <NowPlayingView />
      <JamSheet isOpen={isJamSheetOpen} onClose={closeJamSheet} />
      {joinJamRoomId && <JoinJamSheet isOpen roomId={joinJamRoomId} onClose={closeJoinJamSheet} />}
      <PairDeviceSheet isOpen={isPairingSheetOpen} onClose={closePairingSheet} />
      {linkSheet === 'show' && <LinkDeviceSheet onClose={closeLinkSheet} />}
      {linkSheet === 'scan' && <ScanLinkSheet prefillCode={linkPrefillCode} onClose={closeLinkSheet} />}
      {incomingPairCode && <ConfirmPairSheet isOpen code={incomingPairCode} onClose={closeIncomingPair} />}
    </div>
  );
}
