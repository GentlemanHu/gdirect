import React, { useState } from 'react';
import {
  Check,
  Cpu,
  Save,
  Settings,
  X,
  Zap,
} from 'lucide-react';
import { StreamConfig } from '../types';

interface SettingsModalProps {
  config: StreamConfig | null;
  onUpdateConfig: (newConfig: StreamConfig) => Promise<void>;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  config,
  onUpdateConfig,
  onClose,
}) => {
  const [chunkSizeMb, setChunkSizeMb] = useState(
    config ? config.chunk_size / (1024 * 1024) : 2
  );
  const [prefetchChunks, setPrefetchChunks] = useState(
    config ? config.prefetch_chunks : 8
  );
  const [concurrency, setConcurrency] = useState(
    config ? config.concurrency : 4
  );
  const [webdavRedirect, setWebdavRedirect] = useState(
    config ? config.webdav_redirect : true
  );
  const [streamMode, setStreamMode] = useState<'direct' | 'official_302' | 'proxy'>(
    (config?.stream_mode as any) || 'direct'
  );
  const [proxyUrl, setProxyUrl] = useState(
    config?.proxy_url || ''
  );
  const [masterApiKey, setMasterApiKey] = useState(
    config?.master_api_key || ''
  );
  const [customRamMb, setCustomRamMb] = useState(
    String(
      config
        ? (config.chunk_size * config.prefetch_chunks) / (1024 * 1024)
        : 64
    )
  );

  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleRamPreset = (targetMb: number) => {
    setCustomRamMb(String(targetMb));
    const chunks = Math.max(2, Math.round(targetMb / chunkSizeMb));
    setPrefetchChunks(chunks);
  };

  const handleCustomRamChange = (valStr: string) => {
    setCustomRamMb(valStr);
    const parsed = parseInt(valStr, 10);
    if (!isNaN(parsed) && parsed > 0) {
      const chunks = Math.max(2, Math.round(parsed / chunkSizeMb));
      setPrefetchChunks(chunks);
    }
  };

  const handleChunkChange = (newChunkMb: number) => {
    setChunkSizeMb(newChunkMb);
    const parsedRam = parseInt(customRamMb, 10) || 64;
    const chunks = Math.max(2, Math.round(parsedRam / newChunkMb));
    setPrefetchChunks(chunks);
  };

  const handleSave = async () => {
    setSaving(true);
    const updated: StreamConfig = {
      chunk_size: chunkSizeMb * 1024 * 1024,
      prefetch_chunks: prefetchChunks,
      concurrency: concurrency,
      webdav_redirect: webdavRedirect,
      master_api_key: masterApiKey.trim() ? masterApiKey.trim() : null,
      stream_mode: streamMode,
      proxy_url: proxyUrl.trim() ? proxyUrl.trim() : null,
    };

    try {
      await onUpdateConfig(updated);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2000);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const currentRamTotal = chunkSizeMb * prefetchChunks;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-xl rounded-2xl glass-panel p-5 sm:p-6 shadow-2xl border border-slate-800 space-y-5 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <Settings className="w-4 h-4" />
            </div>
            <h2 className="text-base font-bold text-white">网关性能与缓存设置</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Settings List */}
        <div className="space-y-4 text-xs">
          {/* Buffer RAM Selection */}
          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200">流媒体内存预读缓存 (RAM)</span>
              <span className="font-mono font-bold text-emerald-400 text-sm">
                {currentRamTotal} MB / 会话
              </span>
            </div>

            {/* Presets */}
            <div className="grid grid-cols-5 gap-1.5 font-medium">
              {[16, 64, 128, 256, 512].map((mb) => (
                <button
                  key={mb}
                  type="button"
                  onClick={() => handleRamPreset(mb)}
                  className={`py-1.5 rounded-lg border text-center transition-colors ${
                    currentRamTotal === mb
                      ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 font-bold'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {mb} MB
                </button>
              ))}
            </div>

            {/* Custom Input */}
            <div className="flex items-center space-x-2 pt-1">
              <span className="text-slate-400 shrink-0">自定义容量:</span>
              <div className="flex-1 flex items-center bg-slate-950 border border-slate-700/80 rounded-lg px-2.5 py-1">
                <input
                  type="number"
                  min={8}
                  max={2048}
                  value={customRamMb}
                  onChange={(e) => handleCustomRamChange(e.target.value)}
                  className="w-full bg-transparent text-slate-100 font-mono text-xs focus:outline-none"
                />
                <span className="text-slate-500 shrink-0 ml-1">MB</span>
              </div>
            </div>
          </div>

          {/* Upstream Concurrency */}
          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200">并发请求连接数</span>
              <span className="font-mono font-bold text-blue-400">{concurrency} 线程</span>
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {[2, 4, 8, 12, 16].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setConcurrency(c)}
                  className={`py-1.5 rounded-lg border text-center font-medium transition-colors ${
                    concurrency === c
                      ? 'bg-blue-500/20 border-blue-500/50 text-blue-300 font-bold'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {c} 线程
                </button>
              ))}
            </div>
          </div>

          {/* Chunk Unit Size */}
          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200">分块读取单元</span>
              <span className="font-mono font-bold text-cyan-400">{chunkSizeMb} MB / 块</span>
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {[1, 2, 4, 8, 16].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => handleChunkChange(s)}
                  className={`py-1.5 rounded-lg border text-center font-medium transition-colors ${
                    chunkSizeMb === s
                      ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300 font-bold'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {s} MB
                </button>
              ))}
            </div>
          </div>

          {/* Stream Engine Mode */}
          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200">传输引擎与路由模式</span>
              <span className="font-mono text-cyan-400 font-bold">
                {streamMode === 'direct' ? '国内边缘直连' : streamMode === 'official_302' ? '官方直链重定向' : '网关代理中继'}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setStreamMode('direct')}
                className={`p-2.5 rounded-xl border text-center transition-colors ${
                  streamMode === 'direct'
                    ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300 font-bold'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="text-xs">边缘直连</div>
              </button>
              <button
                type="button"
                onClick={() => setStreamMode('official_302')}
                className={`p-2.5 rounded-xl border text-center transition-colors ${
                  streamMode === 'official_302'
                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 font-bold'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="text-xs">官方 302</div>
              </button>
              <button
                type="button"
                onClick={() => setStreamMode('proxy')}
                className={`p-2.5 rounded-xl border text-center transition-colors ${
                  streamMode === 'proxy'
                    ? 'bg-purple-500/20 border-purple-500/50 text-purple-300 font-bold'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="text-xs">代理中继</div>
              </button>
            </div>

            {streamMode === 'proxy' && (
              <div className="pt-2 flex items-center space-x-2">
                <span className="text-slate-400 shrink-0">Jinli 本地代理:</span>
                <input
                  type="text"
                  value={proxyUrl}
                  onChange={(e) => setProxyUrl(e.target.value)}
                  placeholder="http://127.0.0.1:10809 或 socks5://127.0.0.1:10808"
                  className="flex-1 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs text-white focus:outline-none focus:border-cyan-500"
                />
              </div>
            )}
          </div>

          {/* WebDAV Mode */}
          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
            <span className="font-semibold text-slate-200 block">WebDAV 传输模式</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setWebdavRedirect(true)}
                className={`py-2 px-3 rounded-lg border text-center transition-colors font-medium ${
                  webdavRedirect
                    ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300 font-bold'
                    : 'bg-slate-900 border-slate-800 text-slate-400'
                }`}
              >
                302 重定向 (OpenList)
              </button>
              <button
                type="button"
                onClick={() => setWebdavRedirect(false)}
                className={`py-2 px-3 rounded-lg border text-center transition-colors font-medium ${
                  !webdavRedirect
                    ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300 font-bold'
                    : 'bg-slate-900 border-slate-800 text-slate-400'
                }`}
              >
                206 直接流 (Infuse/VLC)
              </button>
            </div>
          </div>

          {/* API Key */}
          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1.5">
            <span className="font-semibold text-slate-200 block">Master API Key</span>
            <input
              type="text"
              value={masterApiKey}
              onChange={(e) => setMasterApiKey(e.target.value)}
              placeholder="留空为公开免密访问"
              className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-800 pt-3">
          <span className="text-xs text-emerald-400 font-mono">
            {savedSuccess && '✓ 设置已保存并持久化生效'}
          </span>
          <div className="flex space-x-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-semibold text-xs shadow-md transition-all"
            >
              {saving ? '保存中' : '保存生效'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
