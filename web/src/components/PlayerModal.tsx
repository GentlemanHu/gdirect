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
  Music,
  Palette,
  Pause,
  PictureInPicture,
  Play,
  RectangleHorizontal,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Settings,
  Share2,
  SkipBack,
  SkipForward,
  Sliders,
  Smartphone,
  Subtitles,
  Tv,
  Upload,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import { DriveFile, SystemStatus, StreamSession } from '../types';
import { copyToClipboard } from '../utils/clipboard';
import { searchDriveFiles, fetchVideoSubtitle, saveVideoSubtitle } from '../api';
import {
  SubtitleCue,
  SubtitleStyleConfig,
  parseSubtitle,
  loadSavedSubtitleStyle,
  saveSubtitleStyle,
  splitBilingualText,
} from '../utils/subtitles';

export type AspectRatioMode = 'contain' | 'cover' | 'fill' | '16:9' | '4:3' | '21:9';

interface EmbeddedTrack {
  index: number;
  label: string;
  language: string;
  kind: string;
}

interface PlayerModalProps {
  file: DriveFile;
  status: SystemStatus | null;
  folderFiles?: DriveFile[];
  onClose: () => void;
  onSelectFile?: (file: DriveFile) => void;
}

interface OnlineSubItem {
  id: string;
  name: string;
  lang: string;
  source: 'drive' | 'custom' | 'shooter';
  content?: string;
  url?: string;
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

  // Core Playback State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [bufferedPercent, setBufferedPercent] = useState(0);
  const [bufferedAheadSecs, setBufferedAheadSecs] = useState(0);
  const [isBuffering, setIsBuffering] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Error & External Player State
  const [videoError, setVideoError] = useState<string | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [showExternalModal, setShowExternalModal] = useState(false);
  const [useOfficial302, setUseOfficial302] = useState(false);

  // Floating Mini-Player State (页面悬浮小窗)
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

  // Video Metadata & Aspect Ratio
  const [videoWidth, setVideoWidth] = useState(0);
  const [videoHeight, setVideoHeight] = useState(0);
  const [aspectRatio, setAspectRatio] = useState<AspectRatioMode>(() => {
    return (localStorage.getItem('gdirect_aspect_ratio') as AspectRatioMode) || 'contain';
  });
  const [showAspectMenu, setShowAspectMenu] = useState(false);

  // Subtitle System (Dual Subtitles & Custom Styling)
  const [subTab, setSubTab] = useState<'folder' | 'online' | 'style' | 'sources' | 'paste' | 'embedded'>('folder');
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

  // Subtitle Appearance Customization
  const [subStyle, setSubStyle] = useState<SubtitleStyleConfig>(loadSavedSubtitleStyle);

  const updateSubStyle = (patch: Partial<SubtitleStyleConfig>) => {
    setSubStyle((prev) => {
      const next = { ...prev, ...patch };
      saveSubtitleStyle(next);
      return next;
    });
  };

  // Subtitle Sources Configuration
  const [customSourceUrl, setCustomSourceUrl] = useState(() => {
    return localStorage.getItem('gdirect_custom_sub_source') || '';
  });
  const [subtitleSources, setSubtitleSources] = useState<string[]>(() => {
    const saved = localStorage.getItem('gdirect_sub_sources_list');
    return saved ? JSON.parse(saved) : ['全盘 Google Drive 检索'];
  });

