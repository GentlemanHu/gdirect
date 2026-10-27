import React, { useState } from 'react';
import {
  Activity,
  Check,
  ChevronDown,
  Globe,
  HardDrive,
  Key,
  Layers,
  PlaySquare,
  Plus,
  Radio,
  Server,
  Settings,
  Tv,
  User,
  Zap,
} from 'lucide-react';
import { SystemStatus } from '../types';

interface HeaderProps {
  status: SystemStatus | null;
  accounts: string[];
  defaultAccount: string | null;
  onSwitchAccount: (account: string) => void;
  onOpenSettings: () => void;
  onOpenRoutes: () => void;
  onOpenSessions: () => void;
  onOpenIntegrations: () => void;
  onOpenLogin: () => void;
  onRefresh: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  status,
  accounts,
  defaultAccount,
  onSwitchAccount,
  onOpenSettings,
  onOpenRoutes,
  onOpenSessions,
  onOpenIntegrations,
  onOpenLogin,
  onRefresh,
}) => {
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState(
    localStorage.getItem('gdirect_api_key') || ''
  );

  const handleSaveApiKey = () => {
    if (apiKeyInput.trim()) {
      localStorage.setItem('gdirect_api_key', apiKeyInput.trim());
    } else {
      localStorage.removeItem('gdirect_api_key');
    }
    setShowKeyModal(false);
    onRefresh();
  };

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Logo & Title */}
          <div className="flex items-center space-x-3">
            <div className="relative flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/20 text-white font-black text-lg">
              <PlaySquare className="w-4 h-4" />
              <span className="absolute -bottom-0.5 -right-0.5 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-lg font-bold tracking-tight text-white">
                gdirect
              </span>
              <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-cyan-950/80 border border-cyan-800/50 text-cyan-300 tracking-wider">
                Gateway
              </span>
            </div>
          </div>

          {/* Quick Status Badges */}
          <div className="hidden md:flex items-center space-x-2 text-xs">
            {/* Direct Google IP Badge */}
            <button
              onClick={onOpenRoutes}
              className="group flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-900/90 border border-slate-800 hover:border-cyan-500/50 transition-all text-slate-300"
              title="点击查看所有扫描直连 IP 与测速"
            >
              <Zap className="w-3.5 h-3.5 text-cyan-400 group-hover:scale-110 transition-transform" />
              <span className="font-mono text-cyan-200">
                {status?.direct_ip || '127.0.0.1'}
              </span>
              {status?.forged_sni && (
                <span className="px-1.5 py-0.2 rounded bg-slate-800 text-[10px] text-amber-300">
                  {status.forged_sni}
                </span>
              )}
            </button>

            {/* Active Streams Badge */}
            <button
              onClick={onOpenSessions}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-900/90 border border-slate-800 hover:border-emerald-500/50 transition-all text-slate-300"
              title="点击查看当前活跃播放流"
            >
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              <span>流会话:</span>
              <span className="font-semibold text-emerald-400">
                {status?.active_streams ?? 0}
              </span>
            </button>

            {/* Account Switcher */}
            <div className="relative">
              <button
                onClick={() => {
                  if (!defaultAccount && accounts.length === 0) {
                    onOpenLogin();
                  } else {
                    setShowAccountDropdown(!showAccountDropdown);
                  }
                }}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border transition-all ${
                  defaultAccount
                    ? 'bg-slate-900/90 border-slate-800 hover:border-slate-700 text-slate-300'
                    : 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20'
                }`}
                title={defaultAccount ? '切换账号' : '点击登录 Google 账号'}
              >
                <User className="w-3.5 h-3.5 text-blue-400" />
                <span className="max-w-[120px] truncate font-medium">
                  {defaultAccount || '点击登录账号'}
                </span>
                <ChevronDown className="w-3 h-3 text-slate-500" />
              </button>

              {showAccountDropdown && (
                <div className="absolute right-0 mt-2 w-56 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl p-1.5 z-50">
                  <div className="text-[10px] font-semibold text-slate-400 px-2 py-1 uppercase tracking-wider">
                    切换 Google 账号
                  </div>
                  {accounts.length === 0 ? (
                    <div className="text-xs text-slate-400 px-2 py-1.5">
                      暂无登录账号，请点击下方导入
                    </div>
                  ) : (
                    accounts.map((acc) => (
                      <button
                        key={acc}
                        onClick={() => {
                          onSwitchAccount(acc);
                          setShowAccountDropdown(false);
                        }}
                        className="w-full text-left flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs hover:bg-slate-800 transition-colors text-slate-200"
                      >
                        <span className="truncate">{acc}</span>
                        {acc === defaultAccount && (
                          <Check className="w-3.5 h-3.5 text-cyan-400 shrink-0 ml-1" />
                        )}
                      </button>
                    ))
                  )}

                  <div className="pt-1 mt-1 border-t border-slate-800">
                    <button
                      onClick={() => {
                        setShowAccountDropdown(false);
                        onOpenLogin();
                      }}
                      className="w-full text-left flex items-center space-x-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-cyan-400 hover:bg-slate-800 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>登录 / 导入新凭据</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Action Icons */}
          <div className="flex items-center space-x-1.5">
            <button
              onClick={onOpenIntegrations}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-blue-600/20 to-cyan-600/20 hover:from-blue-600/30 hover:to-cyan-600/30 border border-cyan-500/30 text-cyan-200 text-xs font-medium transition-all shadow-sm"
              title="Emby .strm 与 OpenList WebDAV 接入中心"
            >
              <Tv className="w-4 h-4 text-cyan-400" />
              <span className="hidden sm:inline">Emby/OpenList 接入</span>
            </button>

            <button
              onClick={() => setShowKeyModal(true)}
              className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
              title="全局鉴权 API Key"
            >
              <Key className="w-4 h-4" />
            </button>

            <button
              onClick={onOpenSettings}
              className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
              title="网关与缓存配置"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* API Key Modal */}
      {showKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md rounded-2xl glass-panel p-6 shadow-2xl border border-slate-800 space-y-4">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                <Key className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">
                  全局鉴权 API Key
                </h3>
                <p className="text-xs text-slate-400">
                  若服务器启动时设置了 GDIRECT_API_KEY，需在此输入以访问
                </p>
              </div>
            </div>

            <input
              type="password"
              placeholder="输入 Master API Key (未设置可留空)"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700/80 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />

            <div className="flex justify-end space-x-2 pt-2">
              <button
                onClick={() => setShowKeyModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSaveApiKey}
                className="px-4 py-2 rounded-xl text-xs font-medium bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold shadow-lg shadow-cyan-500/20 transition-all"
              >
                保存鉴权
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
