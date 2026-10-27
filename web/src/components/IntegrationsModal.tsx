import React, { useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Film,
  HardDrive,
  Info,
  Layers,
  Play,
  Server,
  Share2,
  Tv,
  X,
  Zap,
} from 'lucide-react';
import { SystemStatus } from '../types';
import { copyToClipboard } from '../utils/clipboard';

interface IntegrationsModalProps {
  status: SystemStatus | null;
  onClose: () => void;
}

export const IntegrationsModal: React.FC<IntegrationsModalProps> = ({ status, onClose }) => {
  const [activeTab, setActiveTab] = useState<'emby' | 'openlist' | 'players'>('emby');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Emby export state
  const [folderId, setFolderId] = useState('root');
  const [customBaseUrl, setCustomBaseUrl] = useState(window.location.origin);
  const [exporting, setExporting] = useState(false);

  const copy = (text: string, key: string) => {
    copyToClipboard(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleDownloadStrmZip = () => {
    setExporting(true);
    const token = localStorage.getItem('gdirect_api_key') || '';
    const base = customBaseUrl.trim() || window.location.origin;
    const url = `/api/strm/export?folder=${encodeURIComponent(folderId)}&base_url=${encodeURIComponent(base)}${
      token ? `&token=${encodeURIComponent(token)}` : ''
    }`;

    const link = document.createElement('a');
    link.href = url;
    link.download = 'emby_strm_library.zip';
    link.click();
    setTimeout(() => setExporting(false), 2000);
  };

  const webdavUrl = `${customBaseUrl}/webdav/`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/85 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-3xl rounded-2xl glass-panel p-6 shadow-2xl border border-slate-800 space-y-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <Tv className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">协议接入</h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex space-x-1.5 bg-slate-900/90 p-1 rounded-xl border border-slate-800 text-xs font-medium">
          <button
            onClick={() => setActiveTab('emby')}
            className={`flex-1 py-1.5 px-3 rounded-lg transition-all flex items-center justify-center space-x-1.5 ${
              activeTab === 'emby'
                ? 'bg-cyan-500 text-slate-950 font-semibold shadow-md shadow-cyan-500/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Tv className="w-3.5 h-3.5" />
            <span>Emby / Jellyfin</span>
          </button>
          <button
            onClick={() => setActiveTab('openlist')}
            className={`flex-1 py-1.5 px-3 rounded-lg transition-all flex items-center justify-center space-x-1.5 ${
              activeTab === 'openlist'
                ? 'bg-cyan-500 text-slate-950 font-semibold shadow-md shadow-cyan-500/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>OpenList (WebDAV)</span>
          </button>
          <button
            onClick={() => setActiveTab('players')}
            className={`flex-1 py-1.5 px-3 rounded-lg transition-all flex items-center justify-center space-x-1.5 ${
              activeTab === 'players'
                ? 'bg-cyan-500 text-slate-950 font-semibold shadow-md shadow-cyan-500/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Play className="w-3.5 h-3.5" />
            <span>播放器直连</span>
          </button>
        </div>

        {/* Tab 1: Emby .strm */}
        {activeTab === 'emby' && (
          <div className="space-y-4 text-xs">
            <div className="rounded-xl border border-slate-800/80 p-4 space-y-4 bg-slate-900/40">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                一键生成媒体库 .strm 压缩包
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">
                    Google Drive 目录 ID
                  </label>
                  <input
                    type="text"
                    value={folderId}
                    onChange={(e) => setFolderId(e.target.value)}
                    placeholder="默认 root (整盘导出)"
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700/80 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
                  />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">
                    可填入特定影视文件夹 ID 或保留 root
                  </span>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1 font-medium">
                    网关服务公网基地址
                  </label>
                  <input
                    type="text"
                    value={customBaseUrl}
                    onChange={(e) => setCustomBaseUrl(e.target.value)}
                    placeholder="https://drive-gw.example.com"
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700/80 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
                  />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">
                    Emby 将通过此地址请求视频流
                  </span>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  onClick={handleDownloadStrmZip}
                  disabled={exporting}
                  className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-semibold text-xs shadow-lg shadow-cyan-500/20 transition-all"
                >
                  <Download className="w-4 h-4" />
                  <span>{exporting ? '正在打包生成...' : '立即下载 .strm 媒体库压缩包 (ZIP)'}</span>
                </button>
              </div>
            </div>

            {/* Emby Usage Snippet */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-slate-300">Emby 部署配置方法:</h4>
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-slate-300 space-y-1">
                <p className="text-slate-400"># 1. 解压下载的 zip 至 Emby 媒体目录，例如：</p>
                <p className="text-cyan-300">unzip emby_strm_library.zip -d /srv/emby-media/Movies</p>
                <p className="text-slate-400 mt-2"># 2. 在 Emby 控制台添加媒体库 &rarr; 路径选择 /srv/emby-media/Movies</p>
                <p className="text-slate-400"># 3. Emby 自动识别 .strm，直接播放原画，绝不落盘缓存！</p>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: OpenList */}
        {activeTab === 'openlist' && (
          <div className="space-y-4 text-xs">
            <div className="rounded-xl border border-slate-800/80 p-4 space-y-3 bg-slate-900/40 text-xs">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                OpenList 挂载配置
              </h3>

              <div className="space-y-2.5">
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                  <span className="text-slate-400">驱动类型 (Driver):</span>
                  <span className="font-mono text-cyan-300 font-bold">WebDAV</span>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                  <span className="text-slate-400">WebDAV 地址:</span>
                  <div className="flex items-center space-x-2">
                    <span className="font-mono text-cyan-200">{webdavUrl}</span>
                    <button
                      onClick={() => copy(webdavUrl, 'webdav')}
                      className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
                      title="复制地址"
                    >
                      {copiedKey === 'webdav' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                  <span className="text-slate-400">Web 代理:</span>
                  <span className="px-2 py-0.5 rounded-md bg-rose-950/80 border border-rose-800/40 text-rose-300 font-bold">
                    关闭
                  </span>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                  <span className="text-slate-400">账号 / 密码 (Credentials):</span>
                  <span className="text-slate-400 font-mono">留空 (或输入配置的 Master API Key)</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Infuse & VLC */}
        {activeTab === 'players' && (
          <div className="space-y-5 text-sm">
            <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800/80 space-y-2">
              <div className="flex items-center space-x-2 text-cyan-300 font-semibold text-xs">
                <Play className="w-4 h-4" />
                <span>支持第三方独立播放器原生播放</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                无论是 Apple TV 上的 Infuse、还是 PC/Mac 上的 IINA、VLC，均可直接通过 WebDAV 挂载或复制特定视频的 HTTP 206 直链，享受任意拖动进度条、多音轨切换与外挂字幕。
              </p>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1.5">
                <span className="font-semibold text-white">Apple TV / iOS Infuse 挂载方式:</span>
                <p className="text-slate-400">
                  在 Infuse 中添加文件来源 &rarr; 选择 <strong>WebDAV</strong> &rarr; 输入协议地址 <code className="text-cyan-300">{webdavUrl}</code>，端口 8080，路径留空。Infuse 即可实时读取 5TB 影视库并原画解码！
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1.5">
                <span className="font-semibold text-white">VLC / IINA 网络串流方式:</span>
                <p className="text-slate-400">
                  在视频卡片上点击“复制直链”，在播放器中按 <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200">Ctrl+N</kbd> / <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200">Cmd+U</kbd> 粘贴直链，即可直接秒开播放！
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
