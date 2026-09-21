import { useEffect, useRef } from 'react';
import { ConnectSheet } from '../components/ConnectSheet/ConnectSheet';
import { JamSheet } from '../components/JamSheet/JamSheet';
import { JoinJamSheet } from '../components/JoinJamSheet/JoinJamSheet';
import { ConnectBridge } from '../connect/ConnectBridge';
import { useConnectStore } from '../connect/connectStore';
import { useJamSync } from '../jam/useJamSync';
import { PlaybackProvider, usePlayback } from '../playback/PlaybackContext';
import { useUiStore } from '../stores/uiStore';
import { JamPill } from '../components/JamIndicator/JamIndicator';
import { NowPlayingView } from '../views/now-playing/NowPlayingView';
import styles from './AppShell.module.css';
import { BottomNav } from './BottomNav';
import { MiniPlayer } from './MiniPlayer';
import { RemoteBar } from './RemoteBar';
import { PaneResizers } from './PaneResizers';
import { TopBar } from './TopBar';
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
  const isNowPlayingOpen = useUiStore((state) => state.isNowPlayingOpen);
  const isConnectSheetOpen = useUiStore((state) => state.isConnectSheetOpen);
  const isRemoteControlling = useConnectStore((state) => state.controllingRef !== null && state.devices.some((device) => device.ref === state.controllingRef));
  const currentView = useUiStore((state) => state.currentView);
  const detailDepth = useUiStore((state) => state.detailStack.length);
  const { currentSong } = usePlayback();

  // On desktop, Now Playing renders as a docked side panel (not a fullscreen
  // takeover) — the main content column needs to shrink to make room for it
  // instead of sitting underneath. Mobile ignores this entirely (Now Playing
  // stays a fullscreen sheet there, see NowPlayingView.module.css), so this
  // class is a no-op below the desktop breakpoint.
  const showNowPlayingPanel = isNowPlayingOpen && currentSong !== null;
  // The Perangkat (Connect) panel docks in the same right-hand column, so the page reserves the same room for it.
  const showRightPanel = showNowPlayingPanel || isConnectSheetOpen;

  // <main> is the one scroll container shared by every menu, so without this a menu
  // opened after scrolling deep into another one starts from that same offset — the
  // fresh view then appears already scrolled past its own header.
  const contentRef = useRef<HTMLElement>(null);
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [currentView, detailDepth]);

  return (
    <div className={styles.shell}>
      <main ref={contentRef} className={[styles.content, showRightPanel ? styles.contentWithPanel : ''].join(' ')}>
        <TopBar />
        <ViewRouter />
      </main>
      <PaneResizers panelOpen={showRightPanel} />
      <ConnectBridge />
      {/* While steering another device, its bar stands in for the local player — which stays untouched. */}
      {isRemoteControlling ? <RemoteBar /> : <MiniPlayer />}
      <BottomNav />
      <JamPill />
      <NowPlayingView />
      <JamSheet isOpen={isJamSheetOpen} onClose={closeJamSheet} />
      {joinJamRoomId && <JoinJamSheet isOpen roomId={joinJamRoomId} onClose={closeJoinJamSheet} />}
      {isConnectSheetOpen && <ConnectSheet />}
    </div>
  );
}
