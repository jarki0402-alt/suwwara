export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';

export interface PlaybackState {
  status: PlaybackStatus;
  duration: number;
  error: string | null;
}

export type AudioEngineListener = (state: PlaybackState) => void;

export interface LoadTrackOptions {
  dataSaver?: boolean;
  autoplay?: boolean;
  fadeInSec?: number;
}

export class AudioEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AudioEngineError';
  }
}