  // Online Subtitle Search State
  const cleanTitle = useMemo(() => {
    return file.name
      .replace(/\.(mp4|mkv|avi|mov|wmv|flv|webm|ts|m4v)$/i, '')
      .replace(/[\._\(\)\[\]\-]/g, ' ')
      .replace(/\b(1080p|2160p|4k|720p|bluray|bdrip|web-dl|x264|x265|hevc|aac|dts|remux|h264|h265)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }, [file.name]);

  const [searchKeyword, setSearchKeyword] = useState(cleanTitle);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<OnlineSubItem[]>([]);

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

  // Current Video Index in Queue
  const currentQueueIndex = useMemo(() => {
    return playQueue.findIndex((item) => item.id === file.id);
  }, [playQueue, file.id]);

  // Real-time speed from backend
  const [streamSpeedMbps, setStreamSpeedMbps] = useState<string>('0.0');
  const lastSpeedPollRef = useRef<number>(0);

  const key = localStorage.getItem('gdirect_api_key');
  const tokenParam = key ? `?token=${encodeURIComponent(key)}` : '';
  const baseStreamUrl = `${window.location.origin}/d/${file.id}/${encodeURIComponent(file.name)}${tokenParam}`;
  const streamUrl = useOfficial302 ? `${baseStreamUrl}${tokenParam ? '&' : '?'}mode=302` : baseStreamUrl;
  const official302Url = `${baseStreamUrl}${tokenParam ? '&' : '?'}mode=302`;

  // Formatted Resolution Label
  const resolutionBadge = useMemo(() => {
    if (videoWidth >= 3800 || videoHeight >= 2000) return '4K UHD';
    if (videoWidth >= 1900 || videoHeight >= 1000) return '1080p FHD';
    if (videoWidth >= 1200 || videoHeight >= 700) return '720p HD';
    if (videoHeight > 0) return `${videoHeight}p`;
    return 'HD';
  }, [videoWidth, videoHeight]);

  // Average Bitrate
  const avgBitrateMbps = useMemo(() => {
    const bytes = parseInt(file.size || '0', 10);
    if (bytes > 0 && duration > 0) {
      return ((bytes * 8) / duration / (1024 * 1024)).toFixed(1);
    }
    return null;
  }, [file.size, duration]);

  // Format time
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

  // Aspect Ratio & Cropping Controls
  const cycleAspectRatio = () => {
    const modes: AspectRatioMode[] = ['contain', 'cover', 'fill', '16:9', '4:3', '21:9'];
    const nextIdx = (modes.indexOf(aspectRatio) + 1) % modes.length;
    const nextMode = modes[nextIdx];
    setAspectRatio(nextMode);
    localStorage.setItem('gdirect_aspect_ratio', nextMode);
    const labels: Record<AspectRatioMode, string> = {
      contain: '最佳适配 (完整显示，零裁剪)',
      cover: '智能铺满 (去黑边，居中裁剪)',
      fill: '拉伸铺满 (撑满视口)',
      '16:9': '16:9 标准宽屏',
      '4:3': '4:3 经典方屏',
      '21:9': '21:9 影院超宽银幕',
    };
    showToast(`画面比例：${labels[nextMode]}`);
  };

  const selectAspectRatio = (mode: AspectRatioMode) => {
    setAspectRatio(mode);
    localStorage.setItem('gdirect_aspect_ratio', mode);
    setShowAspectMenu(false);
    const labels: Record<AspectRatioMode, string> = {
      contain: '最佳适配 (完整显示，零裁剪)',
      cover: '智能铺满 (去黑边，居中裁剪)',
      fill: '拉伸铺满 (撑满视口)',
      '16:9': '16:9 标准宽屏',
      '4:3': '4:3 经典方屏',
      '21:9': '21:9 影院超宽银幕',
    };
    showToast(`画面比例：${labels[mode]}`);
  };

  const videoFitClass = useMemo(() => {
    switch (aspectRatio) {
      case 'cover':
        return 'w-full h-full object-cover';
      case 'fill':
        return 'w-full h-full object-fill';
      case '16:9':
        return 'max-w-full max-h-full aspect-video object-contain';
      case '4:3':
        return 'max-w-full max-h-full aspect-[4/3] object-contain';
      case '21:9':
        return 'max-w-full max-h-full aspect-[21/9] object-contain';
      case 'contain':
      default:
        return 'w-full h-full object-contain';
    }
  }, [aspectRatio]);

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

  // Listen to addtrack event on video textTracks
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const handleAddTrack = () => {
      detectEmbeddedTracks();
    };
    video.textTracks.addEventListener('addtrack', handleAddTrack);
    return () => {
      video.textTracks.removeEventListener('addtrack', handleAddTrack);
    };
  }, []);

  // Sync active cues from embedded track to primary subtitle renderer
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

  // Auto-discover matching subtitles in current folder
  const sameFolderSubtitles = useMemo(() => {
    return folderFiles.filter((f) => {
      const lower = f.name.toLowerCase();
      return lower.endsWith('.srt') || lower.endsWith('.vtt') || lower.endsWith('.ass') || lower.endsWith('.ssa');
    });
  }, [folderFiles]);

  // Load Subtitle by ID helper
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

  // Subtitle Memory Loader: First check localStorage, then check server Jinli SQLite, else fallback to sameFolderSubtitles
  useEffect(() => {
    let restored = false;

    // 1. Try browser localStorage
    const localSaved = localStorage.getItem(`gdirect_sub_${file.id}`);
    if (localSaved) {
      try {
        const pref = JSON.parse(localSaved);
        if (pref.primary_sub_id && pref.primary_sub_name) {
          loadSubById(pref.primary_sub_id, pref.primary_sub_name, 'primary');
          if (pref.secondary_sub_id && pref.secondary_sub_name) {
            loadSubById(pref.secondary_sub_id, pref.secondary_sub_name, 'secondary');
          }
          if (typeof pref.sub_offset === 'number') {
            setSubOffsetSecs(pref.sub_offset);
          }
          showToast(`已恢复字幕记忆: ${pref.primary_sub_name}`);
          restored = true;
        }
      } catch {}
    }

    // 2. If not in localStorage, query Jinli SQLite
    if (!restored) {
      fetchVideoSubtitle(file.id).then((serverPref) => {
        if (serverPref && serverPref.primary_sub_id && serverPref.primary_sub_name) {
          loadSubById(serverPref.primary_sub_id, serverPref.primary_sub_name, 'primary');
          if (serverPref.secondary_sub_id && serverPref.secondary_sub_name) {
            loadSubById(serverPref.secondary_sub_id, serverPref.secondary_sub_name, 'secondary');
          }
          if (typeof serverPref.sub_offset === 'number') {
            setSubOffsetSecs(serverPref.sub_offset);
          }
          showToast(`已从网关同步字幕: ${serverPref.primary_sub_name}`);
          restored = true;
        } else if (sameFolderSubtitles.length > 0) {
          // 3. Fallback: match same folder subtitles
          const videoStem = file.name.substring(0, file.name.lastIndexOf('.')).toLowerCase();
          const matched = sameFolderSubtitles.filter((sub) => {
            const subName = sub.name.toLowerCase();
            return subName.includes(videoStem) || subName.startsWith(videoStem.substring(0, Math.min(8, videoStem.length)));
          });
          if (matched.length > 0) {
            const zhSub = matched.find((s) => s.name.toLowerCase().match(/(zh|chs|cht|chi|cn|sc|tc|中)/)) || matched[0];
            const enSub = matched.find((s) => s.id !== zhSub.id && s.name.toLowerCase().match(/(en|eng|english|英)/));
            loadSubById(zhSub.id, zhSub.name, 'primary');
            if (enSub) {
              loadSubById(enSub.id, enSub.name, 'secondary');
            }
          }
        }
      });
    }
  }, [file.id, file.name, sameFolderSubtitles, tokenParam]);

  // Load a subtitle from Drive file
  const loadDriveSubtitle = async (sub: DriveFile, target: 'primary' | 'secondary') => {
    try {
      const url = `${window.location.origin}/d/${sub.id}/${encodeURIComponent(sub.name)}${tokenParam}`;
      const res = await fetch(url);
      const text = await res.text();
      const parsed = parseSubtitle(text);
      if (parsed.length === 0) {
        showToast('⚠️ 未能解析出有效字幕');
      } else {
        showToast(`已装载: ${sub.name} (${parsed.length}条)`);
      }
      if (target === 'primary') {
        setPrimaryCues(parsed);
        setPrimaryName(sub.name);
        setPrimarySubId(sub.id);
        persistSubtitleMemory(sub.id, sub.name, secondarySubId, secondaryName, subOffsetSecs);
      } else {
        setSecondaryCues(parsed);
        setSecondaryName(sub.name);
        setSecondarySubId(sub.id);
        persistSubtitleMemory(primarySubId, primaryName, sub.id, sub.name, subOffsetSecs);
      }
      if (videoRef.current) {
        setCurrentTime(videoRef.current.currentTime);
      }
    } catch (e: any) {
      alert(`字幕读取失败: ${e.message}`);
    }
  };

  // Comprehensive Subtitle Search (Drive Full Search + Custom API)
  const handleOnlineSearch = async () => {
    if (!searchKeyword.trim()) return;
    setSearchLoading(true);
    setSearchResults([]);

    const aggregated: OnlineSubItem[] = [];

    // 1. Google Drive Recursive Search API
    try {
      const driveItems = await searchDriveFiles(searchKeyword.trim());
      const subItems = driveItems.filter((item) => {
        const lower = item.name.toLowerCase();
        return lower.endsWith('.srt') || lower.endsWith('.vtt') || lower.endsWith('.ass') || lower.endsWith('.ssa');
      });

      for (const item of subItems) {
        aggregated.push({
          id: item.id,
          name: item.name,
          lang: item.name.match(/(zh|cn|chs|cht|中)/i) ? '简体/繁体中文' : '英文字幕',
          source: 'drive',
          url: `${window.location.origin}/d/${item.id}/${encodeURIComponent(item.name)}${tokenParam}`,
        });
      }
    } catch (err) {
      console.warn('Drive subtitle search error:', err);
    }

    // 2. Custom Subtitle API Endpoint (if configured)
    if (customSourceUrl.trim()) {
      try {
        const targetUrl = `${customSourceUrl.replace('{query}', encodeURIComponent(searchKeyword))}`;
        const res = await fetch(targetUrl);
        if (res.ok) {
          const list = await res.json();
          if (Array.isArray(list)) {
            list.forEach((item: any, idx: number) => {
              aggregated.push({
                id: `custom_${idx}_${Date.now()}`,
                name: item.name || item.title || `自定义字幕源 #${idx + 1}`,
                lang: item.lang || '在线多语',
                source: 'custom',
                url: item.url || item.download_url,
                content: item.content,
              });
            });
          }
        }
      } catch (e) {
        console.warn('Custom subtitle source fetch failed:', e);
      }
    }

    setSearchResults(aggregated);
    setSearchLoading(false);
  };

  // Add Custom Subtitle Source
  const handleAddCustomSource = (url: string) => {
    if (!url.trim()) return;
    setCustomSourceUrl(url.trim());
    localStorage.setItem('gdirect_custom_sub_source', url.trim());
    const updated = Array.from(new Set([...subtitleSources, url.trim()]));
    setSubtitleSources(updated);
    localStorage.setItem('gdirect_sub_sources_list', JSON.stringify(updated));
    showToast('自定义字幕源已保存');
  };

  // Queue Operations: Next, Previous, Auto Play
  const playNextInQueue = () => {
    if (playQueue.length === 0) return;
    const nextIdx = (currentQueueIndex + 1) % playQueue.length;
    const nextFile = playQueue[nextIdx];
    if (nextFile && onSelectFile) {
      onSelectFile(nextFile);
      showToast(`切换至: ${nextFile.name}`);
    }
  };

  const playPrevInQueue = () => {
    if (playQueue.length === 0) return;
    const prevIdx = (currentQueueIndex - 1 + playQueue.length) % playQueue.length;
    const prevFile = playQueue[prevIdx];
    if (prevFile && onSelectFile) {
      onSelectFile(prevFile);
      showToast(`切换至: ${prevFile.name}`);
    }
  };

  // Playback & Buffer Tracking + Progress Memory
  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const curr = videoRef.current.currentTime;
    setCurrentTime(curr);

    // Save playback progress to localStorage every 2 seconds
    const nowSec = Math.floor(curr);
    if (Math.abs(nowSec - lastSavedTimeRef.current) >= 2) {
      lastSavedTimeRef.current = nowSec;
      if (nowSec > 3 && duration > 10) {
        localStorage.setItem(`gdirect_prog_${file.id}`, nowSec.toString());
      }
    }

    const buf = videoRef.current.buffered;
    if (buf.length > 0 && duration > 0) {
      for (let i = 0; i < buf.length; i++) {
        if (buf.start(i) <= curr && curr <= buf.end(i)) {
          setBufferedPercent((buf.end(i) / duration) * 100);
          setBufferedAheadSecs(Math.max(0, Math.round(buf.end(i) - curr)));
          break;
        }
      }
    }

    // Poll live stream speed
    const now = Date.now();
    if (now - lastSpeedPollRef.current >= 2000) {
      lastSpeedPollRef.current = now;
      fetch('/api/sessions')
        .then((r) => r.json())
        .then((sessList: StreamSession[]) => {
          const match = sessList.find((s) => s.file_id === file.id);
          if (match && match.speed_kbps > 0) {
            setStreamSpeedMbps(((match.speed_kbps * 8) / 1024).toFixed(1));
          } else {
            setStreamSpeedMbps('0.0');
          }
        })
        .catch(() => {});
    }
  };

  // Video Ended -> Intelligent Queue Next
  const handleVideoEnded = () => {
    if (autoNext && onSelectFile && playQueue.length > 1) {
      showToast('本集播放完毕，自动播放下一集');
      setTimeout(playNextInQueue, 1000);
    }
  };

  // Dual Subtitles Matching & Auto Bilingual Splitting
  const adjustedTime = currentTime + subOffsetSecs;

  const activeCues = useMemo(() => {
    const rawPrim = primaryCues.length > 0
      ? primaryCues.find((c) => c.start <= adjustedTime && adjustedTime <= c.end)?.text || null
      : embeddedSubtitleText;
    const rawSec = secondaryCues.length > 0
      ? secondaryCues.find((c) => c.start <= adjustedTime && adjustedTime <= c.end)?.text || null
      : null;

    // If single subtitle loaded and bilingual splitting is enabled
    if (rawPrim && !rawSec && subStyle.bilingualSplit) {
      const split = splitBilingualText(rawPrim);
      if (split.secondary) {
        return {
          primary: split.primary,
          secondary: split.secondary,
        };
      }
    }

    return { primary: rawPrim, secondary: rawSec };
  }, [primaryCues, secondaryCues, adjustedTime, subStyle.bilingualSplit, embeddedSubtitleText]);

  // Subtitle Item Style Calculator
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

  // Controls logic
  const safePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.paused) return;
    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          setIsPlaying(true);
          setIsBuffering(false);
        })
        .catch((err) => {
          // If browser blocked unmuted autoplay on fresh page reload
          if (err.name === 'NotAllowedError') {
            video.muted = true;
            setIsMuted(true);
            video
              .play()
              .then(() => {
                setIsPlaying(true);
                setIsBuffering(false);
                showToast('已静音起播 (点击音量可开启声音)');
              })
              .catch(() => {});
          }
        });
    }
  }, []);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      safePlay();
      showToast('播放');
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
      showToast('暂停');
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
    showToast(`${rate}x`);
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

  const togglePiP = async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoRef.current.requestPictureInPicture();
      }
    } catch {}
  };

  // Keyboard controls
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
            showToast('-5s');
          }
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (videoRef.current) {
            videoRef.current.currentTime = Math.min(duration, videoRef.current.currentTime + 5);
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
  }, [duration, isPlaying, isMuted, immersiveMode, playQueue, currentQueueIndex]);

  // Motion auto-hide: Hide all controls after 2.5s idle
  const handleMouseMove = () => {
    setControlsVisible(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying && !immersiveMode) setControlsVisible(false);
    }, 2500);
  };

  const handleScreenClick = (e: React.MouseEvent) => {
    // If immersive mode is active, clicking canvas wakes the exit prompt and controls temporarily
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
        className={`relative w-full h-full flex flex-col justify-between bg-black overflow-hidden select-none ${
          !controlsVisible && isPlaying && !isFloating && !immersiveMode ? 'cursor-none' : 'cursor-default'
        } ${isFloating ? 'aspect-video' : ''}`}
      >
        {/* Floating Immersive Exit Button (ALWAYS ACCESSIBLE IN IMMERSIVE MODE) */}
        {immersiveMode && (
          <div className="absolute top-4 inset-x-0 flex justify-center z-50 pointer-events-auto animate-fade-in">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setImmersiveMode(false);
                setControlsVisible(true);
                showToast('已退出沉浸观影');
              }}
              className="px-4 py-2 rounded-full bg-slate-900/95 hover:bg-slate-800 text-cyan-300 border border-cyan-500/50 shadow-2xl backdrop-blur-md text-xs font-semibold flex items-center space-x-2 transition-all active:scale-95"
            >
              <EyeOff className="w-4 h-4" />
              <span>退出沉浸观影 (点此或按Z)</span>
            </button>
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
                showToast(nextMode ? '已切换: 官方 302 直链 (需翻墙)' : '已切换: 国内边缘直连 (免翻墙)');
              }}
              className={`hidden sm:flex px-2 py-0.5 rounded-lg text-[10px] sm:text-xs font-mono font-semibold border transition-colors items-center space-x-1 ${
                useOfficial302
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                  : 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'
              }`}
              title="点击切换传输模式"
            >
              <span>{useOfficial302 ? '官方 302' : '边缘直连'}</span>
            </button>

            {/* Rate & Buffer Pill */}
            <div className="hidden md:flex px-2.5 py-1 rounded-lg bg-slate-900/80 border border-slate-800 text-xs font-mono text-slate-300 items-center space-x-1.5">
              <Zap className="w-3.5 h-3.5 text-cyan-400" />
              <span>{streamSpeedMbps} Mbps</span>
              {bufferedAheadSecs > 0 && (
                <span className="text-emerald-400 font-medium">+{bufferedAheadSecs}s</span>
              )}
            </div>

            {/* External Player Menu Button */}
            <button
              onClick={() => setShowExternalModal(true)}
              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 hover:text-white transition-colors flex items-center space-x-1"
              title="调用外部播放器 (VLC/Infuse/IINA/MX)"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">外部播放</span>
            </button>

            {/* Floating Mini-Player Switch (悬浮小窗) */}
            <button
              onClick={() => {
                setIsFloating(!isFloating);
                showToast(isFloating ? '全屏展开' : '页面悬浮播放');
              }}
              className={`p-1.5 rounded-lg text-xs font-mono border transition-colors flex items-center space-x-1 ${
                isFloating
                  ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                  : 'bg-slate-900/80 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
              title={isFloating ? '还原全尺寸' : '页面悬浮小窗'}
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
              title="详细信息 (I)"
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

        {/* Media Details Card (Info Drawer) */}
        {showInfo && !isFloating && (
          <div className="absolute top-16 right-3 sm:right-6 z-40 p-4 rounded-2xl bg-slate-950/90 backdrop-blur-xl border border-slate-800 text-xs font-mono space-y-2 shadow-2xl min-w-[240px] animate-fade-in">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="font-bold text-white font-sans">媒体流与硬件诊断</span>
              <button onClick={() => setShowInfo(false)} className="text-slate-500 hover:text-slate-300">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1.5 text-slate-300">
              <div className="flex justify-between">
                <span className="text-slate-500">传输路线:</span>
                <span className={useOfficial302 ? "text-amber-300 font-bold" : "text-cyan-300 font-bold"}>
                  {useOfficial302 ? "官方 302 重定向" : "国内边缘直连"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">分辨率:</span>
                <span className="text-cyan-300 font-bold">{videoWidth} x {videoHeight} ({resolutionBadge})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">平均码率:</span>
                <span className="text-slate-200">{avgBitrateMbps ? `${avgBitrateMbps} Mbps` : '自适应'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">实时带宽:</span>
                <span className="text-emerald-400 font-bold">{streamSpeedMbps} Mbps</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">超前缓存:</span>
                <span className="text-emerald-400">{bufferedAheadSecs} 秒</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Google 节点:</span>
                <span className="text-slate-200 truncate max-w-[120px]">{status?.direct_ip || '直连'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">RAM 缓冲:</span>
                <span className="text-purple-300">{status?.prefetch_mb || 16} MB (零落盘)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">播放时长:</span>
                <span className="text-slate-200">{formatTime(currentTime)} / {formatTime(duration)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Action Center Toast */}
        {actionToast && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-40 animate-fade-in">
            <div className="px-5 py-2.5 rounded-2xl bg-black/85 backdrop-blur-md border border-slate-700 text-white font-bold text-base shadow-2xl">
              {actionToast}
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

        {/* Video Canvas & Subtitles Area */}
        <div
          onClick={handleScreenClick}
          onDoubleClick={toggleFullscreen}
          className="relative flex-1 flex items-center justify-center cursor-pointer"
        >
          <video
            ref={videoRef}
            src={streamUrl}
            autoPlay
            preload="auto"
            playsInline
            onTimeUpdate={handleTimeUpdate}
            onSeeked={handleTimeUpdate}
            onSeeking={handleTimeUpdate}
            onLoadedData={() => {
              handleTimeUpdate();
              setIsBuffering(false);
            }}
            onWaiting={() => {
              setIsBuffering(true);
            }}
            onPlaying={() => {
              setIsPlaying(true);
              setIsBuffering(false);
            }}
            onCanPlay={() => {
              handleTimeUpdate();
              setIsBuffering(false);
              if (videoRef.current && videoRef.current.paused && !videoRef.current.ended) {
                safePlay();
              }
            }}
            onEnded={handleVideoEnded}
            onError={() => {
              const err = videoRef.current?.error;
              // Handle transient network drops (code 2 = MEDIA_ERR_NETWORK) - e.g. server hot reload
              if (err?.code === 2) {
                const cur = videoRef.current?.currentTime || 0;
                setIsReconnecting(true);
                showToast('网络连接中断，正在自动重连...');
                if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = setTimeout(() => {
                  if (videoRef.current) {
                    videoRef.current.load();
                    videoRef.current.currentTime = cur;
                    safePlay();
                    setIsReconnecting(false);
                  }
                }, 2000);
                return;
              }

              // Code 4: MEDIA_ERR_SRC_NOT_SUPPORTED
              const msg = err?.code === 4
                ? '浏览器不支持此视频的封装格式或音视频编码'
                : '播放器连接异常，可尝试刷新或调用外部播放器';
              setVideoError(msg);
            }}
            onLoadedMetadata={() => {
              setVideoError(null);
              setIsReconnecting(false);
              detectEmbeddedTracks();
              if (videoRef.current) {
                const dur = videoRef.current.duration;
                setDuration(dur);
                setVideoWidth(videoRef.current.videoWidth);
                setVideoHeight(videoRef.current.videoHeight);

                // Check stored playback progress
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

                // Auto-play immediately after metadata is ready
                safePlay();
              }
            }}
            onPlay={() => {
              setIsPlaying(true);
              setIsBuffering(false);
            }}
            onPause={() => setIsPlaying(false)}
            className={`${videoFitClass} transition-all duration-200`}
          />

          {/* Buffering Indicator */}
          {isBuffering && !videoError && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-20 animate-fade-in">
              <div className="p-3 rounded-2xl bg-black/70 backdrop-blur-sm border border-slate-800 text-cyan-400 flex items-center space-x-2">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span className="text-xs font-medium text-slate-200">缓冲中...</span>
              </div>
            </div>
          )}

          {/* Reconnecting Toast */}
          {isReconnecting && (
            <div className="absolute top-14 left-1/2 -translate-x-1/2 z-40 px-3 py-1.5 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-xs font-medium flex items-center space-x-1.5 shadow-xl animate-fade-in">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>网络恢复重连中...</span>
            </div>
          )}

          {/* Video Error / Unsupported Format Card */}
          {videoError && (
            <div className="absolute inset-0 bg-black/90 backdrop-blur-md z-30 flex items-center justify-center p-4 animate-fade-in">
              <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-2xl text-center">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto text-amber-400">
                  <Film className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">无法直接解码此媒体</h3>
                  <p className="text-xs text-slate-400 mt-1">
                    {videoError}
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1 text-xs font-medium">
                  <a
                    href={`vlc://${streamUrl}`}
                    className="p-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-orange-300 text-center block transition-colors"
                  >
                    VLC
                  </a>
                  <a
                    href={`infuse://x-callback-url/open?url=${encodeURIComponent(streamUrl)}`}
                    className="p-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-amber-300 text-center block transition-colors"
                  >
                    Infuse
                  </a>
                  <a
                    href={`intent:${streamUrl}#Intent;type=video/*;package=com.mxtech.videoplayer.ad;end`}
                    className="p-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-emerald-300 text-center block transition-colors"
                  >
                    MX Player
                  </a>
                  <a
                    href={`iina://weblink?url=${encodeURIComponent(streamUrl)}`}
                    className="p-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-blue-300 text-center block transition-colors"
                  >
                    IINA
                  </a>
                  <a
                    href={`nplayer-${streamUrl}`}
                    className="p-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-cyan-300 text-center block transition-colors"
                  >
                    nPlayer
                  </a>
                  <a
                    href={`vidhub://play?url=${encodeURIComponent(streamUrl)}`}
                    className="p-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-purple-300 text-center block transition-colors"
                  >
                    VidHub
                  </a>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => {
                      setUseOfficial302(!useOfficial302);
                      setVideoError(null);
                      showToast(useOfficial302 ? '切回直连' : '已切换官方302');
                    }}
                    className="flex-1 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
                  >
                    {useOfficial302 ? '切回直连' : '官方 302 重试'}
                  </button>
                  <button
                    onClick={() => handleCopyUrl(streamUrl)}
                    className="flex-1 py-2 px-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-semibold"
                  >
                    {copyFeedback ? '已复制' : '复制直链'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Subtitles Overlay (Supports Dual Subtitles & Dynamic Styles) */}
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
          className={`absolute bottom-0 inset-x-0 z-30 p-2.5 sm:p-5 bg-gradient-to-t from-black/90 via-black/60 to-transparent transition-opacity duration-300 space-y-2 ${
            controlsVisible && !immersiveMode ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Progress / Seek Bar */}
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

          {/* Controls Bar */}
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
                {isPlaying ? <Pause className="w-4 h-4 sm:w-5 sm:h-5 fill-current" /> : <Play className="w-4 h-4 sm:w-5 sm:h-5 fill-current ml-0.5" />}
              </button>

              {/* Next in Queue */}
              <button
                onClick={playNextInQueue}
                className="p-1 sm:p-1.5 rounded-lg text-slate-400 hover:text-white transition-colors"
                title="下一集 (N)"
              >
                <SkipForward className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </button>

              {/* Volume Slider (Hidden on small mobile) */}
              <div className="hidden sm:flex items-center space-x-2 group">
                <button
                  onClick={toggleMute}
                  className="p-1.5 rounded-lg text-slate-300 hover:text-white transition-colors"
                >
                  {isMuted || volume === 0 ? <VolumeX className="w-4 h-4 sm:w-5 sm:h-5" /> : <Volume2 className="w-4 h-4 sm:w-5 sm:h-5" />}
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

            {/* Right Action Icons: Queue, Subtitles, Speed, Immersive, PiP, Fullscreen */}
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
                  title="播放队列与连播设置"
                >
                  <ListOrdered className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </button>

                {showQueueMenu && (
                  <div className="fixed sm:absolute bottom-16 sm:bottom-full left-3 right-3 sm:left-auto sm:right-0 mb-3 w-auto sm:w-[380px] rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-4 z-50 text-xs space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-white">播放队列 ({playQueue.length})</span>
                        <label className="flex items-center space-x-1.5 cursor-pointer text-slate-400 text-[11px]">
                          <input
                            type="checkbox"
                            checked={autoNext}
                            onChange={(e) => {
                              setAutoNext(e.target.checked);
                              localStorage.setItem('gdirect_auto_next', String(e.target.checked));
                              showToast(e.target.checked ? '已开启自动连播' : '已关闭自动连播');
                            }}
                            className="accent-cyan-400 rounded"
                          />
                          <span>自动连播</span>
                        </label>
                      </div>
                      <button onClick={() => setShowQueueMenu(false)} className="text-slate-500 hover:text-slate-300">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="space-y-1 max-h-56 overflow-y-auto">
                      {playQueue.map((item, idx) => {
                        const isCurrent = item.id === file.id;
                        return (
                          <div
                            key={item.id + idx}
                            onClick={() => {
                              if (onSelectFile) onSelectFile(item);
                            }}
                            className={`p-2 rounded-xl flex items-center justify-between cursor-pointer transition-colors ${
                              isCurrent
                                ? 'bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 font-semibold'
                                : 'hover:bg-slate-800 text-slate-300'
                            }`}
                          >
                            <div className="flex items-center space-x-2 truncate">
                              <span className="font-mono text-[10px] text-slate-500 w-4">{idx + 1}</span>
                              <span className="truncate">{item.name}</span>
                            </div>
                            {isCurrent && <Activity className="w-3.5 h-3.5 text-cyan-400 shrink-0 ml-1" />}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Subtitles Popover */}
              <div className="relative">
                <button
                  onClick={() => setShowSubtitleMenu(!showSubtitleMenu)}
                  className={`p-1.5 sm:p-2 rounded-xl border transition-colors flex items-center space-x-1 ${
                    primaryCues.length > 0 || secondaryCues.length > 0
                      ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                      : 'bg-white/10 border-transparent text-slate-300 hover:text-white'
                  }`}
                  title="字幕配置、样式与搜索"
                >
                  <Subtitles className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </button>

                {showSubtitleMenu && (
                  <div className="fixed sm:absolute bottom-16 sm:bottom-full left-3 right-3 sm:left-auto sm:right-0 mb-3 w-auto sm:w-[460px] rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-4 z-50 text-xs space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-white">双字幕控制与检索中心</span>
                      </div>
                      <button onClick={() => setShowSubtitleMenu(false)} className="text-slate-500 hover:text-slate-300">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Active Subtitle Status Badges */}
                    <div className="grid grid-cols-2 gap-2 p-2 rounded-xl bg-slate-950 border border-slate-800 text-[11px]">
                      <div className="flex items-center justify-between overflow-hidden">
                        <span className="text-cyan-400 font-semibold shrink-0 mr-1.5">主:</span>
                        <span className="truncate text-slate-200" title={primaryName}>{primaryName}</span>
                        {primaryCues.length > 0 && (
                          <button
                            onClick={() => {
                              setPrimaryCues([]);
                              setPrimaryName('无');
                              setPrimarySubId(null);
                              persistSubtitleMemory(null, '无', secondarySubId, secondaryName, subOffsetSecs);
                            }}
                            className="text-slate-500 hover:text-rose-400 ml-1 shrink-0"
                            title="卸载主字幕"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                      <div className="flex items-center justify-between overflow-hidden">
                        <span className="text-amber-400 font-semibold shrink-0 mr-1.5">副:</span>
                        <span className="truncate text-slate-200" title={secondaryName}>{secondaryName}</span>
                        {secondaryCues.length > 0 && (
                          <button
                            onClick={() => {
                              setSecondaryCues([]);
                              setSecondaryName('无');
                              setSecondarySubId(null);
                              persistSubtitleMemory(primarySubId, primaryName, null, '无', subOffsetSecs);
                            }}
                            className="text-slate-500 hover:text-rose-400 ml-1 shrink-0"
                            title="卸载副字幕"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Subtitle Tabs */}
                    <div className="flex space-x-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-[11px]">
                      <button
                        onClick={() => setSubTab('folder')}
                        className={`flex-1 py-1 rounded-lg ${
                          subTab === 'folder' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400'
                        }`}
                      >
                        同目录 ({sameFolderSubtitles.length})
                      </button>
                      <button
                        onClick={() => setSubTab('embedded')}
                        className={`flex-1 py-1 rounded-lg flex items-center justify-center space-x-1 ${
                          subTab === 'embedded' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400'
                        }`}
                      >
                        <Film className="w-3 h-3" />
                        <span>内嵌轨{embeddedTracks.length > 0 ? ` (${embeddedTracks.length})` : ''}</span>
                      </button>
                      <button
                        onClick={() => setSubTab('online')}
                        className={`flex-1 py-1 rounded-lg ${
                          subTab === 'online' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400'
                        }`}
                      >
                        全盘搜索
                      </button>
                      <button
                        onClick={() => setSubTab('style')}
                        className={`flex-1 py-1 rounded-lg flex items-center justify-center space-x-1 ${
                          subTab === 'style' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400'
                        }`}
                      >
                        <Palette className="w-3 h-3" />
                        <span>外观设置</span>
                      </button>
                      <button
                        onClick={() => setSubTab('sources')}
                        className={`flex-1 py-1 rounded-lg ${
                          subTab === 'sources' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400'
                        }`}
                      >
                        源配置
                      </button>
                      <button
                        onClick={() => setSubTab('paste')}
                        className={`flex-1 py-1 rounded-lg ${
                          subTab === 'paste' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400'
                        }`}
                      >
                        上传
                      </button>
                    </div>

                    {/* Tab: Embedded Tracks */}
                    {subTab === 'embedded' && (
                      <div className="space-y-3 max-h-56 overflow-y-auto">
                        {embeddedTracks.length > 0 ? (
                          <div className="space-y-2">
                            <div className="text-[11px] text-slate-400">
                              检测到视频封装内嵌 {embeddedTracks.length} 个字幕轨道 (Web 原生解析)：
                            </div>
                            {embeddedTracks.map((trk) => (
                              <div
                                key={trk.index}
                                className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 ${
                                  activeEmbeddedTrack === trk.index
                                    ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-300'
                                    : 'bg-slate-950 border-slate-800 text-slate-200'
                                }`}
                              >
                                <div className="flex flex-col">
                                  <span className="font-semibold text-xs flex items-center space-x-1.5">
                                    <span>{trk.label}</span>
                                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
                                      {trk.language}
                                    </span>
                                    {activeEmbeddedTrack === trk.index && (
                                      <span className="text-[10px] text-cyan-400 font-mono">激活中</span>
                                    )}
                                  </span>
                                  <span className="text-[10px] text-slate-500">类型: {trk.kind}</span>
                                </div>
                                <div className="flex space-x-1 shrink-0">
                                  <button
                                    onClick={() => handleSelectEmbeddedTrack(trk.index, 'primary')}
                                    className="px-2.5 py-1 rounded-lg bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500 hover:text-slate-950 text-xs font-semibold"
                                  >
                                    设为主
                                  </button>
                                  <button
                                    onClick={() => handleSelectEmbeddedTrack(trk.index, 'secondary')}
                                    className="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500 hover:text-slate-950 text-xs font-semibold"
                                  >
                                    设为副
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3 text-center">
                            <div className="text-slate-400 text-xs">
                              未检测到内嵌文本字幕轨
                            </div>
                            <button
                              onClick={() => {
                                setShowSubtitleMenu(false);
                                setShowExternalModal(true);
                              }}
                              className="w-full py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 font-semibold text-xs flex items-center justify-center space-x-1.5"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span>外部播放器播放 (支持图形/内嵌字幕硬解)</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Tab 1: Same Folder Discovery */}
                    {subTab === 'folder' && (
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {sameFolderSubtitles.length === 0 ? (
                          <div className="text-slate-500 py-3 text-center">同目录下未探测到字幕文件</div>
                        ) : (
                          sameFolderSubtitles.map((sub) => (
                            <div key={sub.id} className="p-2 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
                              <span className="break-words text-xs text-slate-200 line-clamp-2 leading-relaxed" title={sub.name}>
                                {sub.name}
                              </span>
                              <div className="flex space-x-1 shrink-0">
                                <button
                                  onClick={() => loadDriveSubtitle(sub, 'primary')}
                                  className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500 hover:text-slate-950 font-semibold"
                                >
                                  设为主
                                </button>
                                <button
                                  onClick={() => loadDriveSubtitle(sub, 'secondary')}
                                  className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500 hover:text-slate-950 font-semibold"
                                >
                                  设为副
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}

                    {/* Tab 2: Full Drive & Multi-Source Search */}
                    {subTab === 'online' && (
                      <div className="space-y-2">
                        <div className="flex space-x-1.5">
                          <input
                            type="text"
                            value={searchKeyword}
                            onChange={(e) => setSearchKeyword(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleOnlineSearch()}
                            placeholder="输入电影名称或字幕关键词"
                            className="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
                          />
                          <button
                            onClick={handleOnlineSearch}
                            disabled={searchLoading}
                            className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold"
                          >
                            {searchLoading ? '检索中...' : '搜索'}
                          </button>
                        </div>

                        <div className="space-y-1.5 max-h-48 overflow-y-auto">
                          {searchResults.length === 0 && !searchLoading ? (
                            <div className="text-slate-500 text-center py-4">
                              输入片名回车，自动递归穿透检索 5TB 全盘及已配置外部源
                            </div>
                          ) : (
                            searchResults.map((item) => (
                              <div key={item.id} className="p-2 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
                                <div className="overflow-hidden flex-1">
                                  <p className="break-words text-xs text-slate-200 line-clamp-2 leading-relaxed">{item.name}</p>
                                  <div className="flex items-center space-x-2 mt-0.5">
                                    <span className="text-[10px] text-cyan-400">{item.lang}</span>
                                    <span className="text-[10px] text-slate-500 font-mono">[{item.source}]</span>
                                  </div>
                                </div>
                                <div className="flex space-x-1 shrink-0">
                                  <button
                                    onClick={() => {
                                      const apply = (cues: SubtitleCue[]) => {
                                        setPrimaryCues(cues);
                                        setPrimaryName(item.name);
                                        setPrimarySubId(item.id);
                                        persistSubtitleMemory(item.id, item.name, secondarySubId, secondaryName, subOffsetSecs);
                                        showToast(`已设为主字幕 (${cues.length}条)`);
                                      };
                                      if (item.content) {
                                        apply(parseSubtitle(item.content));
                                      } else if (item.url) {
                                        fetch(item.url)
                                          .then((r) => r.text())
                                          .then((t) => apply(parseSubtitle(t)));
                                      }
                                    }}
                                    className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-semibold hover:bg-cyan-500 hover:text-slate-950"
                                  >
                                    主
                                  </button>
                                  <button
                                    onClick={() => {
                                      const apply = (cues: SubtitleCue[]) => {
                                        setSecondaryCues(cues);
                                        setSecondaryName(item.name);
                                        setSecondarySubId(item.id);
                                        persistSubtitleMemory(primarySubId, primaryName, item.id, item.name, subOffsetSecs);
                                        showToast(`已设为副字幕 (${cues.length}条)`);
                                      };
                                      if (item.content) {
                                        apply(parseSubtitle(item.content));
                                      } else if (item.url) {
                                        fetch(item.url)
                                          .then((r) => r.text())
                                          .then((t) => apply(parseSubtitle(t)));
                                      }
                                    }}
                                    className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-semibold hover:bg-amber-500 hover:text-slate-950"
                                  >
                                    副
                                  </button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}

                    {/* Tab 3: Subtitle Appearance Customization (NEW) */}
                    {subTab === 'style' && (
                      <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
                        {/* Font Size */}
                        <div className="space-y-1">
                          <div className="flex justify-between items-center text-slate-300">
                            <span>字体大小</span>
                            <span className="font-mono text-cyan-400 font-bold">{subStyle.fontSize}px</span>
                          </div>
                          <div className="flex items-center space-x-1.5">
                            {[16, 20, 24, 28, 34].map((sz) => (
                              <button
                                key={sz}
                                onClick={() => updateSubStyle({ fontSize: sz })}
                                className={`flex-1 py-1 rounded-lg border text-center font-mono ${
                                  subStyle.fontSize === sz
                                    ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300 font-bold'
                                    : 'bg-slate-950 border-slate-800 text-slate-400'
                                }`}
                              >
                                {sz}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Colors */}
                        <div className="grid grid-cols-2 gap-2.5">
                          <div className="space-y-1">
                            <span className="text-slate-300 block">主字幕颜色</span>
                            <div className="flex space-x-1.5">
                              {['#FFFFFF', '#FACC15', '#22D3EE', '#4ADE80'].map((c) => (
                                <button
                                  key={c}
                                  onClick={() => updateSubStyle({ primaryColor: c })}
                                  style={{ backgroundColor: c }}
                                  className={`w-6 h-6 rounded-full border-2 transition-transform ${
                                    subStyle.primaryColor === c ? 'scale-110 border-white shadow-lg' : 'border-slate-800'
                                  }`}
                                />
                              ))}
                            </div>
                          </div>
                          <div className="space-y-1">
                            <span className="text-slate-300 block">副字幕颜色</span>
                            <div className="flex space-x-1.5">
                              {['#FDE047', '#38BDF8', '#C084FC', '#CBD5E1'].map((c) => (
                                <button
                                  key={c}
                                  onClick={() => updateSubStyle({ secondaryColor: c })}
                                  style={{ backgroundColor: c }}
                                  className={`w-6 h-6 rounded-full border-2 transition-transform ${
                                    subStyle.secondaryColor === c ? 'scale-110 border-white shadow-lg' : 'border-slate-800'
                                  }`}
                                />
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Background & Outline Style */}
                        <div className="space-y-1">
                          <span className="text-slate-300 block">描边与背景风格</span>
                          <div className="grid grid-cols-4 gap-1.5">
                            {[
                              { id: 'box', label: '黑底胶囊' },
                              { id: 'stroke', label: '浓郁描边' },
                              { id: 'shadow', label: '柔和阴影' },
                              { id: 'none', label: '无底色' },
                            ].map((item) => (
                              <button
                                key={item.id}
                                onClick={() => updateSubStyle({ bgStyle: item.id as any })}
                                className={`py-1 rounded-lg border text-center text-[10px] ${
                                  subStyle.bgStyle === item.id
                                    ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300 font-bold'
                                    : 'bg-slate-950 border-slate-800 text-slate-400'
                                }`}
                              >
                                {item.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Bottom Distance */}
                        <div className="space-y-1">
                          <div className="flex justify-between items-center text-slate-300">
                            <span>底部垂直间距</span>
                            <span className="font-mono text-cyan-400">{subStyle.bottomOffset}px</span>
                          </div>
                          <div className="flex items-center space-x-1.5">
                            {[40, 60, 80, 110, 140].map((ofst) => (
                              <button
                                key={ofst}
                                onClick={() => updateSubStyle({ bottomOffset: ofst })}
                                className={`flex-1 py-1 rounded-lg border text-center text-[10px] font-mono ${
                                  subStyle.bottomOffset === ofst
                                    ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300 font-bold'
                                    : 'bg-slate-950 border-slate-800 text-slate-400'
                                }`}
                              >
                                {ofst}px
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Bilingual Split Switch */}
                        <div className="pt-1 flex items-center justify-between text-slate-300">
                          <span className="text-[11px]">单字幕双语拆分分色 (中英自动排版)</span>
                          <input
                            type="checkbox"
                            checked={subStyle.bilingualSplit}
                            onChange={(e) => updateSubStyle({ bilingualSplit: e.target.checked })}
                            className="accent-cyan-400 rounded cursor-pointer"
                          />
                        </div>

                        {/* Live Preview Box */}
                        <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-center space-y-1">
                          <span className="text-[10px] text-slate-500 block">实时样式预览效果</span>
                          <div className="flex flex-col items-center space-y-1 py-1">
                            <span style={getSubtitleItemStyle('secondary')}>
                              Sample English Subtitle Preview
                            </span>
                            <span style={getSubtitleItemStyle('primary')}>
                              字幕样式与大小实时渲染预览效果
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Tab 4: Custom Subtitle Sources */}
                    {subTab === 'sources' && (
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <label className="text-[11px] text-slate-300 font-medium">配置自定义字幕 Webhook / API 地址</label>
                          <div className="flex space-x-1.5">
                            <input
                              type="text"
                              value={customSourceUrl}
                              onChange={(e) => setCustomSourceUrl(e.target.value)}
                              placeholder="https://api.example.com/subtitles?q={query}"
                              className="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white font-mono"
                            />
                            <button
                              onClick={() => handleAddCustomSource(customSourceUrl)}
                              className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold"
                            >
                              保存
                            </button>
                          </div>
                        </div>

                        <div className="space-y-1 text-slate-400 text-[11px]">
                          <span className="font-semibold text-slate-200">当前激活的字幕搜索源:</span>
                          <div className="space-y-1 mt-1">
                            <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 flex items-center justify-between">
                              <span>Google Drive 全盘深度递归索引</span>
                              <span className="text-emerald-400 font-mono">内置</span>
                            </div>
                            {customSourceUrl && (
                              <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 flex items-center justify-between">
                                <span className="truncate max-w-[260px] font-mono text-[10px]">{customSourceUrl}</span>
                                <span className="text-cyan-400 font-mono">自定义</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Tab 5: Local Upload */}
                    {subTab === 'paste' && (
                      <div className="space-y-2">
                        <label className="w-full flex items-center justify-center space-x-1.5 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer font-medium">
                          <Upload className="w-4 h-4" />
                          <span>选择本地 .srt / .vtt / .ass / .ssa 文件</span>
                          <input
                            type="file"
                            accept=".srt,.vtt,.ass,.ssa"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) {
                                const reader = new FileReader();
                                reader.onload = (ev) => {
                                  const text = ev.target?.result as string;
                                  const parsed = parseSubtitle(text);
                                  setPrimaryCues(parsed);
                                  setPrimaryName(f.name);
                                  showToast(`已加载主字幕: ${f.name} (${parsed.length}条)`);
                                };
                                reader.readAsText(f);
                              }
                            }}
                            className="hidden"
                          />
                        </label>
                      </div>
                    )}

                    {/* Sync Offset */}
                    <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-slate-400 text-[11px]">
                      <span>时间轴同步微调:</span>
                      <div className="flex items-center space-x-1">
                        <button
                          onClick={() => {
                            const next = parseFloat((subOffsetSecs - 0.5).toFixed(1));
                            setSubOffsetSecs(next);
                            persistSubtitleMemory(primarySubId, primaryName, secondarySubId, secondaryName, next);
                          }}
                          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-white font-mono"
                        >
                          -0.5s
                        </button>
                        <span className="font-mono text-cyan-300 px-1">{subOffsetSecs}s</span>
                        <button
                          onClick={() => {
                            const next = parseFloat((subOffsetSecs + 0.5).toFixed(1));
                            setSubOffsetSecs(next);
                            persistSubtitleMemory(primarySubId, primaryName, secondarySubId, secondaryName, next);
                          }}
                          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-white font-mono"
                        >
                          +0.5s
                        </button>
                        {subOffsetSecs !== 0 && (
                          <button
                            onClick={() => {
                              setSubOffsetSecs(0);
                              persistSubtitleMemory(primarySubId, primaryName, secondarySubId, secondaryName, 0);
                            }}
                            className="text-[10px] text-slate-500 hover:text-slate-300 px-1"
                          >
                            复位
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
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
                  <div className="absolute bottom-full right-0 mb-2 w-28 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl p-1 z-40 text-xs">
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
                  title="画面比例与裁剪模式 (快捷键 C 循环切换)"
                >
                  <RectangleHorizontal className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  <span className="hidden md:inline text-[10px] font-mono font-semibold uppercase">
                    {aspectRatio === 'contain' ? '适配' : aspectRatio === 'cover' ? '铺满' : aspectRatio}
                  </span>
                </button>

                {showAspectMenu && (
                  <div className="absolute bottom-full right-0 mb-2 w-52 bg-slate-900/95 backdrop-blur-md border border-slate-800 rounded-2xl shadow-2xl p-2 space-y-1 z-50 text-xs animate-fade-in">
                    <div className="px-2 py-1 text-[10px] text-slate-400 font-semibold border-b border-slate-800 flex items-center justify-between">
                      <span>画面比例模式</span>
                      <span className="text-slate-500 font-mono">按 C 切换</span>
                    </div>
                    {[
                      { id: 'contain', label: '最佳适配 (完整不裁切)', desc: '默认模式，黑边自适应' },
                      { id: 'cover', label: '智能铺满 (去除黑边)', desc: '居中裁剪铺满屏幕' },
                      { id: 'fill', label: '拉伸铺满 (撑满视口)', desc: '不保持原比例拉伸' },
                      { id: '16:9', label: '16:9 标准宽屏', desc: '现代电视及宽屏显示器' },
                      { id: '4:3', label: '4:3 经典方屏', desc: '经典老番与复古电影' },
                      { id: '21:9', label: '21:9 影院超宽银幕', desc: '院线宽银幕适配' },
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

              {/* Picture in Picture */}
              <button
                onClick={togglePiP}
                className="hidden sm:block p-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white transition-colors"
                title="画中画"
              >
                <PictureInPicture className="w-4 h-4" />
              </button>

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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
            <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center space-x-2">
                  <ExternalLink className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-base font-bold text-white">调用外部播放器</h3>
                </div>
                <button onClick={() => setShowExternalModal(false)} className="text-slate-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-semibold">
                <a
                  href={`vlc://${streamUrl}`}
                  className="p-3 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-orange-500/50 text-orange-300 text-center transition-all block"
                >
                  <Tv className="w-4 h-4 mx-auto mb-1 text-orange-400" />
                  <span>VLC Media Player</span>
                </a>
                <a
                  href={`iina://weblink?url=${encodeURIComponent(streamUrl)}`}
                  className="p-3 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-blue-500/50 text-blue-300 text-center transition-all block"
                >
                  <Film className="w-4 h-4 mx-auto mb-1 text-blue-400" />
                  <span>IINA (Mac)</span>
                </a>
                <a
                  href={`infuse://x-callback-url/open?url=${encodeURIComponent(streamUrl)}`}
                  className="p-3 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-amber-500/50 text-amber-300 text-center transition-all block"
                >
                  <Play className="w-4 h-4 mx-auto mb-1 text-amber-400" />
                  <span>Infuse (iOS/Mac)</span>
                </a>
                <a
                  href={`nplayer-${streamUrl}`}
                  className="p-3 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-cyan-500/50 text-cyan-300 text-center transition-all block"
                >
                  <Activity className="w-4 h-4 mx-auto mb-1 text-cyan-400" />
                  <span>nPlayer</span>
                </a>
                <a
                  href={`intent:${streamUrl}#Intent;type=video/*;package=com.mxtech.videoplayer.ad;end`}
                  className="p-3 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-emerald-500/50 text-emerald-300 text-center transition-all block"
                >
                  <Smartphone className="w-4 h-4 mx-auto mb-1 text-emerald-400" />
                  <span>MX Player (Android)</span>
                </a>
                <a
                  href={`potplayer://${streamUrl}`}
                  className="p-3 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-purple-500/50 text-purple-300 text-center transition-all block"
                >
                  <Tv className="w-4 h-4 mx-auto mb-1 text-purple-400" />
                  <span>PotPlayer (Win)</span>
                </a>
              </div>

              <div className="pt-2 border-t border-slate-800 space-y-2">
                <span className="text-[11px] text-slate-400 block font-medium">快速复制直链:</span>
                <div className="flex space-x-2">
                  <button
                    onClick={() => handleCopyUrl(streamUrl)}
                    className="flex-1 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 flex items-center justify-center space-x-1.5 transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>网关直连 (免翻墙)</span>
                  </button>
                  <button
                    onClick={() => handleCopyUrl(official302Url)}
                    className="flex-1 py-2 px-3 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-semibold flex items-center justify-center space-x-1.5 transition-colors"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    <span>官方直链 (需梯子)</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
