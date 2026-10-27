import React, { useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  HelpCircle,
  Info,
  Key,
  Lock,
  LogIn,
  ShieldCheck,
  User,
  X,
  Zap,
} from 'lucide-react';
import { importAuth } from '../api';

interface LoginModalProps {
  currentAccount: string | null;
  onSuccess: () => void;
  onClose: () => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  currentAccount,
  onSuccess,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'import' | 'guide'>('import');
  const [jsonInput, setJsonInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleImport = async () => {
    if (!jsonInput.trim()) {
      setErrorMsg('请粘贴授权凭据 JSON 内容');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await importAuth(jsonInput.trim());
      setSuccessMsg(res.message || `成功绑定账号: ${res.account}`);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } catch (e: any) {
      setErrorMsg(e.message || '导入失败，请检查凭据格式');
    } finally {
      setLoading(false);
    }
  };

  const sampleJson = `{
  "type": "authorized_user",
  "client_id": "xxxx.apps.googleusercontent.com",
  "client_secret": "GOCSPX-xxxx",
  "refresh_token": "1//xxxx"
}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/85 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-2xl rounded-2xl glass-panel p-6 shadow-2xl border border-slate-800 space-y-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Google 账号授权与登录向导</h2>
              <p className="text-xs text-slate-400">
                支持凭据 JSON 一键导入 · 国内环境免境外代理运行
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current Account Card */}
        {currentAccount && (
          <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between">
            <div className="flex items-center space-x-2 text-xs">
              <span className="text-slate-400">当前活跃登录账号:</span>
              <span className="font-semibold text-cyan-300 font-mono">{currentAccount}</span>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-950/80 border border-emerald-800/40 text-emerald-300">
              已授权
            </span>
          </div>
        )}

        {/* Tab Switcher */}
        <div className="flex space-x-2 bg-slate-900/90 p-1 rounded-xl border border-slate-800 text-xs font-medium">
          <button
            onClick={() => setActiveTab('import')}
            className={`flex-1 py-2 px-3 rounded-lg transition-all flex items-center justify-center space-x-1.5 ${
              activeTab === 'import'
                ? 'bg-cyan-500 text-slate-950 font-semibold shadow-md shadow-cyan-500/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Key className="w-3.5 h-3.5" />
            <span>凭据 JSON 一键导入 (推荐)</span>
          </button>
          <button
            onClick={() => setActiveTab('guide')}
            className={`flex-1 py-2 px-3 rounded-lg transition-all flex items-center justify-center space-x-1.5 ${
              activeTab === 'guide'
                ? 'bg-cyan-500 text-slate-950 font-semibold shadow-md shadow-cyan-500/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>常见问题与代理原理解答</span>
          </button>
        </div>

        {activeTab === 'import' ? (
          <div className="space-y-4 text-xs">
            {/* Principles Box */}
            <div className="p-3.5 rounded-xl bg-cyan-950/20 border border-cyan-800/40 text-slate-300 space-y-1.5">
              <div className="flex items-center space-x-1.5 text-cyan-300 font-semibold">
                <ShieldCheck className="w-4 h-4" />
                <span>极简登录说明：这台直连机器需要代理吗？需要专门找服务器吗？</span>
              </div>
              <p className="leading-relaxed text-slate-400">
                <strong>完全不需要境外服务器！</strong> 因为你电脑（Mac）有代理，只需在 Mac 上完成一次登录或获取凭据，把生成的授权 JSON 粘贴到下方即可。
                Termux 设备在拥有该凭据后，将通过 <strong>Google 国内直连 IP</strong> 传输所有 5TB 视频数据，<strong>完全物理直连，不走翻墙代理，跑满本地带宽！</strong>
              </p>
            </div>

            {/* Input Form */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-slate-200">
                  粘贴 authorized_user 凭据 JSON / client_secret.json 内容
                </label>
                <button
                  onClick={() => setJsonInput(sampleJson)}
                  className="text-cyan-400 hover:text-cyan-300 transition-colors"
                >
                  填入示例格式
                </button>
              </div>

              <textarea
                rows={6}
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
                placeholder={`粘贴由 gdirect 生成的 authorized_user JSON 或从 Google 下载的 client_secret.json 内容：\n${sampleJson}`}
                className="w-full p-3 rounded-xl bg-slate-900 border border-slate-700/80 font-mono text-[11px] text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition-colors"
              />
            </div>

            {errorMsg && (
              <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-800/40 text-rose-300 flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {successMsg && (
              <div className="p-3 rounded-xl bg-emerald-950/80 border border-emerald-800/40 text-emerald-300 flex items-center space-x-2">
                <Check className="w-4 h-4 shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            <div className="pt-2 flex justify-end">
              <button
                onClick={handleImport}
                disabled={loading}
                className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-semibold text-xs shadow-lg shadow-cyan-500/20 transition-all"
              >
                <LogIn className="w-4 h-4" />
                <span>{loading ? '正在验证授权...' : '立即导入并登录'}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 text-xs text-slate-300">
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
              <h4 className="font-semibold text-white">Q1: 为什么提示没有登录？</h4>
              <p className="text-slate-400 leading-relaxed">
                Google 云端硬盘读取私人大文件和影视目录需要 OAuth 2.0 用户授权。未登录状态下，网关只能下载完全公开且无需认证的分享文件。
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
              <h4 className="font-semibold text-white">Q2: 如何在电脑上 1 分钟完成授权？</h4>
              <ol className="list-decimal list-inside space-y-1 text-slate-400 leading-relaxed">
                <li>在 Google Cloud 控制台创建一个“桌面应用 (Desktop app)”OAuth 客户端。</li>
                <li>下载 <code className="text-cyan-300">client_secret.json</code> 到你的电脑。</li>
                <li>在有代理的 Mac 终端运行：<br />
                  <code className="text-cyan-300 bg-slate-950 px-2 py-0.5 rounded">./gdirect login --client-secret client_secret.json</code>
                </li>
                <li>浏览器弹出授权窗口，登录你的 Google 账号点击“继续”。</li>
                <li>登录成功后，凭据已保存在本地，直接复制其内容粘贴到本界面的“一键导入”即可！</li>
              </ol>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
              <h4 className="font-semibold text-white">Q3: 登录后放视频还需要翻墙代理吗？</h4>
              <p className="text-slate-400 leading-relaxed">
                <strong>完全不需要！</strong> 影视推流、快进、分块下载（数据面）全部经由 Google 官方未封锁的 CDN/边缘 IP 直连（如 142.250.x.x），物理直通 Google 数据中心，不经过任何代理服务器，完全保障隐私与千兆带宽！
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
