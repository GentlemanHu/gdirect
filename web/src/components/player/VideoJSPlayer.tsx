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

    // Create fresh video tag inside container to let video.js bind cleanly
    const videoElement = document.createElement('video');
    videoElement.className = 'video-js vjs-custom-skin';
    videoElement.playsInline = true;
    videoElement.setAttribute('webkit-playsinline', 'true');
    videoElement.setAttribute('x5-playsinline', 'true');
    videoElement.setAttribute('preload', 'auto');
    videoElement.setAttribute('crossorigin', 'anonymous');
    container.appendChild(videoElement);
    videoElementRef.current = videoElement;

    let player: any = null;
    try {
      player = (videojs as any)(videoElement, {
        autoplay: true,
        controls: false,
        preload: 'auto',
        fluid: false,
        responsive: true,
        sources: [{ src }],
        poster,
      });
      playerRef.current = player;
    } catch (e: any) {
      console.warn('VideoJS initialization fallback:', e);
      onError?.(null, e?.message);
      return;
    }

    player.ready(() => {
      if (isDisposedRef.current) return;

      const handle: VideoJSPlayerHandle = {
        play: () => {
          userPausedRef.current = false;
          try {
            const p = player.play();
            if (p && typeof p.then === 'function') {
              p.catch((err: any) => {
                if (err && err.name === 'NotAllowedError') {
                  player.muted(true);
                  player.play()?.catch(() => {});
                }
              });
            }
          } catch {}
        },
        pause: () => {
          userPausedRef.current = true;
          try {
            player.pause();
          } catch {}
        },
        seek: (time: number) => {
          try {
            player.currentTime(time);
          } catch {}
        },
        setVolume: (vol: number) => {
          try {
            player.volume(vol);
          } catch {}
        },
        setMuted: (muted: boolean) => {
          try {
            player.muted(muted);
          } catch {}
        },
        setPlaybackRate: (rate: number) => {
          try {
            player.playbackRate(rate);
          } catch {}
        },
        requestFullscreen: () => {
          try {
            if (player.requestFullscreen) {
              player.requestFullscreen();
            }
          } catch {}
        },
        getVideoElement: () => videoElementRef.current,
        getPlayer: () => playerRef.current,
      };

      if (onPlayerReady) onPlayerReady(handle);
    });

    // Helper: auto-resume playback when enough buffer is available, provided user has NOT paused
    const tryAutoResume = () => {
      if (isDisposedRef.current || userPausedRef.current || !player) return;
      if (player.paused()) {
        const v = videoElementRef.current;
        // readyState >= 2 (HAVE_CURRENT_DATA) means media has enough data to render at least current position
        if (!v || v.readyState >= 2) {
          try {
            const p = player.play();
            if (p && typeof p.then === 'function') {
              p.catch((err: any) => {
                if (err && err.name === 'NotAllowedError') {
                  player.muted(true);
                  player.play()?.catch(() => {});
                }
              });
            }
          } catch {}
        }
      }
    };

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

      // If video was stalled and paused by browser, but we now have buffer ahead, auto-resume
      if (!userPausedRef.current && player.paused() && (bufferedAhead >= 0.5 || (videoElementRef.current && videoElementRef.current.readyState >= 3))) {
        tryAutoResume();
      }
    });

    player.on('play', () => onPlay?.());
    player.on('pause', () => onPause?.());
    player.on('waiting', () => onWaiting?.());
    player.on('playing', () => onPlaying?.());

    // Buffer ready signals
    player.on('canplay', () => {
      tryAutoResume();
      onCanPlay?.();
    });

    player.on('canplaythrough', () => {
      tryAutoResume();
      onCanPlay?.();
    });

    player.on('loadeddata', () => {
      tryAutoResume();
    });

    player.on('progress', () => {
      tryAutoResume();
    });

    // Active stall watchdog: guarantees resumption when chunk download finishes after a stall
    const stallWatchdog = setInterval(() => {
      if (isDisposedRef.current || userPausedRef.current || !playerRef.current) return;
      const p = playerRef.current;
      if (p.paused()) {
        const v = videoElementRef.current;
        if (v && v.readyState >= 2) {
          tryAutoResume();
        }
      }
    }, 600);

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
      clearInterval(stallWatchdog);
      if (v?.textTracks) {
        v.textTracks.removeEventListener('addtrack', handleAddTrack);
      }
      if (player && !player.isDisposed()) {
        try {
          player.dispose();
        } catch {}
        playerRef.current = null;
      }
      if (container) {
        container.innerHTML = '';
      }
    };
  }, [src]);

  // Apply responsive CSS style to the video element and wrapper inside VideoJS
  useEffect(() => {
    if (playerRef.current && !playerRef.current.isDisposed()) {
      const el = playerRef.current.el();
      const tech = playerRef.current.tech()?.el();
      if (el) {
        Object.assign(el.style, {
          width: aspectRatio === 'fill' || aspectRatio === 'cover' ? '100%' : 'auto',
          height: aspectRatio === 'fill' || aspectRatio === 'cover' ? '100%' : 'auto',
          maxWidth: '100%',
          maxHeight: '100%',
          aspectRatio: videoStyle.aspectRatio,
          margin: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        });
      }
      if (tech) {
        Object.assign(tech.style, {
          objectFit: videoStyle.objectFit,
          width: '100%',
          height: '100%',
          maxWidth: '100%',
          maxHeight: '100%',
        });
      }
    } else if (videoElementRef.current) {
      Object.assign(videoElementRef.current.style, videoStyle);
    }
  }, [videoStyle, aspectRatio]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex items-center justify-center overflow-hidden"
    />
  );
};
