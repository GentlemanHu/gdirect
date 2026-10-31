import React from 'react';
import { X } from 'lucide-react';
import { SystemStatus } from '../../types';

interface PlayerInfoDrawerProps {
  useOfficial302: boolean;
  videoWidth: number;
  videoHeight: number;
  resolutionBadge: string;
  avgBitrateMbps: string | null;
  streamSpeedMbps: string;
  bufferedAheadSecs: number;
  status: SystemStatus | null;
  currentTimeFormatted: string;
  durationFormatted: string;
  onClose: () => void;
}

export const PlayerInfoDrawer: React.FC<PlayerInfoDrawerProps> = ({
  useOfficial302,
  videoWidth,
  videoHeight,
  resolutionBadge,
  avgBitrateMbps,
  streamSpeedMbps,
  bufferedAheadSecs,
  status,
  currentTimeFormatted,
  durationFormatted,
  onClose,
}) => {
  return (
    <div className="absolute top-16 right-3 sm:right-6 z-40 p-4 rounded-2xl bg-slate-950/90 backdrop-blur-xl border border-slate-800 text-xs font-mono space-y-2 shadow-2xl min-w-[240px] animate-fade-in select-text">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <span className="font-bold text-white font-sans">流媒体诊断</span>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-slate-300 p-0.5 rounded transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="space-y-1.5 text-slate-300">
        <div className="flex justify-between">
          <span className="text-slate-500">传输路线:</span>
          <span className={useOfficial302 ? 'text-amber-300 font-bold' : 'text-cyan-300 font-bold'}>
            {useOfficial302 ? '官方 302' : '边缘直连'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">分辨率:</span>
          <span className="text-cyan-300 font-bold">
            {videoWidth} × {videoHeight} ({resolutionBadge})
          </span>
        </div>
        {avgBitrateMbps && (
          <div className="flex justify-between">
            <span className="text-slate-500">平均码率:</span>
            <span className="text-slate-200">{avgBitrateMbps} Mbps</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-slate-500">实时带宽:</span>
          <span className="text-emerald-400 font-bold">{streamSpeedMbps} Mbps</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">超前缓存:</span>
          <span className="text-emerald-400">+{bufferedAheadSecs} 秒</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Google 节点:</span>
          <span className="text-slate-200 truncate max-w-[120px]">
            {status?.direct_ip || '直连'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">RAM 缓冲:</span>
          <span className="text-purple-300">{status?.prefetch_mb || 16} MB (零磁盘)</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">播放进度:</span>
          <span className="text-slate-200">
            {currentTimeFormatted} / {durationFormatted}
          </span>
        </div>
      </div>
    </div>
  );
};
