import React, { useState } from 'react';
import {
  Film,
  Palette,
  RefreshCw,
  Search,
  Sliders,
  Subtitles,
  Upload,
  X,
} from 'lucide-react';
import { DriveFile } from '../../types';
import { EmbeddedTrack, OnlineSubItem } from './types';
import {
  SubtitleCue,
  SubtitleStyleConfig,
  parseSubtitle,
} from '../../utils/subtitles';
import { searchDriveFiles } from '../../api';

interface SubtitleMenuProps {
  file: DriveFile;
  sameFolderSubtitles: DriveFile[];
  embeddedTracks: EmbeddedTrack[];
  activeEmbeddedTrack: number | null;
  primaryName: string;
  secondaryName: string;
  primarySubId: string | null;
  secondarySubId: string | null;
  subOffsetSecs: number;
  subStyle: SubtitleStyleConfig;
  customSourceUrl: string;
  subtitleSources: string[];
  cleanTitle: string;
  tokenParam: string;
  onSelectEmbeddedTrack: (trackIndex: number, target: 'primary' | 'secondary') => void;
  onSelectSubtitleFile: (f: DriveFile, target: 'primary' | 'secondary') => void;
  onApplyParsedCues: (cues: SubtitleCue[], name: string, id: string | null, target: 'primary' | 'secondary') => void;
  onClearSubtitle: (target: 'primary' | 'secondary') => void;
  onUpdateSubStyle: (patch: Partial<SubtitleStyleConfig>) => void;
  onUpdateOffset: (delta: number, reset?: boolean) => void;
  onSaveCustomSource: (url: string) => void;
  onClose: () => void;
  showToast: (msg: string) => void;
}

