import React from 'react';
import { Check, Film, Play, X } from 'lucide-react';
import { DriveFile } from '../../types';

interface QueueMenuProps {
  playQueue: DriveFile[];
  currentFileId: string;
  autoNext: boolean;
  onToggleAutoNext: (val: boolean) => void;
  onSelectFile: (file: DriveFile) => void;
  onClose: () => void;
}

export const QueueMenu: React.FC<QueueMenuProps> = ({
  playQueue,
  currentFileId,
  autoNext,
  onToggleAutoNext,
  onSelectFile,
  onClose,
}) => {
  return (
    <div className="fixed sm:absolute bottom-16 sm:bottom-full left-3 right-3 sm:left-auto sm:right-0 mb-3 w-auto sm:w-[380px] rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-4 z-50 text-xs space-y-3 animate-fade-in">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center space-x-2">
          <span className="font-bold text-white">播放队列 ({playQueue.length})</span>
          <label className="flex items-center space-x-1.5 cursor-pointer text-slate-400 text-[11px] select-none">
            <input
              type="checkbox"
              checked={autoNext}
              onChange={(e) => onToggleAutoNext(e.target.checked)}
              className="accent-cyan-400 rounded cursor-pointer"
            />
            <span>自动连播</span>
          </label>
        </div>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-slate-300 p-0.5 rounded transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
        {playQueue.map((item, idx) => {
          const isCurrent = item.id === currentFileId;
          return (
            <button
              key={item.id}
              onClick={() => {
                if (!isCurrent) onSelectFile(item);
              }}
              className={`w-full text-left p-2.5 rounded-xl border flex items-center justify-between gap-2.5 transition-colors ${
                isCurrent
                  ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-300 font-semibold'
                  : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800/60'
              }`}
            >
              <div className="flex items-center space-x-2 min-w-0">
                <span className="text-[11px] font-mono text-slate-500 w-4 text-center shrink-0">
                  {idx + 1}
                </span>
                <span className="truncate text-xs">{item.name}</span>
              </div>
              {isCurrent && <Play className="w-3.5 h-3.5 text-cyan-400 fill-current shrink-0" />}
            </button>
          );
        })}
      </div>
    </div>
  );
};
