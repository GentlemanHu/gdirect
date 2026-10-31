import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  Activity,
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FastForward,
  Film,
  Globe,
  Info,
  ListOrdered,
  Maximize,
  Minimize,
  Minimize2,
  Pause,
  PictureInPicture,
  Play,
  RectangleHorizontal,
  RefreshCw,
  RotateCcw,
  SkipBack,
  SkipForward,
  Smartphone,
  Subtitles,
  Tv,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import { DriveFile, SystemStatus, StreamSession } from '../types';
import { copyToClipboard } from '../utils/clipboard';
import { fetchVideoSubtitle, saveVideoSubtitle } from '../api';
import {
  SubtitleCue,
  SubtitleStyleConfig,
  parseSubtitle,
  loadSavedSubtitleStyle,
  saveSubtitleStyle,
  splitBilingualText,
} from '../utils/subtitles';
import { AspectRatioMode, EmbeddedTrack, OnlineSubItem } from './player/types';
import { SubtitleMenu } from './player/SubtitleMenu';
import { QueueMenu } from './player/QueueMenu';
import { ExternalPlayerModal } from './player/ExternalPlayerModal';
import { PlayerInfoDrawer } from './player/PlayerInfoDrawer';

interface PlayerModalProps {
  file: DriveFile;
  status: SystemStatus | null;
  folderFiles?: DriveFile[];
  onClose: () => void;
  onSelectFile?: (file: DriveFile) => void;
}

