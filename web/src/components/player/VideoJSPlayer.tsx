import React, { useEffect, useRef } from 'react';
import videojs from 'video.js';
import { AspectRatioMode } from './types';

export interface VideoJSPlayerHandle {
  play: () => Promise<void> | void;
  pause: () => void;
  seek: (time: number) => void;
  setVolume: (vol: number) => void;
  setMuted: (muted: boolean) => void;
  setPlaybackRate: (rate: number) => void;
  requestFullscreen: () => void;
  getVideoElement: () => HTMLVideoElement | null;
  getPlayer: () => any;
}

interface VideoJSPlayerProps {
  src: string;
  poster?: string;
  aspectRatio: AspectRatioMode;
  videoWidth: number;
  videoHeight: number;
  onPlayerReady?: (handle: VideoJSPlayerHandle) => void;
  onTimeUpdate?: (currentTime: number, duration: number, bufferedAhead: number, bufferedPct: number) => void;
  onPlay?: () => void;
  onPause?: () => void;
  onWaiting?: () => void;
  onPlaying?: () => void;
  onCanPlay?: () => void;
  onLoadedMetadata?: (width: number, height: number, duration: number) => void;
  onEnded?: () => void;
  onError?: (errCode: number | null, errMsg?: string) => void;
  onTextTracksChange?: (tracks: TextTrackList) => void;
  userPausedRef: React.MutableRefObject<boolean>;
}