export const SubtitleMenu: React.FC<SubtitleMenuProps> = ({
  file,
  sameFolderSubtitles,
  embeddedTracks,
  activeEmbeddedTrack,
  primaryName,
  secondaryName,
  primarySubId,
  secondarySubId,
  subOffsetSecs,
  subStyle,
  customSourceUrl,
  subtitleSources,
  cleanTitle,
  tokenParam,
  onSelectEmbeddedTrack,
  onSelectSubtitleFile,
  onApplyParsedCues,
  onClearSubtitle,
  onUpdateSubStyle,
  onUpdateOffset,
  onSaveCustomSource,
  onClose,
  showToast,
}) => {
  const [subTab, setSubTab] = useState<'folder' | 'embedded' | 'online' | 'style' | 'sources' | 'paste'>('folder');
  const [searchKeyword, setSearchKeyword] = useState(cleanTitle);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<OnlineSubItem[]>([]);
  const [customInputUrl, setCustomInputUrl] = useState(customSourceUrl);

  const handleSearchOnline = async () => {
    if (!searchKeyword.trim()) return;
    setSearchLoading(true);
    const aggregated: OnlineSubItem[] = [];

    // 1. Google Drive search
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
          lang: item.name.match(/(zh|cn|chs|cht|中)/i) ? '中文字幕' : '外文字幕',
          source: 'drive',
          url: `${window.location.origin}/d/${item.id}/${encodeURIComponent(item.name)}${tokenParam}`,
        });
      }
    } catch (err) {
      console.warn('Drive subtitle search error:', err);
    }

    // 2. Custom subtitle API
    if (customSourceUrl.trim()) {
      try {
        const targetUrl = customSourceUrl.replace('{query}', encodeURIComponent(searchKeyword));
        const res = await fetch(targetUrl);
        if (res.ok) {
          const list = await res.json();
          if (Array.isArray(list)) {
            list.forEach((item: any, idx: number) => {
              aggregated.push({
                id: `custom_${idx}_${Date.now()}`,
                name: item.name || item.title || `自定义字幕 #${idx + 1}`,
                lang: item.lang || '在线',
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

  return (
    <div className="fixed sm:absolute bottom-16 sm:bottom-full left-3 right-3 sm:left-auto sm:right-0 mb-3 w-auto sm:w-[460px] rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-4 z-50 text-xs space-y-3 animate-fade-in">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center space-x-2">
          <Subtitles className="w-4 h-4 text-cyan-400" />
          <span className="font-bold text-white">双字幕控制台</span>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300 p-0.5 rounded transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Active Subtitle Cards */}
      <div className="grid grid-cols-2 gap-2 p-2 rounded-xl bg-slate-950/80 border border-slate-800 text-[11px]">
        <div className="flex items-center justify-between overflow-hidden">
          <span className="text-cyan-400 font-semibold shrink-0 mr-1.5">主:</span>
          <span className="truncate text-slate-200" title={primaryName}>
            {primaryName}
          </span>
          {primaryName !== '无' && (
            <button
              onClick={() => onClearSubtitle('primary')}
              className="text-slate-500 hover:text-rose-400 ml-1 shrink-0"
              title="卸载主字幕"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <div className="flex items-center justify-between overflow-hidden">
          <span className="text-amber-400 font-semibold shrink-0 mr-1.5">副:</span>
          <span className="truncate text-slate-200" title={secondaryName}>
            {secondaryName}
          </span>
          {secondaryName !== '无' && (
            <button
              onClick={() => onClearSubtitle('secondary')}
              className="text-slate-500 hover:text-rose-400 ml-1 shrink-0"
              title="卸载副字幕"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-[11px]">
        <button
          onClick={() => setSubTab('folder')}
          className={`flex-1 py-1 rounded-lg transition-colors ${
            subTab === 'folder' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          同目录 ({sameFolderSubtitles.length})
        </button>
        <button
          onClick={() => setSubTab('embedded')}
          className={`flex-1 py-1 rounded-lg flex items-center justify-center space-x-1 transition-colors ${
            subTab === 'embedded' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Film className="w-3 h-3" />
          <span>内嵌轨{embeddedTracks.length > 0 ? ` (${embeddedTracks.length})` : ''}</span>
        </button>
        <button
          onClick={() => setSubTab('online')}
          className={`flex-1 py-1 rounded-lg transition-colors ${
            subTab === 'online' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          全盘搜索
        </button>
        <button
          onClick={() => setSubTab('style')}
          className={`flex-1 py-1 rounded-lg flex items-center justify-center space-x-1 transition-colors ${
            subTab === 'style' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Palette className="w-3 h-3" />
          <span>外观</span>
        </button>
        <button
          onClick={() => setSubTab('sources')}
          className={`flex-1 py-1 rounded-lg transition-colors ${
            subTab === 'sources' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          源配置
        </button>
        <button
          onClick={() => setSubTab('paste')}
          className={`flex-1 py-1 rounded-lg transition-colors ${
            subTab === 'paste' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          上传
        </button>
      </div>

      {/* Tab: Folder Subtitles */}
      {subTab === 'folder' && (
        <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
          {sameFolderSubtitles.length === 0 ? (
            <div className="p-4 text-center text-slate-500 text-[11px]">同目录下暂无外挂字幕文件</div>
          ) : (
            sameFolderSubtitles.map((sub) => (
              <div
                key={sub.id}
                className="p-2 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2"
              >
                <span className="truncate text-slate-200 text-xs" title={sub.name}>
                  {sub.name}
                </span>
                <div className="flex space-x-1 shrink-0">
                  <button
                    onClick={() => onSelectSubtitleFile(sub, 'primary')}
                    className="px-2 py-0.5 rounded-lg bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500 hover:text-slate-950 font-semibold"
                  >
                    设为主
                  </button>
                  <button
                    onClick={() => onSelectSubtitleFile(sub, 'secondary')}
                    className="px-2 py-0.5 rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500 hover:text-slate-950 font-semibold"
                  >
                    设为副
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab: Embedded Tracks */}
      {subTab === 'embedded' && (
        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
          {embeddedTracks.length > 0 ? (
            embeddedTracks.map((trk) => (
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
                  </span>
                </div>
                <div className="flex space-x-1 shrink-0">
                  <button
                    onClick={() => onSelectEmbeddedTrack(trk.index, 'primary')}
                    className="px-2.5 py-1 rounded-lg bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500 hover:text-slate-950 text-xs font-semibold"
                  >
                    设为主
                  </button>
                  <button
                    onClick={() => onSelectEmbeddedTrack(trk.index, 'secondary')}
                    className="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500 hover:text-slate-950 text-xs font-semibold"
                  >
                    设为副
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-center text-slate-400 text-xs">
              未检测到内嵌文本字幕轨
            </div>
          )}
        </div>
      )}

      {/* Tab: Online Search */}
      {subTab === 'online' && (
        <div className="space-y-2">
          <div className="flex space-x-1.5">
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearchOnline()}
              placeholder="搜索字幕关键词..."
              className="flex-1 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
            />
            <button
              onClick={handleSearchOnline}
              disabled={searchLoading}
              className="px-3.5 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs flex items-center space-x-1"
            >
              {searchLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              <span>搜索</span>
            </button>
          </div>

          <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
            {searchResults.length === 0 ? (
              <div className="p-4 text-center text-slate-500 text-[11px]">
                输入影片名称搜索全盘 Google Drive 及配置源
              </div>
            ) : (
              searchResults.map((item) => (
                <div key={item.id} className="p-2 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
                  <div className="overflow-hidden flex-1">
                    <p className="break-words text-xs text-slate-200 line-clamp-2">{item.name}</p>
                    <div className="flex items-center space-x-2 mt-0.5">
                      <span className="text-[10px] text-cyan-400">{item.lang}</span>
                      <span className="text-[10px] text-slate-500 font-mono">[{item.source}]</span>
                    </div>
                  </div>
                  <div className="flex space-x-1 shrink-0">
                    <button
                      onClick={() => {
                        const apply = (cues: SubtitleCue[]) => {
                          onApplyParsedCues(cues, item.name, item.id, 'primary');
                        };
                        if (item.content) {
                          apply(parseSubtitle(item.content));
                        } else if (item.url) {
                          fetch(item.url)
                            .then((r) => r.text())
                            .then((t) => apply(parseSubtitle(t)));
                        }
                      }}
                      className="px-2 py-0.5 rounded-lg bg-cyan-500/20 text-cyan-300 font-semibold hover:bg-cyan-500 hover:text-slate-950"
                    >
                      主
                    </button>
                    <button
                      onClick={() => {
                        const apply = (cues: SubtitleCue[]) => {
                          onApplyParsedCues(cues, item.name, item.id, 'secondary');
                        };
                        if (item.content) {
                          apply(parseSubtitle(item.content));
                        } else if (item.url) {
                          fetch(item.url)
                            .then((r) => r.text())
                            .then((t) => apply(parseSubtitle(t)));
                        }
                      }}
                      className="px-2 py-0.5 rounded-lg bg-amber-500/20 text-amber-300 font-semibold hover:bg-amber-500 hover:text-slate-950"
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

      {/* Tab: Appearance */}
      {subTab === 'style' && (
        <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
          <div className="space-y-1">
            <div className="flex justify-between items-center text-slate-300">
              <span>字体大小</span>
              <span className="font-mono text-cyan-400 font-bold">{subStyle.fontSize}px</span>
            </div>
            <div className="flex items-center space-x-1.5">
              {[16, 20, 24, 28, 34].map((sz) => (
                <button
                  key={sz}
                  onClick={() => onUpdateSubStyle({ fontSize: sz })}
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

          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <span className="text-slate-300 block">主字幕颜色</span>
              <div className="flex space-x-1.5">
                {['#FFFFFF', '#FACC15', '#22D3EE', '#4ADE80'].map((c) => (
                  <button
                    key={c}
                    onClick={() => onUpdateSubStyle({ primaryColor: c })}
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
                    onClick={() => onUpdateSubStyle({ secondaryColor: c })}
                    style={{ backgroundColor: c }}
                    className={`w-6 h-6 rounded-full border-2 transition-transform ${
                      subStyle.secondaryColor === c ? 'scale-110 border-white shadow-lg' : 'border-slate-800'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <span className="text-slate-300 block">渲染风格</span>
            <div className="grid grid-cols-4 gap-1.5">
              {[
                { id: 'box', label: '黑底胶囊' },
                { id: 'stroke', label: '深色描边' },
                { id: 'shadow', label: '柔和投影' },
                { id: 'none', label: '纯净原字' },
              ].map((bg) => (
                <button
                  key={bg.id}
                  onClick={() => onUpdateSubStyle({ bgStyle: bg.id as any })}
                  className={`py-1 rounded-lg border text-center ${
                    subStyle.bgStyle === bg.id
                      ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300 font-bold'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  {bg.label}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-1 flex items-center justify-between border-t border-slate-800 text-[11px] text-slate-300">
            <span>双语字幕自动分行</span>
            <input
              type="checkbox"
              checked={subStyle.bilingualSplit}
              onChange={(e) => onUpdateSubStyle({ bilingualSplit: e.target.checked })}
              className="accent-cyan-400 rounded cursor-pointer"
            />
          </div>
        </div>
      )}

      {/* Tab: Sources */}
      {subTab === 'sources' && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-[11px] text-slate-300 font-medium">配置自定义字幕 Webhook / API</label>
            <div className="flex space-x-1.5">
              <input
                type="text"
                value={customInputUrl}
                onChange={(e) => setCustomInputUrl(e.target.value)}
                placeholder="https://api.example.com/subtitles?q={query}"
                className="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white font-mono"
              />
              <button
                onClick={() => onSaveCustomSource(customInputUrl)}
                className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold"
              >
                保存
              </button>
            </div>
          </div>

          <div className="space-y-1 text-slate-400 text-[11px]">
            <span className="font-semibold text-slate-200">激活的字幕搜索源:</span>
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

      {/* Tab: Local Upload */}
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
                    onApplyParsedCues(parsed, f.name, null, 'primary');
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
            onClick={() => onUpdateOffset(-0.5)}
            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-white font-mono"
          >
            -0.5s
          </button>
          <span className="font-mono text-cyan-300 px-1">{subOffsetSecs}s</span>
          <button
            onClick={() => onUpdateOffset(0.5)}
            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-white font-mono"
          >
            +0.5s
          </button>
          {subOffsetSecs !== 0 && (
            <button
              onClick={() => onUpdateOffset(0, true)}
              className="text-[10px] text-slate-500 hover:text-slate-300 px-1"
            >
              复位
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