export const PlayerModal: React.FC<PlayerModalProps> = ({
  file,
  status,
  folderFiles = [],
  onClose,
  onSelectFile,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const userPausedRef = useRef<boolean>(false);

  // Core Playback State
  const [isPlaying, setIsPlaying] = useState(false);
  const [isUserPaused, setIsUserPaused] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [bufferedPercent, setBufferedPercent] = useState(0);
  const [bufferedAheadSecs, setBufferedAheadSecs] = useState(0);
  const [isBuffering, setIsBuffering] = useState(true);
  const [hasPlayedFirstFrame, setHasPlayedFirstFrame] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Interaction feedback ripples & badges
  const [centerIconState, setCenterIconState] = useState<'play' | 'pause' | 'forward' | 'backward' | null>(null);
  const [isSpeedBoosted, setIsSpeedBoosted] = useState(false);
  const speedBoostRestoreRateRef = useRef<number>(1);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastTapTimeRef = useRef<{ time: number; x: number }>({ time: 0, x: 0 });

  // Error & Resilient Recovery State
  const [videoError, setVideoError] = useState<string | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [retryCount, setRetryCount] = useState<number>(0);
  const [retryCountdown, setRetryCountdown] = useState<number | null>(null);
  const retryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [showExternalModal, setShowExternalModal] = useState(false);
  const [useOfficial302, setUseOfficial302] = useState(false);

  // Floating Mini-Player State
  const [isFloating, setIsFloating] = useState(false);

  // Progress Memory (Resume)
  const [resumePrompt, setResumePrompt] = useState<{ time: number } | null>(null);
  const lastSavedTimeRef = useRef<number>(0);

  // Menus & Overlays
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);
  const [showQueueMenu, setShowQueueMenu] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [immersiveMode, setImmersiveMode] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [actionToast, setActionToast] = useState<string | null>(null);

  // Video Metadata & Aspect Ratio (Default strictly contain = 零裁切原画自适应)
  const [videoWidth, setVideoWidth] = useState(0);
  const [videoHeight, setVideoHeight] = useState(0);
  const [aspectRatio, setAspectRatio] = useState<AspectRatioMode>('contain');
  const [showAspectMenu, setShowAspectMenu] = useState(false);

  // Device & Platform Detection
  const isIOS = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    return (
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );
  }, []);

  const isMobile = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    return (
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
      (typeof window !== 'undefined' && window.innerWidth < 768)
    );
  }, []);

  // Subtitle System (Dual Subtitles & Custom Styling)
  const [primaryCues, setPrimaryCues] = useState<SubtitleCue[]>([]);
  const [secondaryCues, setSecondaryCues] = useState<SubtitleCue[]>([]);
  const [primaryName, setPrimaryName] = useState<string>('无');
  const [secondaryName, setSecondaryName] = useState<string>('无');
  const [primarySubId, setPrimarySubId] = useState<string | null>(null);
  const [secondarySubId, setSecondarySubId] = useState<string | null>(null);
  const [subOffsetSecs, setSubOffsetSecs] = useState<number>(0);

  // Embedded Video Text Tracks
  const [embeddedTracks, setEmbeddedTracks] = useState<EmbeddedTrack[]>([]);
  const [activeEmbeddedTrack, setActiveEmbeddedTrack] = useState<number | null>(null);
  const [embeddedSubtitleText, setEmbeddedSubtitleText] = useState<string | null>(null);

  // Subtitle Appearance Customization
  const [subStyle, setSubStyle] = useState<SubtitleStyleConfig>(loadSavedSubtitleStyle);

  const updateSubStyle = (patch: Partial<SubtitleStyleConfig>) => {
    setSubStyle((prev) => {
      const next = { ...prev, ...patch };
      saveSubtitleStyle(next);
      return next;
    });
  };

  const persistSubtitleMemory = (
    pId: string | null = primarySubId,
    pName: string | null = primaryName,
    sId: string | null = secondarySubId,
    sName: string | null = secondaryName,
    offset: number = subOffsetSecs
  ) => {
    const pref = {
      primary_sub_id: pId,
      primary_sub_name: pName,
      secondary_sub_id: sId,
      secondary_sub_name: sName,
      sub_offset: offset,
    };
    try {
      localStorage.setItem(`gdirect_sub_${file.id}`, JSON.stringify(pref));
    } catch {}
    saveVideoSubtitle(file.id, pref);
  };

  // Subtitle Sources Configuration
  const [customSourceUrl, setCustomSourceUrl] = useState(() => {
    return localStorage.getItem('gdirect_custom_sub_source') || '';
  });
  const [subtitleSources, setSubtitleSources] = useState<string[]>(() => {
    const saved = localStorage.getItem('gdirect_sub_sources_list');
    return saved ? JSON.parse(saved) : ['全盘 Google Drive 检索'];
  });

  // Online Subtitle Keyword
  const cleanTitle = useMemo(() => {
    return file.name
      .replace(/\.(mp4|mkv|avi|mov|wmv|flv|webm|ts|m4v)$/i, '')
      .replace(/[\._\(\)\[\]\-]/g, ' ')
      .replace(/\b(1080p|2160p|4k|720p|bluray|bdrip|web-dl|x264|x265|hevc|aac|dts|remux|h264|h265)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }, [file.name]);

  // Playlist / Queue Management
  const isVideoFile = (f: DriveFile) => {
    const ext = f.name.toLowerCase().split('.').pop() || '';
    return f.mimeType.startsWith('video/') || ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'ts', 'm4v'].includes(ext);
  };

  const folderVideoList = useMemo(() => {
    return folderFiles.filter(isVideoFile);
  }, [folderFiles]);

  const [playQueue, setPlayQueue] = useState<DriveFile[]>(() => {
    const saved = localStorage.getItem('gdirect_play_queue');
    if (saved) {
      try {
        const q = JSON.parse(saved) as DriveFile[];
        if (q.some((item) => item.id === file.id)) return q;
      } catch {}
    }
    return folderVideoList.length > 0 ? folderVideoList : [file];
  });

  const [autoNext, setAutoNext] = useState(() => {
    return localStorage.getItem('gdirect_auto_next') !== 'false';
  });

  const currentQueueIndex = useMemo(() => {
    return playQueue.findIndex((item) => item.id === file.id);
  }, [playQueue, file.id]);

  // Real-time speed from backend
  const [streamSpeedMbps, setStreamSpeedMbps] = useState<string>('0.0');

  useEffect(() => {
    let active = true;
    const pollSpeed = () => {
      fetch('/api/sessions')
        .then((r) => r.json())
        .then((sessList: StreamSession[]) => {
          if (!active) return;
          const match = sessList.find((s) => s.file_id === file.id);
          if (match && match.speed_kbps > 0) {
            setStreamSpeedMbps(((match.speed_kbps * 8) / 1024).toFixed(1));
          } else {
            setStreamSpeedMbps('0.0');
          }
        })
        .catch(() => {});
    };

    pollSpeed();
    const timer = setInterval(pollSpeed, 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [file.id]);

  const key = localStorage.getItem('gdirect_api_key');
  const tokenParam = key ? `?token=${encodeURIComponent(key)}` : '';
  const baseStreamUrl = `${window.location.origin}/d/${file.id}/${encodeURIComponent(file.name)}${tokenParam}`;
  const streamUrl = useOfficial302 ? `${baseStreamUrl}${tokenParam ? '&' : '?'}mode=302` : baseStreamUrl;
  const official302Url = `${baseStreamUrl}${tokenParam ? '&' : '?'}mode=302`;

  const resolutionBadge = useMemo(() => {
    if (videoWidth >= 3800 || videoHeight >= 2000) return '4K UHD';
    if (videoWidth >= 1900 || videoHeight >= 1000) return '1080p FHD';
    if (videoWidth >= 1200 || videoHeight >= 700) return '720p HD';
    if (videoHeight > 0) return `${videoHeight}p`;
    return 'HD';
  }, [videoWidth, videoHeight]);

  const avgBitrateMbps = useMemo(() => {
    const bytes = parseInt(file.size || '0', 10);
    if (bytes > 0 && duration > 0) {
      return ((bytes * 8) / duration / (1024 * 1024)).toFixed(1);
    }
    return null;
  }, [file.size, duration]);

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '00:00';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    const mStr = m.toString().padStart(2, '0');
    const sStr = s.toString().padStart(2, '0');
    if (h > 0) return `${h}:${mStr}:${sStr}`;
    return `${mStr}:${sStr}`;
  };

  const showToast = (text: string) => {
    setActionToast(text);
    setTimeout(() => setActionToast(null), 1500);
  };

  const triggerCenterFeedback = (type: 'play' | 'pause' | 'forward' | 'backward') => {
    setCenterIconState(type);
    setTimeout(() => setCenterIconState(null), 500);
  };

  // Aspect ratio label dictionary
  const aspectLabels: Record<AspectRatioMode, string> = {
    contain: '原画自适应 (零裁切)',
    cover: '铺满屏幕 (裁剪去黑边)',
    fill: '拉伸全屏',
    '16:9': '16:9 标准宽屏',
    '4:3': '4:3 经典方屏',
    '21:9': '21:9 影院超宽屏',
  };

  const cycleAspectRatio = () => {
    const modes: AspectRatioMode[] = ['contain', 'cover', 'fill', '16:9', '4:3', '21:9'];
    const nextIdx = (modes.indexOf(aspectRatio) + 1) % modes.length;
    const nextMode = modes[nextIdx];
    setAspectRatio(nextMode);
    showToast(`画面比例: ${aspectLabels[nextMode]}`);
  };

  const selectAspectRatio = (mode: AspectRatioMode) => {
    setAspectRatio(mode);
    setShowAspectMenu(false);
    showToast(`画面比例: ${aspectLabels[mode]}`);
  };

  // Embedded Subtitle Detection & Track Selection
  const detectEmbeddedTracks = () => {
    if (!videoRef.current) return;
    const tracks = videoRef.current.textTracks;
    const list: EmbeddedTrack[] = [];
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      list.push({
        index: i,
        label: t.label || `内嵌字幕 #${i + 1}`,
        language: t.language || '未知语言',
        kind: t.kind || 'subtitles',
      });
    }
    setEmbeddedTracks(list);
  };

  const handleSelectEmbeddedTrack = (trackIndex: number, target: 'primary' | 'secondary' = 'primary') => {
    if (!videoRef.current) return;
    const tracks = videoRef.current.textTracks;
    for (let i = 0; i < tracks.length; i++) {
      tracks[i].mode = 'disabled';
    }
    if (tracks[trackIndex]) {
      tracks[trackIndex].mode = 'hidden';
      setActiveEmbeddedTrack(trackIndex);
      const sel = tracks[trackIndex];
      const trackName = `[内置轨道] ${sel.label || `轨道 #${trackIndex + 1}`} (${sel.language || 'auto'})`;
      if (target === 'primary') {
        setPrimaryName(trackName);
        setPrimarySubId(`embedded-${trackIndex}`);
        setPrimaryCues([]);
        persistSubtitleMemory(`embedded-${trackIndex}`, trackName, secondarySubId, secondaryName);
      } else {
        setSecondaryName(trackName);
        setSecondarySubId(`embedded-${trackIndex}`);
        setSecondaryCues([]);
        persistSubtitleMemory(primarySubId, primaryName, `embedded-${trackIndex}`, trackName);
      }
      showToast(`已启用: ${trackName}`);
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const handleAddTrack = () => detectEmbeddedTracks();
    video.textTracks.addEventListener('addtrack', handleAddTrack);
    return () => {
      video.textTracks.removeEventListener('addtrack', handleAddTrack);
    };
  }, []);

  useEffect(() => {
    if (!videoRef.current || activeEmbeddedTrack === null) return;
    const track = videoRef.current.textTracks[activeEmbeddedTrack];
    if (!track) return;

    const handleCueChange = () => {
      if (track.activeCues && track.activeCues.length > 0) {
        const textParts: string[] = [];
        for (let i = 0; i < track.activeCues.length; i++) {
          const c = track.activeCues[i] as any;
          if (c && c.text) textParts.push(c.text);
        }
        setEmbeddedSubtitleText(textParts.join('\n'));
      } else {
        setEmbeddedSubtitleText(null);
      }
    };

    track.addEventListener('cuechange', handleCueChange);
    return () => {
      track.removeEventListener('cuechange', handleCueChange);
    };
  }, [activeEmbeddedTrack]);

  const sameFolderSubtitles = useMemo(() => {
    return folderFiles.filter((f) => {
      const lower = f.name.toLowerCase();
      return lower.endsWith('.srt') || lower.endsWith('.vtt') || lower.endsWith('.ass') || lower.endsWith('.ssa');
    });
  }, [folderFiles]);

  const loadSubById = async (subId: string, subName: string, target: 'primary' | 'secondary') => {
    try {
      const url = `${window.location.origin}/d/${subId}/${encodeURIComponent(subName)}${tokenParam}`;
      const res = await fetch(url);
      if (res.ok) {
        const text = await res.text();
        const cues = parseSubtitle(text);
        if (target === 'primary') {
          setPrimaryCues(cues);
          setPrimaryName(subName);
          setPrimarySubId(subId);
        } else {
          setSecondaryCues(cues);
          setSecondaryName(subName);
          setSecondarySubId(subId);
        }
        if (videoRef.current) {
          setCurrentTime(videoRef.current.currentTime);
        }
        return cues.length > 0;
      }
    } catch {}
    return false;
  };

  useEffect(() => {
    let restored = false;
    const localSaved = localStorage.getItem(`gdirect_sub_${file.id}`);
    if (localSaved) {
      try {
        const pref = JSON.parse(localSaved);
        if (pref.primary_sub_id && pref.primary_sub_name) {
          loadSubById(pref.primary_sub_id, pref.primary_sub_name, 'primary');
          restored = true;
        }
        if (pref.secondary_sub_id && pref.secondary_sub_name) {
          loadSubById(pref.secondary_sub_id, pref.secondary_sub_name, 'secondary');
        }
        if (pref.sub_offset) setSubOffsetSecs(pref.sub_offset);
      } catch {}
    }

    if (!restored) {
      fetchVideoSubtitle(file.id).then((serverPref) => {
        if (serverPref && serverPref.primary_sub_id && serverPref.primary_sub_name) {
          loadSubById(serverPref.primary_sub_id, serverPref.primary_sub_name, 'primary');
          if (serverPref.secondary_sub_id && serverPref.secondary_sub_name) {
            loadSubById(serverPref.secondary_sub_id, serverPref.secondary_sub_name, 'secondary');
          }
          if (serverPref.sub_offset) setSubOffsetSecs(serverPref.sub_offset);
        } else if (sameFolderSubtitles.length > 0) {
          const videoStem = file.name.substring(0, file.name.lastIndexOf('.')).toLowerCase();
          const match = sameFolderSubtitles.find((s) => {
            const subName = s.name.toLowerCase();
            return subName.includes(videoStem) || subName.startsWith(videoStem.substring(0, Math.min(8, videoStem.length)));
          });
          const chosen = match || sameFolderSubtitles[0];
          loadSubById(chosen.id, chosen.name, 'primary');
        }
      });
    }
  }, [file.id, sameFolderSubtitles]);

  const handleAddCustomSource = (url: string) => {
    if (!url.trim()) return;
    setCustomSourceUrl(url.trim());
    localStorage.setItem('gdirect_custom_sub_source', url.trim());
    const updated = Array.from(new Set([...subtitleSources, url.trim()]));
    setSubtitleSources(updated);
    localStorage.setItem('gdirect_sub_sources_list', JSON.stringify(updated));
    showToast('自定义字幕源已保存');
  };

  const playNextInQueue = () => {
    if (playQueue.length === 0) return;
    const nextIdx = (currentQueueIndex + 1) % playQueue.length;
    const nextFile = playQueue[nextIdx];
    if (nextFile && onSelectFile) {
      onSelectFile(nextFile);
      showToast(`下一集: ${nextFile.name}`);
    }
  };

  const playPrevInQueue = () => {
    if (playQueue.length === 0) return;
    const prevIdx = (currentQueueIndex - 1 + playQueue.length) % playQueue.length;
    const prevFile = playQueue[prevIdx];
    if (prevFile && onSelectFile) {
      onSelectFile(prevFile);
      showToast(`上一集: ${prevFile.name}`);
    }
  };

  // Buffer Tracking
  const updateBufferInfo = useCallback(() => {
    if (!videoRef.current) return;
    const v = videoRef.current;
    const curr = v.currentTime;
    const dur = v.duration;
    const buf = v.buffered;
    if (buf.length > 0) {
      let found = false;
      for (let i = 0; i < buf.length; i++) {
        if (buf.start(i) <= curr && curr <= buf.end(i)) {
          if (dur > 0) setBufferedPercent((buf.end(i) / dur) * 100);
          setBufferedAheadSecs(Math.max(0, Math.round(buf.end(i) - curr)));
          found = true;
          break;
        }
      }
      if (!found) {
        const lastEnd = buf.end(buf.length - 1);
        if (dur > 0) setBufferedPercent((lastEnd / dur) * 100);
        setBufferedAheadSecs(Math.max(0, Math.round(lastEnd - curr)));
      }
    }
  }, []);

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const curr = videoRef.current.currentTime;
    setCurrentTime(curr);

    const nowSec = Math.floor(curr);
    if (Math.abs(nowSec - lastSavedTimeRef.current) >= 2) {
      lastSavedTimeRef.current = nowSec;
      if (nowSec > 3 && duration > 10) {
        localStorage.setItem(`gdirect_prog_${file.id}`, nowSec.toString());
      }
    }

    updateBufferInfo();
  };

  const handleVideoEnded = () => {
    if (autoNext && onSelectFile && playQueue.length > 1) {
      showToast('本集播放完毕，自动播放下一集');
      setTimeout(playNextInQueue, 1000);
    }
  };

  // Subtitle cue matching
  const adjustedTime = currentTime + subOffsetSecs;

  const activeCues = useMemo(() => {
    const rawPrim = primaryCues.length > 0
      ? primaryCues.find((c) => c.start <= adjustedTime && adjustedTime <= c.end)?.text || null
      : embeddedSubtitleText;
    const rawSec = secondaryCues.length > 0
      ? secondaryCues.find((c) => c.start <= adjustedTime && adjustedTime <= c.end)?.text || null
      : null;

    if (rawPrim && !rawSec && subStyle.bilingualSplit) {
      const split = splitBilingualText(rawPrim);
      if (split.secondary) {
        return { primary: split.primary, secondary: split.secondary };
      }
    }

    return { primary: rawPrim, secondary: rawSec };
  }, [primaryCues, secondaryCues, adjustedTime, subStyle.bilingualSplit, embeddedSubtitleText]);

  const getSubtitleItemStyle = (type: 'primary' | 'secondary'): React.CSSProperties => {
    const isPrimary = type === 'primary';
    const color = isPrimary ? subStyle.primaryColor : subStyle.secondaryColor;
    const size = isPrimary ? subStyle.fontSize : Math.max(12, Math.round(subStyle.fontSize * 0.8));

    const base: React.CSSProperties = {
      color,
      fontSize: `${isFloating ? Math.max(10, size * 0.6) : size}px`,
      fontWeight: subStyle.fontWeight === 'bold' ? 700 : subStyle.fontWeight === 'semibold' ? 600 : 400,
      lineHeight: 1.35,
    };

    if (subStyle.bgStyle === 'stroke') {
      return {
        ...base,
        textShadow:
          '-1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000, 0 3px 6px rgba(0,0,0,0.9)',
      };
    }
    if (subStyle.bgStyle === 'shadow') {
      return {
        ...base,
        filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.95))',
      };
    }
    if (subStyle.bgStyle === 'box') {
      return {
        ...base,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        padding: '3px 12px',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(4px)',
      };
    }
    return base;
  };

  // Safe Play: Strictly checks userPausedRef to prevent unwanted auto-resume after pause!
  const safePlay = useCallback(() => {
    if (userPausedRef.current) return;
    const video = videoRef.current;
    if (!video || !video.paused) return;
    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          setIsPlaying(true);
          setIsUserPaused(false);
          setIsBuffering(false);
        })
        .catch((err) => {
          if (err.name === 'NotAllowedError') {
            video.muted = true;
            setIsMuted(true);
            video
              .play()
              .then(() => {
                setIsPlaying(true);
                setIsUserPaused(false);
                setIsBuffering(false);
                showToast('已静音播放 (点击音量可开启声音)');
              })
              .catch(() => {});
          }
        });
    }
  }, []);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      userPausedRef.current = false;
      setIsUserPaused(false);
      safePlay();
      triggerCenterFeedback('play');
    } else {
      userPausedRef.current = true;
      setIsUserPaused(true);
      videoRef.current.pause();
      setIsPlaying(false);
      triggerCenterFeedback('pause');
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    const time = parseFloat(e.target.value);
    videoRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    const val = parseFloat(e.target.value);
    videoRef.current.volume = val;
    setVolume(val);
    setIsMuted(val === 0);
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    const targetMute = !isMuted;
    videoRef.current.muted = targetMute;
    setIsMuted(targetMute);
  };

  const setSpeed = (rate: number) => {
    if (!videoRef.current) return;
    videoRef.current.playbackRate = rate;
    setPlaybackRate(rate);
    setShowSpeedMenu(false);
    showToast(`${rate}x 速度`);
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const enterNativeSystemPlayer = () => {
    if (!videoRef.current) return;
    const v = videoRef.current as any;
    try {
      if (typeof v.webkitEnterFullscreen === 'function') {
        v.webkitEnterFullscreen();
        showToast('唤起系统原生播放器');
      } else if (v.requestFullscreen) {
        v.requestFullscreen().catch(() => {});
      }
    } catch (e) {
      console.warn('Native player launch error:', e);
    }
  };

  const togglePiP = async () => {
    if (!videoRef.current) return;
    const v = videoRef.current as any;
    try {
      if (typeof v.webkitSetPresentationMode === 'function') {
        const currentMode = v.webkitPresentationMode;
        const targetMode = currentMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture';
        v.webkitSetPresentationMode(targetMode);
        showToast(targetMode === 'picture-in-picture' ? '进入画中画' : '退出画中画');
        return;
      }
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        showToast('退出画中画');
      } else if (v.requestPictureInPicture) {
        await v.requestPictureInPicture();
        showToast('进入画中画');
      } else if (typeof v.webkitEnterFullscreen === 'function') {
        v.webkitEnterFullscreen();
      } else {
        setIsFloating((prev) => !prev);
        showToast(isFloating ? '全屏展开' : '页面悬浮小窗');
      }
    } catch (err) {
      if (typeof v.webkitEnterFullscreen === 'function') {
        v.webkitEnterFullscreen();
      } else {
        setIsFloating((prev) => !prev);
      }
    }
  };

  // Stream reload & error recovery
  const performStreamReload = (switchRoute = false) => {
    if (retryTimerRef.current) clearInterval(retryTimerRef.current);
    setRetryCountdown(null);
    setVideoError(null);
    setIsReconnecting(false);
    setIsBuffering(true);

    if (switchRoute) {
      const next302 = !useOfficial302;
      setUseOfficial302(next302);
      showToast(next302 ? '已切换至官方 302 线路' : '已切换至国内边缘直连');
    } else {
      showToast('正在重试视频流连接...');
    }

    const cur = currentTime || videoRef.current?.currentTime || 0;
    setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.load();
        videoRef.current.currentTime = cur;
        if (!userPausedRef.current) {
          safePlay();
        }
      }
    }, 250);
  };

  const handleVideoError = () => {
    const err = videoRef.current?.error;
    const code = err?.code;
    console.warn('Video playback error:', code, err);

    if (retryCount < 2) {
      setRetryCount((prev) => prev + 1);
      setRetryCountdown(2);
      setIsReconnecting(true);
      setIsBuffering(true);

      if (retryTimerRef.current) clearInterval(retryTimerRef.current);
      let count = 2;
      retryTimerRef.current = setInterval(() => {
        count -= 1;
        setRetryCountdown(count);
        if (count <= 0) {
          if (retryTimerRef.current) clearInterval(retryTimerRef.current);
          setRetryCountdown(null);
          performStreamReload(false);
        }
      }, 1000);
      return;
    }

    let message = '网络流连接超时或缓冲中断，可立即重试或切换传输线路';
    if (code === 4) {
      message = '当前浏览器可能无法直接解码此视频封装格式，建议使用官方直链或外部播放器';
    } else if (code === 3) {
      message = '视频解码遇到错误，建议重试或切换为官方直链';
    } else if (code === 2) {
      message = '网络请求连接超时或中断';
    }
    setVideoError(message);
    setIsReconnecting(false);
    setRetryCountdown(null);
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (videoRef.current) {
            videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 5);
            triggerCenterFeedback('backward');
            showToast('-5s');
          }
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (videoRef.current) {
            videoRef.current.currentTime = Math.min(duration, videoRef.current.currentTime + 5);
            triggerCenterFeedback('forward');
            showToast('+5s');
          }
          break;
        case 'KeyF':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'KeyM':
          e.preventDefault();
          toggleMute();
          break;
        case 'KeyI':
          e.preventDefault();
          setShowInfo((prev) => !prev);
          break;
        case 'KeyZ':
          e.preventDefault();
          setImmersiveMode((prev) => !prev);
          showToast(immersiveMode ? '退出沉浸' : '沉浸观影');
          break;
        case 'KeyC':
          e.preventDefault();
          cycleAspectRatio();
          break;
        case 'KeyN':
          e.preventDefault();
          playNextInQueue();
          break;
        case 'KeyP':
          e.preventDefault();
          playPrevInQueue();
          break;
        case 'Escape':
          if (immersiveMode) {
            setImmersiveMode(false);
            showToast('已退出沉浸观影');
          } else if (!document.fullscreenElement) {
            onClose();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [duration, isPlaying, isMuted, immersiveMode, playQueue, currentQueueIndex, aspectRatio]);

  const handleMouseMove = () => {
    setControlsVisible(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying && !immersiveMode) setControlsVisible(false);
    }, 2800);
  };

  // Touch and click handlers for mobile & gestures
  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    const now = Date.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const width = rect.width;

    // Check double-tap gesture
    if (now - lastTapTimeRef.current.time < 320 && Math.abs(x - lastTapTimeRef.current.x) < 80) {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      if (x < width * 0.35) {
        if (videoRef.current) {
          videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10);
          triggerCenterFeedback('backward');
          showToast('-10s 快退');
        }
      } else if (x > width * 0.65) {
        if (videoRef.current) {
          videoRef.current.currentTime = Math.min(duration, videoRef.current.currentTime + 10);
          triggerCenterFeedback('forward');
          showToast('+10s 快进');
        }
      } else {
        togglePlay();
      }
      lastTapTimeRef.current = { time: 0, x: 0 };
      return;
    }

    lastTapTimeRef.current = { time: now, x };

    // Long press for 2x speed
    if (isPlaying && videoRef.current) {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = setTimeout(() => {
        if (videoRef.current && isPlaying) {
          speedBoostRestoreRateRef.current = videoRef.current.playbackRate;
          videoRef.current.playbackRate = 2.0;
          setIsSpeedBoosted(true);
        }
      }, 550);
    }
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    if (isSpeedBoosted && videoRef.current) {
      videoRef.current.playbackRate = speedBoostRestoreRateRef.current;
      setIsSpeedBoosted(false);
    }
  };

  const handleScreenClick = (e: React.MouseEvent) => {
    if (immersiveMode) {
      setControlsVisible(true);
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 4000);
      return;
    }
    togglePlay();
  };

  const handleCopyUrl = (urlToCopy: string = streamUrl) => {
    copyToClipboard(urlToCopy);
    setCopyFeedback(true);
    showToast('直链已复制');
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  // Accurate CSS geometry based on selected aspect ratio
  const videoStyle: React.CSSProperties = useMemo(() => {
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

  return (
    <div
      className={
        isFloating
          ? 'fixed bottom-4 right-4 z-50 w-80 sm:w-96 rounded-2xl overflow-hidden shadow-2xl border border-slate-700 bg-black animate-fade-in'
          : 'fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-xl animate-fade-in'
      }
    >
      <div
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className={`relative w-full h-full flex flex-col justify-between bg-black overflow-hidden select-none ${
          !controlsVisible && isPlaying && !isFloating && !immersiveMode ? 'cursor-none' : 'cursor-default'
        } ${isFloating ? 'aspect-video' : ''}`}
      >
        {/* Floating Immersive Exit Button */}
        {immersiveMode && (
          <div className="absolute top-4 inset-x-0 flex justify-center z-50 pointer-events-auto animate-fade-in">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setImmersiveMode(false);
                setControlsVisible(true);
                showToast('已退出沉浸模式');
              }}
              className="px-4 py-2 rounded-full bg-slate-900/95 hover:bg-slate-800 text-cyan-300 border border-cyan-500/50 shadow-2xl backdrop-blur-md text-xs font-semibold flex items-center space-x-2 transition-all active:scale-95"
            >
              <EyeOff className="w-4 h-4" />
              <span>退出沉浸观影</span>
            </button>
          </div>
        )}

        {/* Long Press 2x Speed Pill Banner */}
        {isSpeedBoosted && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-1.5 rounded-full bg-cyan-500/90 text-slate-950 font-bold text-xs shadow-2xl flex items-center space-x-1.5 animate-pulse">
            <FastForward className="w-3.5 h-3.5" />
            <span>2.0x 极速快进中</span>
          </div>
        )}

        {/* Top Header Bar */}
        <div
          className={`absolute top-0 inset-x-0 z-30 p-2.5 sm:p-4 bg-gradient-to-b from-black/90 via-black/40 to-transparent transition-opacity duration-300 flex items-center justify-between ${
            controlsVisible && !immersiveMode ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className="flex items-center space-x-2 sm:space-x-3 max-w-[45%] sm:max-w-xl">
            <button
              onClick={onClose}
              className="p-1.5 sm:p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/60 transition-colors"
            >
              <X className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
            <h2 className="text-xs sm:text-base font-semibold text-white truncate" title={file.name}>
              {file.name}
            </h2>
          </div>

          {/* Top Indicators & Badges */}
          <div className="flex items-center space-x-1 sm:space-x-2 shrink-0">
            {/* Resolution Badge */}
            <span className="px-2 py-0.5 rounded-lg bg-cyan-950/80 border border-cyan-800/60 font-mono text-cyan-300 text-[10px] sm:text-xs font-bold">
              {resolutionBadge}
            </span>

            {/* Stream Engine Route Badge */}
            <button
              onClick={() => {
                const nextMode = !useOfficial302;
                setUseOfficial302(nextMode);
                setVideoError(null);
                showToast(nextMode ? '已切换: 官方 302' : '已切换: 边缘直连');
              }}
              className={`hidden sm:flex px-2 py-0.5 rounded-lg text-[10px] sm:text-xs font-mono font-semibold border transition-colors items-center space-x-1 ${
                useOfficial302
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                  : 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'
              }`}
            >
              <span>{useOfficial302 ? '官方 302' : '边缘直连'}</span>
            </button>

            {/* Live Rate & Buffer Pill */}
            <div className="flex px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-lg bg-slate-900/80 border border-slate-800 text-[10px] sm:text-xs font-mono text-slate-300 items-center space-x-1 sm:space-x-1.5">
              <Zap className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-cyan-400" />
              <span>{streamSpeedMbps} Mbps</span>
              {bufferedAheadSecs > 0 && (
                <span className="text-emerald-400 font-medium">+{bufferedAheadSecs}s</span>
              )}
            </div>

            {/* External Player Menu Button */}
            <button
              onClick={() => setShowExternalModal(true)}
              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 hover:text-white transition-colors flex items-center space-x-1"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">外部播放</span>
            </button>

            {/* Floating Mini-Player Switch */}
            <button
              onClick={() => {
                setIsFloating(!isFloating);
                showToast(isFloating ? '全屏展开' : '页面悬浮');
              }}
              className={`p-1.5 rounded-lg text-xs font-mono border transition-colors flex items-center space-x-1 ${
                isFloating
                  ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                  : 'bg-slate-900/80 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              {isFloating ? <Maximize className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
            </button>

            {/* Info Drawer Toggle */}
            <button
              onClick={() => setShowInfo(!showInfo)}
              className={`p-1.5 rounded-lg text-xs font-mono border transition-colors flex items-center space-x-1 ${
                showInfo
                  ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                  : 'bg-slate-900/80 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Info className="w-3.5 h-3.5" />
            </button>

            {/* Copy Link */}
            <button
              onClick={() => handleCopyUrl(streamUrl)}
              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-900/80 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white transition-colors"
            >
              {copyFeedback ? '已复制' : '直链'}
            </button>
          </div>
        </div>

        {/* Media Details Info Drawer */}
        {showInfo && !isFloating && (
          <PlayerInfoDrawer
            useOfficial302={useOfficial302}
            videoWidth={videoWidth}
            videoHeight={videoHeight}
            resolutionBadge={resolutionBadge}
            avgBitrateMbps={avgBitrateMbps}
            streamSpeedMbps={streamSpeedMbps}
            bufferedAheadSecs={bufferedAheadSecs}
            status={status}
            currentTimeFormatted={formatTime(currentTime)}
            durationFormatted={formatTime(duration)}
            onClose={() => setShowInfo(false)}
          />
        )}

        {/* Action Center Toast */}
        {actionToast && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-40 animate-fade-in">
            <div className="px-5 py-2.5 rounded-2xl bg-black/85 backdrop-blur-md border border-slate-700 text-white font-bold text-base shadow-2xl">
              {actionToast}
            </div>
          </div>
        )}

        {/* Center Play/Pause & Gesture Animation Ripple */}
        {centerIconState && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30 animate-fade-in">
            <div className="p-4 sm:p-5 rounded-full bg-black/70 backdrop-blur-md border border-slate-700/80 text-cyan-400 shadow-2xl animate-scale-up">
              {centerIconState === 'play' && <Play className="w-8 h-8 sm:w-10 sm:h-10 fill-current ml-1" />}
              {centerIconState === 'pause' && <Pause className="w-8 h-8 sm:w-10 sm:h-10 fill-current" />}
              {centerIconState === 'forward' && <FastForward className="w-8 h-8 sm:w-10 sm:h-10 fill-current" />}
              {centerIconState === 'backward' && <RotateCcw className="w-8 h-8 sm:w-10 sm:h-10" />}
            </div>
          </div>
        )}

        {/* Resume Playback Prompt Toast */}
        {resumePrompt && !isFloating && !videoError && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 p-2.5 px-4 rounded-xl bg-slate-900/90 backdrop-blur-md border border-cyan-500/40 text-xs text-white shadow-2xl flex items-center space-x-3 animate-fade-in">
            <span>上次播放至 {formatTime(resumePrompt.time)}</span>
            <button
              onClick={() => {
                if (videoRef.current) videoRef.current.currentTime = 0;
                setResumePrompt(null);
                showToast('已从头播放');
              }}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium"
            >
              从头播放
            </button>
            <button
              onClick={() => setResumePrompt(null)}
              className="text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Video Canvas & Subtitles Area (Strictly uncropped layout) */}
        <div
          onClick={handleScreenClick}
          onDoubleClick={toggleFullscreen}
          className="relative flex-1 w-full h-full min-h-0 min-w-0 overflow-hidden flex items-center justify-center cursor-pointer bg-black"
        >
          <video
            ref={videoRef}
            src={streamUrl}
            autoPlay
            preload="auto"
            playsInline
            {...({ 'webkit-playsinline': 'true', 'x5-playsinline': 'true' } as any)}
            onLoadStart={() => {
              setIsBuffering(true);
              setVideoError(null);
            }}
            onTimeUpdate={handleTimeUpdate}
            onProgress={updateBufferInfo}
            onSeeked={() => {
              handleTimeUpdate();
              updateBufferInfo();
              setIsBuffering(false);
            }}
            onSeeking={() => {
              setIsBuffering(true);
            }}
            onWaiting={() => {
              setIsBuffering(true);
            }}
            onStalled={() => {
              setIsBuffering(true);
            }}
            onLoadedData={() => {
              handleTimeUpdate();
              updateBufferInfo();
              setIsBuffering(false);
            }}
            onPlaying={() => {
              setIsPlaying(true);
              setIsUserPaused(false);
              setIsBuffering(false);
              setHasPlayedFirstFrame(true);
              setVideoError(null);
              setRetryCount(0);
              setRetryCountdown(null);
            }}
            onCanPlay={() => {
              handleTimeUpdate();
              updateBufferInfo();
              setIsBuffering(false);
              // CRITICAL: Never auto-resume playback if the user paused!
              if (
                videoRef.current &&
                videoRef.current.paused &&
                !userPausedRef.current &&
                !videoRef.current.ended
              ) {
                safePlay();
              }
            }}
            onEnded={handleVideoEnded}
            onError={handleVideoError}
            onLoadedMetadata={() => {
              setVideoError(null);
              setIsReconnecting(false);
              setRetryCountdown(null);
              detectEmbeddedTracks();
              if (videoRef.current) {
                const dur = videoRef.current.duration;
                setDuration(dur);
                setVideoWidth(videoRef.current.videoWidth);
                setVideoHeight(videoRef.current.videoHeight);
                updateBufferInfo();

                const savedStr = localStorage.getItem(`gdirect_prog_${file.id}`);
                if (savedStr) {
                  const sec = parseFloat(savedStr);
                  if (sec > 5 && sec < dur - 10) {
                    videoRef.current.currentTime = sec;
                    setCurrentTime(sec);
                    setResumePrompt({ time: sec });
                  } else {
                    setCurrentTime(videoRef.current.currentTime);
                  }
                } else {
                  setCurrentTime(videoRef.current.currentTime);
                }

                if (!userPausedRef.current) {
                  safePlay();
                }
              }
            }}
            onPause={() => {
              setIsPlaying(false);
            }}
            style={videoStyle}
            className="transition-all duration-150"
          />

          {/* Centered Buffering & Speed HUD */}
          {isBuffering && !videoError && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-20 animate-fade-in">
              <div className="p-4 sm:p-5 rounded-2xl bg-black/85 backdrop-blur-md border border-slate-800 shadow-2xl flex flex-col items-center space-y-2.5 min-w-[210px]">
                <div className="relative flex items-center justify-center">
                  <div className="w-10 h-10 rounded-full border-2 border-cyan-500/20 border-t-cyan-400 animate-spin" />
                  <Zap className="w-4 h-4 text-cyan-400 absolute animate-pulse" />
                </div>
                <div className="text-center space-y-1">
                  <div className="text-xs sm:text-sm font-semibold text-white tracking-wide">
                    {isReconnecting
                      ? `网络重连中 ${retryCountdown !== null ? `(${retryCountdown}s)` : '...'}`
                      : isUserPaused
                      ? '已暂停 · 后台预读中'
                      : !hasPlayedFirstFrame
                      ? '连接边缘节点并解析流...'
                      : '缓冲中...'}
                  </div>
                  <div className="flex items-center justify-center space-x-2 text-[10px] sm:text-xs font-mono text-slate-300">
                    <span className="text-cyan-300 font-bold">{streamSpeedMbps} Mbps</span>
                    <span className="text-slate-600">•</span>
                    <span className="text-emerald-400 font-medium">+{bufferedAheadSecs}s 缓冲</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Reconnecting Floating Toast */}
          {isReconnecting && !isBuffering && (
            <div className="absolute top-14 left-1/2 -translate-x-1/2 z-40 px-3 py-1.5 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-xs font-medium flex items-center space-x-1.5 shadow-xl animate-fade-in">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>网络恢复重连中 {retryCountdown !== null ? `(${retryCountdown}s)` : ''}</span>
            </div>
          )}

          {/* In-Player Resilient Recovery Card */}
          {videoError && (
            <div className="absolute inset-0 bg-black/90 backdrop-blur-md z-30 flex items-center justify-center p-4 animate-fade-in">
              <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4 shadow-2xl text-center">
                <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mx-auto text-cyan-400">
                  <RefreshCw className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-bold text-white">播放受阻或缓冲中断</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {videoError}
                  </p>
                </div>

                <div className="space-y-2 pt-2">
                  <div className="flex gap-2">
                    <button
                      onClick={() => performStreamReload(false)}
                      className="flex-1 py-2.5 px-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold shadow-lg shadow-cyan-500/20 transition-all flex items-center justify-center space-x-1.5"
                    >
                      <RefreshCw className="w-4 h-4" />
                      <span>立即重试</span>
                    </button>
                    <button
                      onClick={() => performStreamReload(true)}
                      className="flex-1 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors flex items-center justify-center space-x-1"
                    >
                      <Zap className="w-4 h-4 text-amber-400" />
                      <span>切换为 {useOfficial302 ? '边缘直连' : '官方 302'}</span>
                    </button>
                  </div>

                  {isIOS && (
                    <button
                      onClick={enterNativeSystemPlayer}
                      className="w-full py-2 px-3 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-cyan-300 text-xs font-semibold border border-cyan-500/30 transition-colors flex items-center justify-center space-x-1.5"
                    >
                      <Smartphone className="w-4 h-4" />
                      <span>调用 iOS 原生系统播放器 (支持原生 PiP)</span>
                    </button>
                  )}

                  <button
                    onClick={() => setShowExternalModal(true)}
                    className="w-full py-2 px-3 rounded-xl bg-slate-950/80 hover:bg-slate-800 text-slate-400 hover:text-white text-xs border border-slate-800 transition-colors flex items-center justify-center space-x-1.5"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>第三方播放器 (VLC / Infuse / IINA / MX)</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Subtitles Overlay */}
          <div
            style={{ bottom: `${isFloating ? 16 : subStyle.bottomOffset}px` }}
            className="absolute inset-x-0 flex flex-col items-center pointer-events-none z-20 space-y-1 sm:space-y-1.5 px-3 sm:px-4 text-center transition-all duration-150"
          >
            {activeCues.secondary && (
              <span
                style={getSubtitleItemStyle('secondary')}
                className="max-w-4xl break-words whitespace-pre-line select-none"
              >
                {activeCues.secondary}
              </span>
            )}
            {activeCues.primary && (
              <span
                style={getSubtitleItemStyle('primary')}
                className="max-w-4xl break-words whitespace-pre-line select-none"
              >
                {activeCues.primary}
              </span>
            )}
          </div>
        </div>

        {/* Bottom Control Bar */}
        <div
          className={`absolute bottom-0 inset-x-0 z-30 p-2.5 sm:p-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] bg-gradient-to-t from-black/90 via-black/60 to-transparent transition-opacity duration-300 space-y-2 ${
            controlsVisible && !immersiveMode ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Progress Seek Bar */}
          <div className="relative group/progress flex items-center">
            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden relative">
              <div
                style={{ width: `${bufferedPercent}%` }}
                className="absolute top-0 bottom-0 left-0 bg-slate-600 transition-all duration-300"
              />
              <div
                style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
                className="absolute top-0 bottom-0 left-0 bg-cyan-500"
              />
            </div>

            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.1}
              value={currentTime}
              onChange={handleSeek}
              className="absolute inset-0 w-full h-4 opacity-0 cursor-pointer"
            />
          </div>

          {/* Controls Buttons */}
          <div className="flex items-center justify-between text-white">
            <div className="flex items-center space-x-1 sm:space-x-3">
              {/* Previous in Queue */}
              <button
                onClick={playPrevInQueue}
                className="p-1 sm:p-1.5 rounded-lg text-slate-400 hover:text-white transition-colors"
                title="上一集 (P)"
              >
                <SkipBack className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </button>

              {/* Play / Pause */}
              <button
                onClick={togglePlay}
                className="p-1.5 sm:p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
              >
                {isPlaying ? (
                  <Pause className="w-4 h-4 sm:w-5 sm:h-5 fill-current" />
                ) : (
                  <Play className="w-4 h-4 sm:w-5 sm:h-5 fill-current ml-0.5" />
                )}
              </button>

              {/* Next in Queue */}
              <button
                onClick={playNextInQueue}
                className="p-1 sm:p-1.5 rounded-lg text-slate-400 hover:text-white transition-colors"
                title="下一集 (N)"
              >
                <SkipForward className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </button>

              {/* Volume Slider */}
              <div className="hidden sm:flex items-center space-x-2 group">
                <button
                  onClick={toggleMute}
                  className="p-1.5 rounded-lg text-slate-300 hover:text-white transition-colors"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4 sm:w-5 sm:h-5" />
                  ) : (
                    <Volume2 className="w-4 h-4 sm:w-5 sm:h-5" />
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolume}
                  className="w-16 sm:w-20 h-1 bg-slate-700 accent-cyan-400 rounded-full cursor-pointer"
                />
              </div>

              {/* Time Display */}
              <div className="text-[10px] sm:text-xs font-mono text-slate-300">
                <span>{formatTime(currentTime)}</span>
                <span className="text-slate-500 mx-1">/</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            {/* Right Action Icons */}
            <div className="flex items-center space-x-1 sm:space-x-2">
              {/* Queue List Popover */}
              <div className="relative">
                <button
                  onClick={() => setShowQueueMenu(!showQueueMenu)}
                  className={`p-1.5 sm:p-2 rounded-xl border transition-colors flex items-center space-x-1 ${
                    showQueueMenu
                      ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                      : 'bg-white/10 border-transparent text-slate-300 hover:text-white'
                  }`}
                  title="播放队列"
                >
                  <ListOrdered className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </button>

                {showQueueMenu && (
                  <QueueMenu
                    playQueue={playQueue}
                    currentFileId={file.id}
                    autoNext={autoNext}
                    onToggleAutoNext={(val) => {
                      setAutoNext(val);
                      localStorage.setItem('gdirect_auto_next', String(val));
                      showToast(val ? '已开启连播' : '已关闭连播');
                    }}
                    onSelectFile={(f) => {
                      if (onSelectFile) onSelectFile(f);
                      setShowQueueMenu(false);
                    }}
                    onClose={() => setShowQueueMenu(false)}
                  />
                )}
              </div>

              {/* Dual Subtitles Popover */}
              <div className="relative">
                <button
                  onClick={() => setShowSubtitleMenu(!showSubtitleMenu)}
                  className={`p-1.5 sm:p-2 rounded-xl border transition-colors flex items-center space-x-1 ${
                    showSubtitleMenu || primaryName !== '无' || secondaryName !== '无'
                      ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                      : 'bg-white/10 border-transparent text-slate-300 hover:text-white'
                  }`}
                  title="字幕设置"
                >
                  <Subtitles className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </button>

                {showSubtitleMenu && (
                  <SubtitleMenu
                    file={file}
                    sameFolderSubtitles={sameFolderSubtitles}
                    embeddedTracks={embeddedTracks}
                    activeEmbeddedTrack={activeEmbeddedTrack}
                    primaryName={primaryName}
                    secondaryName={secondaryName}
                    primarySubId={primarySubId}
                    secondarySubId={secondarySubId}
                    subOffsetSecs={subOffsetSecs}
                    subStyle={subStyle}
                    customSourceUrl={customSourceUrl}
                    subtitleSources={subtitleSources}
                    cleanTitle={cleanTitle}
                    tokenParam={tokenParam}
                    onSelectEmbeddedTrack={handleSelectEmbeddedTrack}
                    onSelectSubtitleFile={(sub, target) => {
                      loadSubById(sub.id, sub.name, target).then((ok) => {
                        if (ok) {
                          if (target === 'primary') {
                            persistSubtitleMemory(sub.id, sub.name, secondarySubId, secondaryName, subOffsetSecs);
                            showToast(`主字幕: ${sub.name}`);
                          } else {
                            persistSubtitleMemory(primarySubId, primaryName, sub.id, sub.name, subOffsetSecs);
                            showToast(`副字幕: ${sub.name}`);
                          }
                        }
                      });
                    }}
                    onApplyParsedCues={(cues, name, id, target) => {
                      if (target === 'primary') {
                        setPrimaryCues(cues);
                        setPrimaryName(name);
                        setPrimarySubId(id);
                        persistSubtitleMemory(id, name, secondarySubId, secondaryName, subOffsetSecs);
                        showToast(`主字幕已加载 (${cues.length}条)`);
                      } else {
                        setSecondaryCues(cues);
                        setSecondaryName(name);
                        setSecondarySubId(id);
                        persistSubtitleMemory(primarySubId, primaryName, id, name, subOffsetSecs);
                        showToast(`副字幕已加载 (${cues.length}条)`);
                      }
                      if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
                    }}
                    onClearSubtitle={(target) => {
                      if (target === 'primary') {
                        setPrimaryCues([]);
                        setPrimaryName('无');
                        setPrimarySubId(null);
                        persistSubtitleMemory(null, '无', secondarySubId, secondaryName, subOffsetSecs);
                      } else {
                        setSecondaryCues([]);
                        setSecondaryName('无');
                        setSecondarySubId(null);
                        persistSubtitleMemory(primarySubId, primaryName, null, '无', subOffsetSecs);
                      }
                      showToast('已卸载字幕');
                    }}
                    onUpdateSubStyle={updateSubStyle}
                    onUpdateOffset={(delta, reset) => {
                      const next = reset ? 0 : parseFloat((subOffsetSecs + delta).toFixed(1));
                      setSubOffsetSecs(next);
                      persistSubtitleMemory(primarySubId, primaryName, secondarySubId, secondaryName, next);
                    }}
                    onSaveCustomSource={handleAddCustomSource}
                    onClose={() => setShowSubtitleMenu(false)}
                    showToast={showToast}
                  />
                )}
              </div>

              {/* Playback Speed Menu */}
              <div className="relative">
                <button
                  onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                  className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold text-slate-200 transition-colors"
                >
                  {playbackRate}x
                </button>

                {showSpeedMenu && (
                  <div className="absolute bottom-full right-0 mb-2 w-28 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl p-1 z-40 text-xs animate-fade-in">
                    {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((rate) => (
                      <button
                        key={rate}
                        onClick={() => setSpeed(rate)}
                        className={`w-full text-left px-3 py-1.5 rounded-lg flex items-center justify-between transition-colors ${
                          playbackRate === rate ? 'bg-cyan-500/20 text-cyan-300 font-bold' : 'hover:bg-slate-800 text-slate-300'
                        }`}
                      >
                        <span>{rate}x</span>
                        {playbackRate === rate && <Check className="w-3 h-3 text-cyan-400" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Immersive Mode Toggle */}
              <button
                onClick={() => {
                  setImmersiveMode(!immersiveMode);
                  showToast(immersiveMode ? '退出沉浸' : '沉浸观影');
                }}
                className={`p-1.5 sm:p-2 rounded-xl transition-colors ${
                  immersiveMode ? 'bg-cyan-500/20 text-cyan-300' : 'bg-white/10 text-slate-300 hover:text-white'
                }`}
                title="沉浸模式 (Z)"
              >
                {immersiveMode ? <EyeOff className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Eye className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
              </button>

              {/* Aspect Ratio Menu */}
              <div className="relative">
                <button
                  onClick={() => setShowAspectMenu((prev) => !prev)}
                  className={`p-1.5 sm:p-2 rounded-xl text-slate-300 hover:text-white transition-all flex items-center space-x-1 ${
                    aspectRatio !== 'contain'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'bg-white/10 hover:bg-white/20'
                  }`}
                  title="画面比例与裁剪 (快捷键 C)"
                >
                  <RectangleHorizontal className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  <span className="hidden md:inline text-[10px] font-mono font-semibold uppercase">
                    {aspectRatio === 'contain' ? '原画' : aspectRatio === 'cover' ? '铺满' : aspectRatio}
                  </span>
                </button>

                {showAspectMenu && (
                  <div className="absolute bottom-full right-0 mb-2 w-52 bg-slate-900/95 backdrop-blur-md border border-slate-800 rounded-2xl shadow-2xl p-2 space-y-1 z-50 text-xs animate-fade-in">
                    <div className="px-2 py-1 text-[10px] text-slate-400 font-semibold border-b border-slate-800 flex items-center justify-between">
                      <span>画面比例模式</span>
                      <span className="text-slate-500 font-mono">按 C 循环</span>
                    </div>
                    {[
                      { id: 'contain', label: '最佳原画 (完整零裁切)', desc: '默认模式，黑边自适应' },
                      { id: 'cover', label: '智能铺满 (去除黑边)', desc: '居中裁剪铺满屏幕' },
                      { id: 'fill', label: '拉伸全屏', desc: '填满视口忽略原比例' },
                      { id: '16:9', label: '16:9 标准宽屏', desc: '现代电视及宽屏显示' },
                      { id: '4:3', label: '4:3 经典方屏', desc: '经典老片与复古动画' },
                      { id: '21:9', label: '21:9 影院超宽银幕', desc: '院线电影银幕适配' },
                    ].map((item) => (
                      <button
                        key={item.id}
                        onClick={() => selectAspectRatio(item.id as AspectRatioMode)}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg flex flex-col transition-colors ${
                          aspectRatio === item.id ? 'bg-cyan-500/20 text-cyan-300' : 'text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        <span className="font-semibold text-xs flex items-center justify-between">
                          {item.label}
                          {aspectRatio === item.id && <Check className="w-3.5 h-3.5 text-cyan-400" />}
                        </span>
                        <span className="text-[10px] text-slate-500">{item.desc}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Picture-in-Picture (Available on both desktop & mobile) */}
              <button
                onClick={togglePiP}
                className="p-1.5 sm:p-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white transition-colors"
                title="画中画 (PiP)"
              >
                <PictureInPicture className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </button>

              {/* iOS / Mobile Native Player Handoff */}
              {(isMobile || isIOS) && (
                <button
                  onClick={enterNativeSystemPlayer}
                  className="p-1.5 sm:p-2 rounded-xl bg-white/10 hover:bg-white/20 text-cyan-300 hover:text-white transition-colors"
                  title="iOS 原生系统播放器 (支持 AirPlay 与系统画中画)"
                >
                  <Smartphone className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </button>
              )}

              {/* Fullscreen */}
              <button
                onClick={toggleFullscreen}
                className="p-1.5 sm:p-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white transition-colors"
                title="全屏模式 (F)"
              >
                {isFullscreen ? <Minimize className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Maximize className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
              </button>
            </div>
          </div>
        </div>

        {/* External Player Callout Modal */}
        {showExternalModal && (
          <ExternalPlayerModal
            streamUrl={streamUrl}
            official302Url={official302Url}
            onClose={() => setShowExternalModal(false)}
            showToast={showToast}
          />
        )}
      </div>
    </div>
  );
};
