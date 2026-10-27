import React, { useState, useMemo } from 'react';
import {
  ChevronRight,
  Code,
  Copy,
  Download,
  Eye,
  File as FileIcon,
  FileCode,
  FileText,
  Film,
  Folder,
  Grid,
  Image as ImageIcon,
  Info,
  LayoutList,
  Music,
  Play,
  RotateCw,
  Search,
  Share2,
  Tv,
} from 'lucide-react';
import { DriveFile } from '../types';
import { copyToClipboard as copyUtil } from '../utils/clipboard';

interface ExplorerProps {
  files: DriveFile[];
  loading: boolean;
  currentFolder: string;
  folderHistory: { id: string; name: string }[];
  onNavigateFolder: (id: string, name: string) => void;
  onNavigateBreadcrumb: (index: number) => void;
  onPlayFile: (file: DriveFile) => void;
  onRefresh: () => void;
}

export const Explorer: React.FC<ExplorerProps> = ({
  files,
  loading,
  currentFolder,
  folderHistory,
  onNavigateFolder,
  onNavigateBreadcrumb,
  onPlayFile,
  onRefresh,
}) => {
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'video' | 'audio' | 'image' | 'doc' | 'folder'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const formatPlaybackSec = (secStr: string) => {
    const sec = parseInt(secStr, 10);
    if (isNaN(sec) || sec <= 0) return null;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    const h = Math.floor(m / 60);
    const remM = m % 60;
    if (h > 0) return `${h}:${remM.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${remM}:${s.toString().padStart(2, '0')}`;
  };

  const getSavedProgress = (fileId: string) => {
    return localStorage.getItem(`gdirect_prog_${fileId}`);
  };

  const formatSize = (sizeStr?: string) => {
    if (!sizeStr) return '-';
    const bytes = parseInt(sizeStr, 10);
    if (isNaN(bytes)) return '-';
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${(bytes / 1024).toFixed(0)} KB`;
  };

  const isVideo = (file: DriveFile) => {
    if (file.mimeType.startsWith('video/')) return true;
    const name = file.name.toLowerCase();
    return /\.(mp4|mkv|avi|mov|wmv|flv|webm|ts|m4v|iso)$/.test(name);
  };

  const isAudio = (file: DriveFile) => {
    if (file.mimeType.startsWith('audio/')) return true;
    const name = file.name.toLowerCase();
    return /\.(mp3|flac|wav|m4a|aac|ogg|opus)$/.test(name);
  };

  const isImage = (file: DriveFile) => {
    if (file.mimeType.startsWith('image/')) return true;
    const name = file.name.toLowerCase();
    return /\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)$/.test(name);
  };

  const isDoc = (file: DriveFile) => {
    if (file.mimeType.startsWith('text/') || file.mimeType.includes('pdf') || file.mimeType.includes('document')) return true;
    const name = file.name.toLowerCase();
    return /\.(txt|md|json|pdf|js|ts|py|sh|html|css|xml|yml|yaml|csv)$/.test(name);
  };

  const filteredFiles = useMemo(() => {
    return files.filter((f) => {
      // Search term
      if (search.trim()) {
        const query = search.toLowerCase();
        if (!f.name.toLowerCase().includes(query)) return false;
      }
      // Type filter
      if (filterType === 'folder') return f.mimeType === 'application/vnd.google-apps.folder';
      if (filterType === 'video') return isVideo(f);
      if (filterType === 'audio') return isAudio(f);
      if (filterType === 'image') return isImage(f);
      if (filterType === 'doc') return isDoc(f);
      return true;
    });
  }, [files, search, filterType]);

  const copyToClipboard = (text: string, id: string) => {
    copyUtil(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getStreamUrl = (id: string, name: string) => {
    const origin = window.location.origin;
    const key = localStorage.getItem('gdirect_api_key');
    const param = key ? `?token=${encodeURIComponent(key)}` : '';
    return `${origin}/d/${id}/${encodeURIComponent(name)}${param}`;
  };

  const downloadFile = (file: DriveFile) => {
    const a = document.createElement('a');
    a.href = getStreamUrl(file.id, file.name);
    a.download = file.name;
    a.click();
  };

  const downloadStrm = (file: DriveFile) => {
    const url = getStreamUrl(file.id, file.name);
    const blob = new Blob([url + '\n'], { type: 'text/plain' });
    const stem = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${stem}.strm`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="space-y-4">
      {/* Top Controls: Breadcrumbs, Search, Filters & View Toggle */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-4 rounded-2xl glass-panel border border-slate-800/80">
        {/* Breadcrumbs */}
        <div className="flex items-center space-x-1.5 overflow-x-auto text-sm text-slate-300 py-1">
          {folderHistory.map((item, idx) => (
            <React.Fragment key={item.id + idx}>
              {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />}
              <button
                onClick={() => onNavigateBreadcrumb(idx)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors shrink-0 ${
                  idx === folderHistory.length - 1
                    ? 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                {item.name === 'root' ? '根目录 Root' : item.name}
              </button>
            </React.Fragment>
          ))}
        </div>

        {/* Search, Filter Pills & View Mode */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search Bar */}
          <div className="relative flex-1 sm:w-48">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="搜索云端文件..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
            />
          </div>

          {/* Filter Pills */}
          <div className="flex items-center space-x-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setFilterType('all')}
              className={`px-2.5 py-1 rounded-lg transition-colors font-medium ${
                filterType === 'all'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              全部
            </button>
            <button
              onClick={() => setFilterType('video')}
              className={`px-2 py-1 rounded-lg transition-colors font-medium flex items-center space-x-1 ${
                filterType === 'video'
                  ? 'bg-cyan-500/20 text-cyan-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Film className="w-3 h-3" />
              <span>视频</span>
            </button>
            <button
              onClick={() => setFilterType('audio')}
              className={`px-2 py-1 rounded-lg transition-colors font-medium flex items-center space-x-1 ${
                filterType === 'audio'
                  ? 'bg-purple-500/20 text-purple-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Music className="w-3 h-3" />
              <span>音频</span>
            </button>
            <button
              onClick={() => setFilterType('image')}
              className={`px-2 py-1 rounded-lg transition-colors font-medium flex items-center space-x-1 ${
                filterType === 'image'
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ImageIcon className="w-3 h-3" />
              <span>图片</span>
            </button>
            <button
              onClick={() => setFilterType('doc')}
              className={`px-2 py-1 rounded-lg transition-colors font-medium flex items-center space-x-1 ${
                filterType === 'doc'
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileText className="w-3 h-3" />
              <span>文档</span>
            </button>
            <button
              onClick={() => setFilterType('folder')}
              className={`px-2 py-1 rounded-lg transition-colors font-medium flex items-center space-x-1 ${
                filterType === 'folder'
                  ? 'bg-blue-500/20 text-blue-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Folder className="w-3 h-3" />
              <span>目录</span>
            </button>
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center space-x-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-slate-400">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-lg transition-colors ${
                viewMode === 'grid' ? 'bg-slate-800 text-cyan-400' : 'hover:text-slate-200'
              }`}
              title="网格视图"
            >
              <Grid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-lg transition-colors ${
                viewMode === 'list' ? 'bg-slate-800 text-cyan-400' : 'hover:text-slate-200'
              }`}
              title="列表视图"
            >
              <LayoutList className="w-4 h-4" />
            </button>
            <button
              onClick={onRefresh}
              className="p-1.5 rounded-lg hover:text-slate-200 hover:bg-slate-800 transition-colors"
              title="刷新列表"
            >
              <RotateCw className={`w-4 h-4 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Media Items Area */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 animate-pulse">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="h-40 rounded-2xl bg-slate-900/60 border border-slate-800"></div>
          ))}
        </div>
      ) : filteredFiles.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-16 rounded-2xl glass-panel text-center space-y-3">
          <Folder className="w-12 h-12 text-slate-600" />
          <h3 className="text-base font-semibold text-slate-300">当前目录无匹配媒体文件</h3>
          <p className="text-xs text-slate-500 max-w-sm">
            {search ? '未检索到关键词相关文件，请尝试其它关键词' : '当前目录为空'}
          </p>
        </div>
      ) : viewMode === 'grid' ? (
        /* Grid Layout */
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredFiles.map((file) => {
            const isDir = file.mimeType === 'application/vnd.google-apps.folder';
            const isVid = isVideo(file);
            const isAud = isAudio(file);
            const isImg = isImage(file);
            const isDc = isDoc(file);

            return (
              <div
                key={file.id}
                className="glass-card rounded-2xl p-4 flex flex-col justify-between group relative overflow-hidden"
              >
                <div>
                  {/* Icon & Badges */}
                  <div className="flex items-start justify-between">
                    <div
                      onClick={() =>
                        isDir ? onNavigateFolder(file.id, file.name) : onPlayFile(file)
                      }
                      className={`p-3 rounded-xl cursor-pointer transition-transform group-hover:scale-105 ${
                        isDir
                          ? 'bg-blue-500/10 border border-blue-500/20 text-blue-400'
                          : isVid
                          ? 'bg-cyan-500/10 border border-cyan-500/20 text-cyan-400'
                          : isAud
                          ? 'bg-purple-500/10 border border-purple-500/20 text-purple-400'
                          : isImg
                          ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                          : 'bg-slate-800/80 border border-slate-700/50 text-slate-300'
                      }`}
                    >
                      {isDir ? (
                        <Folder className="w-6 h-6 fill-blue-500/20" />
                      ) : isVid ? (
                        <Film className="w-6 h-6" />
                      ) : isAud ? (
                        <Music className="w-6 h-6" />
                      ) : isImg ? (
                        <ImageIcon className="w-6 h-6" />
                      ) : isDc ? (
                        <FileText className="w-6 h-6" />
                      ) : (
                        <FileIcon className="w-6 h-6" />
                      )}
                    </div>

                    {!isDir && (
                      <div className="flex items-center space-x-1.5">
                        {isVid && getSavedProgress(file.id) && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-950/80 border border-cyan-800/60 text-cyan-300 font-semibold">
                            {formatPlaybackSec(getSavedProgress(file.id)!)}
                          </span>
                        )}
                        <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-slate-300">
                          {file.name.split('.').pop() || 'FILE'}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Title & Metadata */}
                  <div className="mt-3">
                    <h4
                      onClick={() =>
                        isDir ? onNavigateFolder(file.id, file.name) : onPlayFile(file)
                      }
                      className="text-sm font-semibold text-slate-100 hover:text-cyan-400 cursor-pointer line-clamp-2 transition-colors"
                      title={file.name}
                    >
                      {file.name}
                    </h4>
                    <div className="mt-2 flex items-center space-x-2 text-[11px] text-slate-400">
                      <span>{formatSize(file.size)}</span>
                      {file.modifiedTime && (
                        <>
                          <span>•</span>
                          <span>{file.modifiedTime.split('T')[0]}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Bottom Actions */}
                <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                  {isDir ? (
                    <button
                      onClick={() => onNavigateFolder(file.id, file.name)}
                      className="inline-flex items-center space-x-1 text-xs text-blue-400 hover:text-blue-300 font-medium"
                    >
                      <span>进入目录</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={() => onPlayFile(file)}
                      className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg font-semibold text-xs transition-colors shadow-sm ${
                        isVid
                          ? 'bg-cyan-500 hover:bg-cyan-400 text-slate-950'
                          : isAud
                          ? 'bg-purple-500 hover:bg-purple-400 text-white'
                          : isImg
                          ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                      }`}
                    >
                      {isVid ? <Play className="w-3.5 h-3.5 fill-current" /> : <Eye className="w-3.5 h-3.5" />}
                      <span>{isVid ? '播放' : '预览'}</span>
                    </button>
                  )}

                  {!isDir && (
                    <div className="flex items-center space-x-1">
                      <button
                        onClick={() => downloadFile(file)}
                        className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-cyan-300 transition-colors"
                        title="高速下载原文件"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => copyToClipboard(getStreamUrl(file.id, file.name), file.id)}
                        className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-cyan-300 transition-colors"
                        title="复制直链"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      {isVid && (
                        <button
                          onClick={() => downloadStrm(file)}
                          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-blue-300 transition-colors"
                          title="下载 Emby 单集 .strm"
                        >
                          <Tv className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {copiedId === file.id && (
                  <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in z-10">
                    <span className="text-xs font-semibold text-cyan-300">
                      ✓ 直链已复制到剪贴板！
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* List Layout */
        <div className="rounded-2xl glass-panel border border-slate-800/80 overflow-hidden">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-900/90 border-b border-slate-800 text-slate-400 text-[11px] uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">名称</th>
                <th className="py-3 px-4 w-28">大小</th>
                <th className="py-3 px-4 w-36">修改日期</th>
                <th className="py-3 px-4 w-52 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {filteredFiles.map((file) => {
                const isDir = file.mimeType === 'application/vnd.google-apps.folder';
                const isVid = isVideo(file);
                const isAud = isAudio(file);
                const isImg = isImage(file);
                const isDc = isDoc(file);

                return (
                  <tr
                    key={file.id}
                    className="hover:bg-slate-900/50 transition-colors group"
                  >
                    <td className="py-3 px-4 flex items-center space-x-3">
                      {isDir ? (
                        <Folder className="w-4 h-4 text-blue-400 shrink-0" />
                      ) : isVid ? (
                        <Film className="w-4 h-4 text-cyan-400 shrink-0" />
                      ) : isAud ? (
                        <Music className="w-4 h-4 text-purple-400 shrink-0" />
                      ) : isImg ? (
                        <ImageIcon className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : isDc ? (
                        <FileText className="w-4 h-4 text-amber-400 shrink-0" />
                      ) : (
                        <FileIcon className="w-4 h-4 text-slate-500 shrink-0" />
                      )}
                      <span
                        onClick={() =>
                          isDir ? onNavigateFolder(file.id, file.name) : onPlayFile(file)
                        }
                        className="font-medium text-slate-200 hover:text-cyan-400 cursor-pointer truncate max-w-md sm:max-w-lg"
                      >
                        {file.name}
                      </span>
                      {isVid && getSavedProgress(file.id) && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-950/80 border border-cyan-800/60 text-cyan-300 font-semibold shrink-0">
                          {formatPlaybackSec(getSavedProgress(file.id)!)}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-400">
                      {formatSize(file.size)}
                    </td>
                    <td className="py-3 px-4 text-slate-400">
                      {file.modifiedTime ? file.modifiedTime.split('T')[0] : '-'}
                    </td>
                    <td className="py-3 px-4 text-right space-x-1.5">
                      {isDir ? (
                        <button
                          onClick={() => onNavigateFolder(file.id, file.name)}
                          className="text-blue-400 hover:text-blue-300 font-medium px-2 py-1"
                        >
                          进入
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => onPlayFile(file)}
                            className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-md bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 font-semibold"
                          >
                            <Eye className="w-3 h-3" />
                            <span>预览</span>
                          </button>
                          <button
                            onClick={() => downloadFile(file)}
                            className="p-1 text-slate-400 hover:text-slate-200"
                            title="下载原文件"
                          >
                            <Download className="w-3.5 h-3.5 inline" />
                          </button>
                          <button
                            onClick={() => copyToClipboard(getStreamUrl(file.id, file.name), file.id)}
                            className="p-1 text-slate-400 hover:text-slate-200"
                            title="复制播放直链"
                          >
                            <Copy className="w-3.5 h-3.5 inline" />
                          </button>
                          {isVid && (
                            <button
                              onClick={() => downloadStrm(file)}
                              className="p-1 text-slate-400 hover:text-slate-200"
                              title="下载 .strm"
                            >
                              <Tv className="w-3.5 h-3.5 inline" />
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
