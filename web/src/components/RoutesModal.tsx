import React, { useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Check,
  Globe,
  RefreshCw,
  RotateCw,
  Search,
  Server,
  ShieldCheck,
  X,
  Zap,
} from 'lucide-react';
import { RouteEndpoint } from '../types';

interface RoutesModalProps {
  currentIp: string | null;
  currentSni: string | null;
  endpoints: RouteEndpoint[];
  onTriggerScan: () => void;
  onSwitchRoute: (ip: string, sni: string | null) => Promise<void>;
  onRefresh: () => void;
  onClose: () => void;
}

export const RoutesModal: React.FC<RoutesModalProps> = ({
  currentIp,
  currentSni,
  endpoints,
  onTriggerScan,
  onSwitchRoute,
  onRefresh,
  onClose,
}) => {
  const [scanning, setScanning] = useState(false);
  const [switchingIp, setSwitchingIp] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [customIp, setCustomIp] = useState('');
  const [customSni, setCustomSni] = useState('g.cn');
  const [switchFeedback, setSwitchFeedback] = useState<string | null>(null);

  const handleScan = () => {
    setScanning(true);
    onTriggerScan();
    setTimeout(() => {
      setScanning(false);
      onRefresh();
    }, 4000);
  };

  const handleSwitch = async (ip: string, sni: string | null) => {
    setSwitchingIp(ip);
    setSwitchFeedback(null);
    try {
      await onSwitchRoute(ip, sni);
      setSwitchFeedback(`已成功切换通信节点至 ${ip}！`);
      setTimeout(() => setSwitchFeedback(null), 3000);
    } catch (e: any) {
      alert(`切换失败: ${e.message}`);
    } finally {
      setSwitchingIp(null);
    }
  };

  const handleManualSwitch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customIp.trim()) return;
    await handleSwitch(customIp.trim(), customSni.trim() ? customSni.trim() : null);
    setCustomIp('');
  };

  const filtered = endpoints.filter((e) =>
    e.ip.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/85 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-3xl rounded-2xl glass-panel p-6 shadow-2xl border border-slate-800 space-y-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">直连节点矩阵</h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current Active Route Card */}
        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
              当前活跃通信节点
            </span>
            <div className="flex items-center space-x-2">
              <span className="text-xl font-bold font-mono text-cyan-200">
                {currentIp || '127.0.0.1'}
              </span>
              <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 text-xs font-mono">
                SNI: {currentSni || '原生 (real)'}
              </span>
            </div>
            {switchFeedback && (
              <p className="text-xs text-emerald-400 font-semibold animate-fade-in">
                ✓ {switchFeedback}
              </p>
            )}
          </div>

          <div className="shrink-0 flex items-center space-x-2">
            <button
              onClick={handleScan}
              disabled={scanning}
              className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-semibold text-xs shadow-lg shadow-cyan-500/20 transition-all"
            >
              <RotateCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
              <span>{scanning ? '正在探测连通性...' : '一键扫描优选 IP'}</span>
            </button>
          </div>
        </div>

        {/* Manual Custom IP Switch Form */}
        <form onSubmit={handleManualSwitch} className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col sm:flex-row items-center gap-3 text-xs">
          <div className="flex-1 w-full">
            <input
              type="text"
              placeholder="手动指定 Google IP (如 142.250.11.138)"
              value={customIp}
              onChange={(e) => setCustomIp(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700/80 text-slate-100 font-mono placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <div className="w-full sm:w-36">
            <select
              value={customSni}
              onChange={(e) => setCustomSni(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700/80 text-slate-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="g.cn">SNI: g.cn (伪装)</option>
              <option value="">SNI: 原生 (real)</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={!customIp.trim() || switchingIp !== null}
            className="w-full sm:w-auto px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-cyan-500 hover:text-slate-950 text-slate-200 font-semibold border border-slate-700 hover:border-cyan-500 transition-all shrink-0"
          >
            直接切换
          </button>
        </form>

        {/* Endpoints Table */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              已保存的 Google 节点库 ({endpoints.length}) · 点击行或按钮立即切换
            </h3>
            <div className="relative w-48">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="搜索 IP..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-800/80 overflow-hidden bg-slate-900/40">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-900 text-slate-400 text-[11px] uppercase tracking-wider border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-4">节点 IP</th>
                  <th className="py-2.5 px-4">延迟</th>
                  <th className="py-2.5 px-4">工作 SNI</th>
                  <th className="py-2.5 px-4">状态</th>
                  <th className="py-2.5 px-4 text-right">切换操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40 font-mono">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500 font-sans">
                      暂无已记录的 IP，点击上方“一键扫描优选 IP”自动探测
                    </td>
                  </tr>
                ) : (
                  filtered.map((ep) => {
                    const isCurrent = ep.ip === currentIp;
                    const isOk = ep.latency_ms !== null;
                    const isSwitching = switchingIp === ep.ip;

                    return (
                      <tr
                        key={ep.ip}
                        onClick={() => {
                          if (!isCurrent) handleSwitch(ep.ip, ep.sni || null);
                        }}
                        className={`transition-colors cursor-pointer ${
                          isCurrent
                            ? 'bg-cyan-950/30'
                            : 'hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="py-2.5 px-4 font-semibold text-slate-200 flex items-center space-x-2">
                          {isCurrent ? (
                            <span className="flex h-2.5 w-2.5 rounded-full bg-cyan-400 animate-pulse"></span>
                          ) : (
                            <span className="h-2 w-2 rounded-full bg-slate-700"></span>
                          )}
                          <span>{ep.ip}</span>
                        </td>
                        <td className="py-2.5 px-4">
                          {ep.latency_ms !== null ? (
                            <span
                              className={`font-bold ${
                                ep.latency_ms < 100
                                  ? 'text-emerald-400'
                                  : ep.latency_ms < 250
                                  ? 'text-cyan-400'
                                  : ep.latency_ms < 2500
                                  ? 'text-amber-400'
                                  : 'text-rose-400'
                              }`}
                            >
                              {ep.latency_ms} ms
                            </span>
                          ) : (
                            <span className="text-slate-600">-</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-slate-400">
                          {ep.sni || '原生 (real)'}
                        </td>
                        <td className="py-2.5 px-4">
                          {isOk ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-sans font-semibold bg-emerald-950/80 border border-emerald-800/40 text-emerald-300">
                              可用
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-sans font-semibold bg-rose-950/80 border border-rose-800/40 text-rose-400" title={ep.error || ''}>
                              超时/离线
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          {isCurrent ? (
                            <span className="px-2.5 py-1 rounded-md text-[11px] font-sans font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 inline-flex items-center space-x-1">
                              <Check className="w-3 h-3 text-cyan-400" />
                              <span>当前使用</span>
                            </span>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSwitch(ep.ip, ep.sni || null);
                              }}
                              disabled={isSwitching}
                              className="px-3 py-1 rounded-lg bg-cyan-500/10 hover:bg-cyan-500 hover:text-slate-950 text-cyan-300 font-sans font-semibold text-xs border border-cyan-500/30 transition-all inline-flex items-center space-x-1"
                            >
                              {isSwitching ? (
                                <>
                                  <RotateCw className="w-3 h-3 animate-spin" />
                                  <span>切换中</span>
                                </>
                              ) : (
                                <>
                                  <Zap className="w-3 h-3" />
                                  <span>切换节点</span>
                                </>
                              )}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