export const VideoJSPlayer: React.FC<VideoJSPlayerProps> = ({
  src,
  poster,
  aspectRatio,
  videoWidth,
  videoHeight,
  onPlayerReady,
  onTimeUpdate,
  onPlay,
  onPause,
  onWaiting,
  onPlaying,
  onCanPlay,
  onLoadedMetadata,
  onEnded,
  onError,
  onTextTracksChange,
  userPausedRef,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<any>(null);
  const isDisposedRef = useRef(false);

  // Accurate CSS geometry based on selected aspect ratio
  const videoStyle: React.CSSProperties = React.useMemo(() => {
    const isCover = aspectRatio === 'cover';
    const isFill = aspectRatio === 'fill';

    const base: React.CSSProperties = {
      objectFit: isCover ? 'cover' : isFill ? 'fill' : 'contain',
      maxWidth: '100%',
      maxHeight: '100%',
      width: isCover || isFill ? '100%' : 'auto',
      height: isCover || isFill ? '100%' : 'auto',
      margin: 'auto',
      display: 'block',
    };

    if (aspectRatio === '16:9') {
      base.aspectRatio = '16 / 9';
    } else if (aspectRatio === '4:3') {
      base.aspectRatio = '4 / 3';
    } else if (aspectRatio === '21:9') {
      base.aspectRatio = '21 / 9';
    } else if (aspectRatio === 'contain' && videoWidth > 0 && videoHeight > 0) {
      base.aspectRatio = `${videoWidth} / ${videoHeight}`;
    }

    return base;
  }, [aspectRatio, videoWidth, videoHeight]);

  useEffect(() => {
    isDisposedRef.current = false;
    const container = containerRef.current;
    if (!container) return;

    // Create fresh video tag inside container
    const videoElement = document.createElement('video');
    videoElement.className = 'video-js vjs-custom-skin';
    videoElement.playsInline = true;
    videoElement.setAttribute('webkit-playsinline', 'true');
    videoElement.setAttribute('x5-playsinline', 'true');
    videoElement.setAttribute('preload', 'auto');
    videoElement.setAttribute('crossorigin', 'anonymous');
    container.appendChild(videoElement);
    videoElementRef.current = videoElement;

    const player = (videojs as any)(videoElement, {
      autoplay: true,
      controls: false,
      preload: 'auto',
      fluid: false,
      responsive: true,
      sources: [{ src, type: 'video/mp4' }],
      poster,
    });

    playerRef.current = player;

    player.ready(() => {
      if (isDisposedRef.current) return;

      const handle: VideoJSPlayerHandle = {
        play: () => {
          if (userPausedRef.current) return;
          const p = player.play();
          if (p && typeof p.then === 'function') {
            p.catch((err: any) => {
              if (err && err.name === 'NotAllowedError') {
                player.muted(true);
                player.play()?.catch(() => {});
              }
            });
          }
        },
        pause: () => {
          player.pause();
        },
        seek: (time: number) => {
          player.currentTime(time);
        },
        setVolume: (vol: number) => {
          player.volume(vol);
        },
        setMuted: (muted: boolean) => {
          player.muted(muted);
        },
        setPlaybackRate: (rate: number) => {
          player.playbackRate(rate);
        },
        requestFullscreen: () => {
          if (player.requestFullscreen) {
            player.requestFullscreen();
          }
        },
        getVideoElement: () => videoElementRef.current,
        getPlayer: () => playerRef.current,
      };

      if (onPlayerReady) onPlayerReady(handle);
    });

    // Event Bindings
    player.on('timeupdate', () => {
      if (!onTimeUpdate || isDisposedRef.current) return;
      const curr = player.currentTime() || 0;
      const dur = player.duration() || 0;
      const buf = player.buffered();
      let bufferedAhead = 0;
      let bufferedPct = 0;
      if (buf && buf.length > 0) {
        let found = false;
        for (let i = 0; i < buf.length; i++) {
          if (buf.start(i) <= curr && curr <= buf.end(i)) {
            if (dur > 0) bufferedPct = (buf.end(i) / dur) * 100;
            bufferedAhead = Math.max(0, Math.round(buf.end(i) - curr));
            found = true;
            break;
          }
        }
        if (!found) {
          const lastEnd = buf.end(buf.length - 1);
          if (dur > 0) bufferedPct = (lastEnd / dur) * 100;
          bufferedAhead = Math.max(0, Math.round(lastEnd - curr));
        }
      }
      onTimeUpdate(curr, dur, bufferedAhead, bufferedPct);
    });

    player.on('play', () => onPlay?.());
    player.on('pause', () => onPause?.());
    player.on('waiting', () => onWaiting?.());
    player.on('playing', () => onPlaying?.());
    player.on('canplay', () => {
      if (!userPausedRef.current && player.paused()) {
        const p = player.play();
        if (p && typeof p.then === 'function') {
          p.catch(() => {});
        }
      }
      onCanPlay?.();
    });

    player.on('loadedmetadata', () => {
      const v = videoElementRef.current;
      const width = v?.videoWidth || player.videoWidth() || 0;
      const height = v?.videoHeight || player.videoHeight() || 0;
      const dur = player.duration() || 0;
      onLoadedMetadata?.(width, height, dur);
      if (v?.textTracks && onTextTracksChange) {
        onTextTracksChange(v.textTracks);
      }
    });

    player.on('ended', () => onEnded?.());

    player.on('error', () => {
      const err = player.error();
      onError?.(err ? err.code : null, err ? err.message : undefined);
    });

    // Listen to native textTracks
    const v = videoElementRef.current;
    const handleAddTrack = () => {
      if (v?.textTracks && onTextTracksChange) {
        onTextTracksChange(v.textTracks);
      }
    };
    if (v?.textTracks) {
      v.textTracks.addEventListener('addtrack', handleAddTrack);
    }

    return () => {
      isDisposedRef.current = true;
      if (v?.textTracks) {
        v.textTracks.removeEventListener('addtrack', handleAddTrack);
      }
      if (player && !player.isDisposed()) {
        player.dispose();
        playerRef.current = null;
      }
    };
  }, [src]);

  // Apply responsive CSS style to the video element inside VideoJS
  useEffect(() => {
    if (videoElementRef.current) {
      Object.assign(videoElementRef.current.style, videoStyle);
    }
  }, [videoStyle]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex items-center justify-center overflow-hidden"
    />
  );
};
