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
      <div className="w-full max-w-lg rounded-2xl glass-panel p-5 sm:p-6 shadow-2xl border border-slate-800 space-y-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <User className="w-4 h-4" />
            </div>
            <h2 className="text-base font-bold text-white">Google 账号授权</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Current Account Card */}
        {currentAccount && (
          <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between">
            <div className="flex items-center space-x-2 text-xs">
              <span className="text-slate-400">已登录账号:</span>
              <span className="font-semibold text-cyan-300 font-mono">{currentAccount}</span>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-950/80 border border-emerald-800/40 text-emerald-300">
              已授权
            </span>
          </div>
        )}

        <div className="space-y-3 text-xs">
          {/* Input Form */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-medium text-slate-300">
                导入凭据 JSON
              </label>
              <button
                onClick={() => setJsonInput(sampleJson)}
                className="text-cyan-400 hover:text-cyan-300 transition-colors text-[11px]"
              >
                填入示例
              </button>
            </div>

            <textarea
              rows={8}
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              placeholder={`粘贴 authorized_user JSON 或 client_secret.json 内容：\n${sampleJson}`}
              className="w-full p-3 rounded-xl bg-slate-900 border border-slate-700/80 font-mono text-[11px] text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition-colors leading-relaxed"
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

          <div className="pt-1 flex justify-end">
            <button
              onClick={handleImport}
              disabled={loading}
              className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-semibold text-xs shadow-lg shadow-cyan-500/20 transition-all"
            >
              <LogIn className="w-4 h-4" />
              <span>{loading ? '验证中...' : '导入凭据'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
