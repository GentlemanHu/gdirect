import React from 'react';
import {
  Activity,
  ArrowUpRight,
  Cpu,
  Film,
  Server,
  Settings,
  Tv,
  User,
  Zap,
} from 'lucide-react';
import { SystemStatus, StreamSession } from '../types';

interface DashboardProps {
  status: SystemStatus | null;
  sessions: StreamSession[];
  onOpenExplorer: () => void;
  onOpenIntegrations: () => void;
  onOpenRoutes: () => void;
  onOpenSessions: () => void;
  onOpenLogin: () => void;
  onOpenSettings?: () => void;
  onRefresh: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  status,
  sessions,
  onOpenExplorer,
  onOpenIntegrations,
  onOpenRoutes,
  onOpenSessions,
  onOpenLogin,
  onOpenSettings,
}) => {
  const totalSpeedKbps = sessions.reduce((acc, s) => acc + s.speed_kbps, 0);
  const totalSpeedMbps = (totalSpeedKbps / 1024).toFixed(1);

  return (
    <div className="space-y-6">
      {/* Account Reminder if not logged in */}
      {!status?.account && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <User className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="text-xs text-amber-200">
              当前未绑定 Google 账号，仅可访问公开文件
            </span>
          </div>
          <button
            onClick={onOpenLogin}
            className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs shrink-0 transition-colors"
          >
            登录账号
          </button>
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Active Streams */}
        <div
          onClick={onOpenSessions}
          className="glass-card rounded-2xl p-5 cursor-pointer flex flex-col justify-between hover:border-slate-700 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">活跃播放流</span>
            <Activity className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-3xl font-bold tracking-tight text-white">
              {sessions.length}
            </span>
            <span className="text-xs text-slate-400">
              {sessions.length > 0 ? '播放中' : '空闲'}
            </span>
          </div>
        </div>

        {/* Card 2: Bandwidth */}
        <div className="glass-card rounded-2xl p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">推流带宽</span>
            <Zap className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-3xl font-bold tracking-tight text-white">
              {totalSpeedMbps}
            </span>
            <span className="text-xs text-slate-400">MB/s</span>
          </div>
        </div>

        {/* Card 3: Direct IP */}
        <div
          onClick={onOpenRoutes}
          className="glass-card rounded-2xl p-5 cursor-pointer flex flex-col justify-between hover:border-slate-700 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">直连节点</span>
            <Server className="w-4 h-4 text-blue-400" />
          </div>
          <div className="mt-3">
            <span className="text-lg font-bold font-mono text-cyan-200 truncate block">
              {status?.direct_ip || '127.0.0.1'}
            </span>
          </div>
        </div>

        {/* Card 4: Memory Buffer - Click to open Settings */}
        <div
          onClick={onOpenSettings}
          className="glass-card rounded-2xl p-5 cursor-pointer flex flex-col justify-between hover:border-slate-700 transition-colors group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">内存缓冲 (RAM)</span>
            <Cpu className="w-4 h-4 text-purple-400 group-hover:rotate-45 transition-transform" />
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-3xl font-bold tracking-tight text-white">
              {status ? status.prefetch_mb.toFixed(0) : '16'}
            </span>
            <span className="text-xs text-slate-400">MB 环形缓冲</span>
          </div>
        </div>
      </div>

      {/* Action Bar */}
      <div className="rounded-2xl glass-panel p-4 border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-white">快捷接入</h2>

        <div className="flex items-center space-x-2 shrink-0">
          <button
            onClick={onOpenExplorer}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs transition-colors"
          >
            <Film className="w-4 h-4" />
            <span>媒体库</span>
          </button>

          <button
            onClick={onOpenIntegrations}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-medium text-xs transition-colors"
          >
            <Tv className="w-4 h-4 text-cyan-400" />
            <span>协议接入</span>
          </button>
        </div>
      </div>
    </div>
  );
};
