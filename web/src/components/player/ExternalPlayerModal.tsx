import React, { useState } from 'react';
import {
  Copy,
  ExternalLink,
  Film,
  Globe,
  Tv,
  X,
} from 'lucide-react';
import { copyToClipboard } from '../../utils/clipboard';

interface ExternalPlayerModalProps {
  streamUrl: string;
  official302Url: string;
  onClose: () => void;
  showToast: (text: string) => void;
}

export const ExternalPlayerModal: React.FC<ExternalPlayerModalProps> = ({
  streamUrl,
  official302Url,
  onClose,
  showToast,
}) => {
  const [copyType, setCopyType] = useState<'direct' | 'official' | null>(null);

  const handleCopy = (url: string, type: 'direct' | 'official') => {
    copyToClipboard(url);
    setCopyType(type);
    showToast(type === 'direct' ? '直连链接已复制' : '官方直链已复制');
    setTimeout(() => setCopyType(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2">
            <ExternalLink className="w-4 h-4 text-cyan-400" />
            <h3 className="text-base font-bold text-white">外部播放器</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-semibold">
          <a
            href={`vlc://${streamUrl}`}
            className="p-3 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-orange-500/50 text-orange-300 text-center transition-all block"
          >
            <Tv className="w-4 h-4 mx-auto mb-1 text-orange-400" />
            <span>VLC</span>
          </a>
          <a
            href={`iina://weblink?url=${encodeURIComponent(streamUrl)}`}
            className="p-3 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-blue-500/50 text-blue-300 text-center transition-all block"
          >
            <Film className="w-4 h-4 mx-auto mb-1 text-blue-400" />
            <span>IINA</span>
          </a>
          <a
            href={`infuse://x-callback-url/open?url=${encodeURIComponent(streamUrl)}`}
            className="p-3 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-amber-500/50 text-amber-300 text-center transition-all block"
          >
            <Tv className="w-4 h-4 mx-auto mb-1 text-amber-400" />
            <span>Infuse</span>
          </a>
          <a
            href={`intent:${streamUrl}#Intent;type=video/*;package=com.mxtech.videoplayer.ad;end`}
            className="p-3 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-emerald-500/50 text-emerald-300 text-center transition-all block"
          >
            <Film className="w-4 h-4 mx-auto mb-1 text-emerald-400" />
            <span>MX Player</span>
          </a>
          <a
            href={`nplayer-${streamUrl}`}
            className="p-3 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-cyan-500/50 text-cyan-300 text-center transition-all block"
          >
            <Tv className="w-4 h-4 mx-auto mb-1 text-cyan-400" />
            <span>nPlayer</span>
          </a>
          <a
            href={`vidhub://play?url=${encodeURIComponent(streamUrl)}`}
            className="p-3 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-purple-500/50 text-purple-300 text-center transition-all block"
          >
            <Film className="w-4 h-4 mx-auto mb-1 text-purple-400" />
            <span>VidHub</span>
          </a>
          <a
            href={`potplayer://${streamUrl}`}
            className="col-span-2 sm:col-span-3 p-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-purple-500/50 text-purple-300 text-center transition-all flex items-center justify-center space-x-2"
          >
            <Tv className="w-4 h-4 text-purple-400" />
            <span>PotPlayer (Windows)</span>
          </a>
        </div>

        <div className="pt-2 border-t border-slate-800 space-y-2">
          <div className="flex space-x-2">
            <button
              onClick={() => handleCopy(streamUrl, 'direct')}
              className="flex-1 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 flex items-center justify-center space-x-1.5 transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>{copyType === 'direct' ? '已复制直链' : '复制边缘直链'}</span>
            </button>
            <button
              onClick={() => handleCopy(official302Url, 'official')}
              className="flex-1 py-2 px-3 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-semibold flex items-center justify-center space-x-1.5 transition-colors"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>{copyType === 'official' ? '已复制官方链' : '复制官方直链'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
