import React, { useState, useEffect, useRef } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Globe,
  Key,
  Lock,
  LogIn,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  User,
  X,
  Zap,
} from 'lucide-react';
import {
  fetchOAuthStatus,
  startOAuthLogin,
  exchangeOAuthCode,
  importAuth,
  OAuthStatusResponse,
} from '../api';

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
  const [activeTab, setActiveTab] = useState<'oauth' | 'manual'>('oauth');
  const [oauthStatus, setOauthStatus] = useState<OAuthStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  // Direct OAuth State
  const [clientIdInput, setClientIdInput] = useState('');
  const [clientSecretInput, setClientSecretInput] = useState('');
  const [isWaitingAuth, setIsWaitingAuth] = useState(false);
  const [lastState, setLastState] = useState<string | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [callbackInput, setCallbackInput] = useState('');
  const [showCrossDeviceHelper, setShowCrossDeviceHelper] = useState(false);

  // Manual JSON State
  const [jsonInput, setJsonInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Load OAuth client availability on mount
  useEffect(() => {
    let active = true;
    setStatusLoading(true);
    fetchOAuthStatus()
      .then((st) => {
        if (!active) return;
        setOauthStatus(st);
        if (st.client_id) {
          setClientIdInput(st.client_id);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setStatusLoading(false);
      });

    return () => {
      active = false;
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  // Poll for account authorization status when waiting for browser login
  useEffect(() => {
    if (!isWaitingAuth) {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      return;
    }

    const checkStatus = async () => {
      try {
        const st = await fetchOAuthStatus();
        if (st.current_account && st.current_account !== currentAccount) {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          setIsWaitingAuth(false);
          setSuccessMsg(`授权成功！已绑定 Google 账号: ${st.current_account}`);
          setTimeout(() => {
            onSuccess();
            onClose();
          }, 1200);
        }
      } catch {}
    };

    pollTimerRef.current = setInterval(checkStatus, 2000);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [isWaitingAuth, currentAccount, onSuccess, onClose]);

  // Start Direct Google OAuth
  const handleStartOAuth = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      // Determine appropriate redirect URI
      // Google Desktop OAuth allows http://127.0.0.1:<port>/callback and http://localhost:<port>/callback
      const isLoopback =
        window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const redirectUri = isLoopback
        ? `${window.location.origin}/callback`
        : `http://127.0.0.1:${window.location.port || '8080'}/callback`;

      const params: any = { redirect_uri: redirectUri };
      if (clientIdInput.trim() && clientSecretInput.trim()) {
        params.client_id = clientIdInput.trim();
        params.client_secret = clientSecretInput.trim();
      }

      const res = await startOAuthLogin(params);
      setLastState(res.state);
      setAuthUrl(res.auth_url);
      setIsWaitingAuth(true);

      // Open Google sign-in page in a new window/tab
      window.open(res.auth_url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      setErrorMsg(e.message || '发起 Google 登录失败，请检查客户端配置');
    } finally {
      setLoading(false);
    }
  };

  // Handle cross-device or manual callback code exchange
  const handleExchangeCode = async () => {
    if (!callbackInput.trim()) {
      setErrorMsg('请粘贴授权回调完整 URL 或 Code');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await exchangeOAuthCode(callbackInput.trim(), lastState || undefined);
      setIsWaitingAuth(false);
      setSuccessMsg(res.message || `成功授权账号: ${res.account}`);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1200);
    } catch (e: any) {
      setErrorMsg(e.message || '换取令牌失败，请确认链接或 Code 是否正确');
    } finally {
      setLoading(false);
    }
  };

  // Handle manual JSON import
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
            <div>
              <h2 className="text-base font-bold text-white">Google 账号授权</h2>
              <p className="text-[11px] text-slate-400">一键直连官方授权或导入凭据</p>
            </div>
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
              <span className="font-semibold text-cyan-300 font-mono truncate max-w-[200px] sm:max-w-xs">
                {currentAccount}
              </span>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-950/80 border border-emerald-800/40 text-emerald-300">
              已授权
            </span>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-slate-800 text-xs">
          <button
            onClick={() => {
              setActiveTab('oauth');
              setErrorMsg(null);
            }}
            className={`flex-1 pb-2.5 font-semibold transition-colors flex items-center justify-center space-x-1.5 border-b-2 ${
              activeTab === 'oauth'
                ? 'border-cyan-400 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Google 官方直接授权</span>
          </button>
          <button
            onClick={() => {
              setActiveTab('manual');
              setErrorMsg(null);
            }}
            className={`flex-1 pb-2.5 font-semibold transition-colors flex items-center justify-center space-x-1.5 border-b-2 ${
              activeTab === 'manual'
                ? 'border-cyan-400 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Key className="w-3.5 h-3.5" />
            <span>手动导入凭据 JSON</span>
          </button>
        </div>

        {/* Tab 1: Direct Google OAuth Flow */}
        {activeTab === 'oauth' && (
          <div className="space-y-4 text-xs">
            {statusLoading ? (
              <div className="py-8 flex flex-col items-center justify-center space-y-2 text-slate-400">
                <RefreshCw className="w-5 h-5 animate-spin text-cyan-400" />
                <span>检查 OAuth 客户端状态...</span>
              </div>
            ) : oauthStatus?.has_client ? (
              /* Ready for 1-Click Login */
              <div className="space-y-3.5">
                <div className="p-3.5 rounded-xl bg-cyan-950/20 border border-cyan-500/30 space-y-1.5">
                  <div className="flex items-center space-x-2 text-cyan-300 font-semibold">
                    <ShieldCheck className="w-4 h-4 text-cyan-400" />
                    <span>OAuth 客户端已就绪</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed font-mono truncate">
                    客户端 ID: {oauthStatus.client_id}
                  </p>
                </div>

                {!isWaitingAuth ? (
                  <div className="space-y-2.5">
                    <button
                      onClick={handleStartOAuth}
                      disabled={loading}
                      className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 disabled:opacity-50 text-slate-950 font-bold text-sm shadow-xl shadow-cyan-500/20 transition-all flex items-center justify-center space-x-2 active:scale-[0.98]"
                    >
                      <LogIn className="w-4 h-4" />
                      <span>{loading ? '生成登录链接中...' : '🚀 立即跳转 Google 登录授权'}</span>
                    </button>
                    <p className="text-[11px] text-slate-400 text-center leading-relaxed">
                      点击后将打开 Google 官方授权页，选择账号并点击「允许」即可完成登录。
                    </p>
                  </div>
                ) : (
                  /* Waiting for OAuth flow completion */
                  <div className="p-4 rounded-xl bg-slate-900 border border-cyan-500/40 space-y-3.5 text-center">
                    <div className="flex items-center justify-center space-x-2 text-cyan-300 font-semibold">
                      <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
                      <span>等待 Google 授权中...</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      若未自动弹出 Google 授权页面，请点击下方链接直接打开：
                    </p>
                    {authUrl && (
                      <a
                        href={authUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 font-mono text-xs border border-slate-700"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>打开 Google 授权页面</span>
                      </a>
                    )}

                    {/* Cross-device / Manual code helper */}
                    <div className="pt-2 border-t border-slate-800 text-left">
                      <button
                        onClick={() => setShowCrossDeviceHelper(!showCrossDeviceHelper)}
                        className="text-slate-400 hover:text-cyan-300 transition-colors text-[11px] flex items-center space-x-1 w-full justify-between"
                      >
                        <span>📱 跨设备或手机访问未自动跳转？点击展开手动完成</span>
                        <ChevronDown
                          className={`w-3.5 h-3.5 transition-transform ${
                            showCrossDeviceHelper ? 'rotate-180' : ''
                          }`}
                        />
                      </button>

                      {showCrossDeviceHelper && (
                        <div className="space-y-2 mt-2 pt-2 border-t border-slate-800/60 animate-fade-in">
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            在手机或外部设备授权后，如果 Google 重定向显示无法打开，请复制浏览器地址栏里的完整链接或 <code className="text-cyan-300">code=</code> 后的字符粘贴到下方：
                          </p>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={callbackInput}
                              onChange={(e) => setCallbackInput(e.target.value)}
                              placeholder="http://127.0.0.1:8090/callback?code=4/0A..."
                              className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 font-mono text-[11px] text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                            />
                            <button
                              onClick={handleExchangeCode}
                              disabled={loading || !callbackInput.trim()}
                              className="px-3 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs disabled:opacity-50 transition-colors"
                            >
                              完成
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Need Client ID & Secret */
              <div className="space-y-3">
                <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1">
                  <span className="font-semibold text-slate-200">首次配置 Google OAuth 客户端</span>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    输入在 Google Cloud Console 创建的客户端信息，或在下方直接粘贴 <code className="text-cyan-300">client_secret.json</code>。
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="space-y-1">
                    <label className="text-slate-400 font-medium">Client ID</label>
                    <input
                      type="text"
                      value={clientIdInput}
                      onChange={(e) => setClientIdInput(e.target.value)}
                      placeholder="xxxx.apps.googleusercontent.com"
                      className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700/80 font-mono text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-400 font-medium">Client Secret</label>
                    <input
                      type="password"
                      value={clientSecretInput}
                      onChange={(e) => setClientSecretInput(e.target.value)}
                      placeholder="GOCSPX-xxxx"
                      className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700/80 font-mono text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>

                <button
                  onClick={handleStartOAuth}
                  disabled={loading || !clientIdInput.trim() || !clientSecretInput.trim()}
                  className="w-full py-2.5 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold text-xs shadow-lg shadow-cyan-500/20 transition-all flex items-center justify-center space-x-1.5"
                >
                  <LogIn className="w-4 h-4" />
                  <span>保存并跳转 Google 授权</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Manual JSON Import */}
        {activeTab === 'manual' && (
          <div className="space-y-3 text-xs">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="font-medium text-slate-300">
                  粘贴 authorized_user / client_secret / service_account JSON
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
                placeholder={`粘贴 authorized_user JSON、client_secret.json 或 Service Account JSON 内容：\n${sampleJson}`}
                className="w-full p-3 rounded-xl bg-slate-900 border border-slate-700/80 font-mono text-[11px] text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition-colors leading-relaxed"
              />
            </div>

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
        )}

        {/* Feedback Messages */}
        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-800/40 text-rose-300 text-xs flex items-center space-x-2 animate-fade-in">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="break-all">{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="p-3 rounded-xl bg-emerald-950/80 border border-emerald-800/40 text-emerald-300 text-xs flex items-center space-x-2 animate-fade-in">
            <Check className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}
      </div>
    </div>
  );
};
