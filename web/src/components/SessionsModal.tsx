import React from 'react';
import {
  Activity,
  AlertCircle,
  Clock,
  HardDrive,
  RefreshCw,
  Server,
  StopCircle,
  X,
  Zap,
} from 'lucide-react';
import { StreamSession } from '../types';

interface SessionsModalProps {
  sessions: StreamSession[];
  onTerminate: (sessionId: string) => void;
  onRefresh: () => void;
  onClose: () => void;
}

export const SessionsModal: React.FC<SessionsModalProps> = ({
  sessions,
  onTerminate,
  onRefresh,
  onClose,
}) => {
  const formatSize = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${(bytes / 1024).toFixed(0)} KB`;
  };

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}m ${s}s`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/85 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-4xl rounded-2xl glass-panel p-6 shadow-2xl border border-slate-800 space-y-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">活跃播放流与带宽监视器</h2>
              <p className="text-xs text-slate-400">
                实时追踪客户端 HTTP 206 分块传输、零落盘内存流速与会话生命周期
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={onRefresh}
              className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
              title="刷新会话"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Sessions Table */}
        <div className="rounded-xl border border-slate-800/80 overflow-hidden bg-slate-900/40">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-900 text-slate-400 text-[11px] uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-4">媒体文件名</th>
                <th className="py-2.5 px-4">客户端 IP</th>
                <th className="py-2.5 px-4">偏移 / 总量</th>
                <th className="py-2.5 px-4">流速</th>
                <th className="py-2.5 px-4">Google IP</th>
                <th className="py-2.5 px-4">已播时间</th>
                <th className="py-2.5 px-4 text-right">管理</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40 font-mono">
              {sessions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500 font-sans">
                    当前暂无活跃流媒体会话（空闲待机中）
                  </td>
                </tr>
              ) : (
                sessions.map((sess) => (
                  <tr key={sess.session_id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-4 max-w-xs truncate font-sans font-medium text-slate-200" title={sess.file_name}>
                      {sess.file_name}
                    </td>
                    <td className="py-3 px-4 text-slate-400">{sess.client_ip}</td>
                    <td className="py-3 px-4 text-cyan-300">
                      {formatSize(sess.current_offset)} / {formatSize(sess.total_size)}
                    </td>
                    <td className="py-3 px-4 font-bold text-emerald-400">
                      {sess.speed_kbps > 1024
                        ? `${(sess.speed_kbps / 1024).toFixed(1)} MB/s`
                        : `${sess.speed_kbps} KB/s`}
                    </td>
                    <td className="py-3 px-4 text-slate-400">{sess.google_ip}</td>
                    <td className="py-3 px-4 text-slate-400">{formatDuration(sess.duration_secs)}</td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => onTerminate(sess.session_id)}
                        className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 font-sans font-medium transition-colors border border-rose-500/20"
                        title="切断该播放流"
                      >
                        <StopCircle className="w-3.5 h-3.5" />
                        <span>切断</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
