import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Activity,
  AlertCircle,
  Film,
  HardDrive,
  LayoutDashboard,
  Layers,
  Radio,
  RefreshCw,
  Server,
  Settings,
  Tv,
  Zap,
} from 'lucide-react';

import {
  DriveFile,
  RouteEndpoint,
  RoutesResponse,
  StreamConfig,
  StreamSession,
  SystemStatus,
} from './types';
import {
  fetchAccounts,
  fetchConfig,
  fetchDriveFiles,
  fetchDriveFile,
  fetchRoutes,
  fetchSessions,
  fetchStatus,
  switchAccount,
  switchRoute,
  terminateSession,
  triggerScan,
  updateConfig,
} from './api';

import { Header } from './components/Header';
import { Dashboard } from './components/Dashboard';
import { Explorer } from './components/Explorer';
import { FilePreviewModal } from './components/FilePreviewModal';
import { IntegrationsModal } from './components/IntegrationsModal';
import { RoutesModal } from './components/RoutesModal';
import { SessionsModal } from './components/SessionsModal';
import { SettingsModal } from './components/SettingsModal';
import { LoginModal } from './components/LoginModal';

export const App: React.FC = () => {
  // Navigation & View
  const [activeTab, setActiveTab] = useState<'dashboard' | 'explorer'>('dashboard');

  // Core Data
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [defaultAccount, setDefaultAccount] = useState<string | null>(null);
  const [sessions, setSessions] = useState<StreamSession[]>([]);
  const [routes, setRoutes] = useState<RoutesResponse | null>(null);
  const [config, setConfig] = useState<StreamConfig | null>(null);

  // Explorer State
  const [currentFolder, setCurrentFolder] = useState<string>('root');
  const [folderHistory, setFolderHistory] = useState<{ id: string; name: string }[]>([
    { id: 'root', name: 'root' },
  ]);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);

  // Modals
  const [activePlayerFile, setActivePlayerFile] = useState<DriveFile | null>(null);
  const [showIntegrations, setShowIntegrations] = useState(false);
  const [showRoutes, setShowRoutes] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showLogin, setShowLogin] = useState(false);

  // Initial Load & Refresh
  const loadStatusAndSessions = useCallback(async () => {
    try {
      const [st, sess] = await Promise.all([fetchStatus(), fetchSessions()]);
      setStatus(st);
      setSessions(sess);
    } catch (e) {
      console.warn('Status poll error:', e);
    }
  }, []);

  const loadAccounts = useCallback(async () => {
    try {
      const data = await fetchAccounts();
      setAccounts(data.accounts);
      setDefaultAccount(data.default);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadRoutes = useCallback(async () => {
    try {
      const r = await fetchRoutes();
      setRoutes(r);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const c = await fetchConfig();
      setConfig(c);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadFiles = useCallback(async (folderId: string) => {
    setFilesLoading(true);
    try {
      const list = await fetchDriveFiles(folderId);
      setFiles(list);
    } catch (e) {
      console.error(e);
    } finally {
      setFilesLoading(false);
    }
  }, []);

  // Poll status & sessions every 5s
  useEffect(() => {
    loadStatusAndSessions();
    loadAccounts();
    loadConfig();

    const timer = setInterval(() => {
      loadStatusAndSessions();
    }, 5000);
    return () => clearInterval(timer);
  }, [loadStatusAndSessions, loadAccounts, loadConfig]);

  // --- Hash Routing & History Stack Management ---
  const isNavigatingInternallyRef = useRef(false);

  const syncRouteFromHash = useCallback(async () => {
    const rawHash = window.location.hash.replace(/^#\/?/, '').trim();

    // 1. Dashboard Root: "" or "dashboard"
    if (!rawHash || rawHash === 'dashboard') {
      setActiveTab('dashboard');
      setShowSettings(false);
      setShowRoutes(false);
      setShowSessions(false);
      setShowIntegrations(false);
      setShowLogin(false);
      setActivePlayerFile(null);
      return;
    }

    // 2. Modals (Overlays)
    if (rawHash === 'settings') {
      setShowSettings(true);
      setShowRoutes(false);
      setShowSessions(false);
      setShowIntegrations(false);
      setShowLogin(false);
      return;
    }

    if (rawHash === 'routes') {
      setShowRoutes(true);
      setShowSettings(false);
      setShowSessions(false);
      setShowIntegrations(false);
      setShowLogin(false);
      loadRoutes();
      return;
    }

    if (rawHash === 'sessions') {
      setShowSessions(true);
      setShowSettings(false);
      setShowRoutes(false);
      setShowIntegrations(false);
      setShowLogin(false);
      loadStatusAndSessions();
      return;
    }

    if (rawHash === 'integrations') {
      setShowIntegrations(true);
      setShowSettings(false);
      setShowRoutes(false);
      setShowSessions(false);
      setShowLogin(false);
      return;
    }

    if (rawHash === 'login') {
      setShowLogin(true);
      setShowSettings(false);
      setShowRoutes(false);
      setShowSessions(false);
      setShowIntegrations(false);
      return;
    }

    // 3. Video / Media Player Direct Route: play/:id or preview/:id
    if (rawHash.startsWith('play/') || rawHash.startsWith('preview/')) {
      const parts = rawHash.split('/');
      const fileId = decodeURIComponent(parts[1] || '').split('?')[0];
      if (fileId) {
        setShowSettings(false);
        setShowRoutes(false);
        setShowSessions(false);
        setShowIntegrations(false);
        setShowLogin(false);

        // Find file in cache or fetch metadata directly
        const existing = files.find((f) => f.id === fileId);
        if (existing) {
          setActivePlayerFile(existing);
        } else {
          try {
            const fetched = await fetchDriveFile(fileId);
            setActivePlayerFile(fetched);
          } catch (err) {
            console.warn('Failed to load file metadata for route:', err);
          }
        }
      }
      return;
    }

    // 4. Explorer Root: "explorer"
    if (rawHash === 'explorer') {
      setActiveTab('explorer');
      setShowSettings(false);
      setShowRoutes(false);
      setShowSessions(false);
      setShowIntegrations(false);
      setShowLogin(false);
      setActivePlayerFile(null);

      if (currentFolder !== 'root') {
        setCurrentFolder('root');
        setFolderHistory([{ id: 'root', name: 'root' }]);
        loadFiles('root');
      }
      return;
    }

    // 5. Explorer Specific Folder: folder/:id?name=:name
    if (rawHash.startsWith('folder/')) {
      setActiveTab('explorer');
      setShowSettings(false);
      setShowRoutes(false);
      setShowSessions(false);
      setShowIntegrations(false);
      setShowLogin(false);
      setActivePlayerFile(null);

      const afterFolder = rawHash.substring('folder/'.length);
      const [folderPath, queryString] = afterFolder.split('?');
      const folderId = decodeURIComponent(folderPath);
      const params = new URLSearchParams(queryString || '');
      const folderName = params.get('name') || folderId;

      if (currentFolder !== folderId) {
        setCurrentFolder(folderId);
        setFolderHistory((prev) => {
          const existingIdx = prev.findIndex((item) => item.id === folderId);
          if (existingIdx >= 0) {
            return prev.slice(0, existingIdx + 1);
          }
          return [...prev, { id: folderId, name: folderName }];
        });
        loadFiles(folderId);
      }
    }
  }, [currentFolder, files, loadFiles, loadRoutes, loadStatusAndSessions]);

  // Initial sync on boot & listen to popstate/hashchange
  useEffect(() => {
    syncRouteFromHash();
    const handleHashChange = () => {
      syncRouteFromHash();
    };

    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('popstate', handleHashChange);
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
      window.removeEventListener('popstate', handleHashChange);
    };
  }, [syncRouteFromHash]);

  // Ensure root files are loaded on startup if starting at root
  useEffect(() => {
    const raw = window.location.hash.replace(/^#\/?/, '').trim();
    if (!raw || raw === 'dashboard' || raw === 'explorer') {
      loadFiles('root');
    }
  }, [loadFiles]);

  // Navigation Trigger: Push or Replace state
  const navigateTo = useCallback((targetPath: string, replace = false) => {
    const clean = targetPath.startsWith('/') ? targetPath : `/${targetPath}`;
    const targetHash = `#${clean}`;
    if (window.location.hash === targetHash) return;

    if (replace) {
      window.history.replaceState(null, '', targetHash);
      syncRouteFromHash();
    } else {
      window.location.hash = targetHash;
    }
  }, [syncRouteFromHash]);

  // Close modal via back stack
  const closeCurrentModal = useCallback(() => {
    const raw = window.location.hash.replace(/^#\/?/, '').trim();
    if (
      raw.startsWith('play/') ||
      raw.startsWith('preview/') ||
      raw === 'settings' ||
      raw === 'routes' ||
      raw === 'sessions' ||
      raw === 'integrations' ||
      raw === 'login'
    ) {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        navigateTo(activeTab === 'explorer' ? '/explorer' : '/');
      }
    } else {
      setActivePlayerFile(null);
      setShowSettings(false);
      setShowRoutes(false);
      setShowSessions(false);
      setShowIntegrations(false);
      setShowLogin(false);
    }
  }, [activeTab, navigateTo]);

  // Folder navigation handler
  const handleNavigateFolder = (id: string, name: string) => {
    navigateTo(`/folder/${encodeURIComponent(id)}?name=${encodeURIComponent(name)}`);
  };

  // Breadcrumb navigation handler
  const handleNavigateBreadcrumb = (index: number) => {
    const item = folderHistory[index];
    if (item.id === 'root') {
      navigateTo('/explorer');
    } else {
      navigateTo(`/folder/${encodeURIComponent(item.id)}?name=${encodeURIComponent(item.name)}`);
    }
  };

  const handleSwitchAccount = async (account: string) => {
    try {
      await switchAccount(account);
      setDefaultAccount(account);
      loadStatusAndSessions();
      loadFiles(currentFolder);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSwitchRoute = async (ip: string, sni: string | null) => {
    await switchRoute(ip, sni);
    await Promise.all([loadRoutes(), loadStatusAndSessions()]);
  };

  const handleTerminateSession = async (id: string) => {
    try {
      await terminateSession(id);
      loadStatusAndSessions();
    } catch (e) {
      console.error(e);
    }
  };

  const handleUpdateConfig = async (newConfig: StreamConfig) => {
    const res = await updateConfig(newConfig);
    setConfig(res);
    loadStatusAndSessions();
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      {/* Header */}
      <Header
        status={status}
        accounts={accounts}
        defaultAccount={defaultAccount}
        onSwitchAccount={handleSwitchAccount}
        onOpenSettings={() => navigateTo('/settings')}
        onOpenRoutes={() => navigateTo('/routes')}
        onOpenSessions={() => navigateTo('/sessions')}
        onOpenIntegrations={() => navigateTo('/integrations')}
        onOpenLogin={() => navigateTo('/login')}
        onRefresh={() => {
          loadStatusAndSessions();
          loadAccounts();
          loadFiles(currentFolder);
        }}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Navigation Tabs (Dashboard vs Explorer) */}
        <div className="flex items-center space-x-2 border-b border-slate-800/80 pb-3">
          <button
            onClick={() => navigateTo('/')}
            className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'dashboard'
                ? 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            <span>网关仪表盘</span>
          </button>

          <button
            onClick={() => navigateTo(currentFolder === 'root' ? '/explorer' : `/folder/${encodeURIComponent(currentFolder)}`)}
            className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'explorer'
                ? 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Film className="w-4 h-4" />
            <span>云端影视媒体库</span>
            {files.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-slate-800 text-[10px] text-slate-400">
                {files.length}
              </span>
            )}
          </button>
        </div>

        {/* View Switch */}
        {activeTab === 'dashboard' ? (
          <div className="space-y-8">
            <Dashboard
              status={status}
              sessions={sessions}
              onOpenExplorer={() => navigateTo('/explorer')}
              onOpenIntegrations={() => navigateTo('/integrations')}
              onOpenRoutes={() => navigateTo('/routes')}
              onOpenSessions={() => navigateTo('/sessions')}
              onOpenLogin={() => navigateTo('/login')}
              onOpenSettings={() => navigateTo('/settings')}
              onRefresh={loadStatusAndSessions}
            />

            {/* Quick Media Section on Dashboard */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-white">媒体库</h3>
                <button
                  onClick={() => navigateTo('/explorer')}
                  className="text-xs text-cyan-400 hover:text-cyan-300 font-semibold"
                >
                  查看全部 &rarr;
                </button>
              </div>

              <Explorer
                files={files}
                loading={filesLoading}
                currentFolder={currentFolder}
                folderHistory={folderHistory}
                onNavigateFolder={handleNavigateFolder}
                onNavigateBreadcrumb={handleNavigateBreadcrumb}
                onPlayFile={(f) => navigateTo(`/play/${encodeURIComponent(f.id)}`)}
                onRefresh={() => loadFiles(currentFolder)}
              />
            </div>
          </div>
        ) : (
          <Explorer
            files={files}
            loading={filesLoading}
            currentFolder={currentFolder}
            folderHistory={folderHistory}
            onNavigateFolder={handleNavigateFolder}
            onNavigateBreadcrumb={handleNavigateBreadcrumb}
            onPlayFile={(f) => navigateTo(`/play/${encodeURIComponent(f.id)}`)}
            onRefresh={() => loadFiles(currentFolder)}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900/80 py-4 text-center text-xs text-slate-500">
        <p>gdirect · Google Drive Gateway</p>
      </footer>

      {/* Modals */}
      {activePlayerFile && (
        <FilePreviewModal
          file={activePlayerFile}
          status={status}
          folderFiles={files}
          onClose={closeCurrentModal}
          onSelectFile={(newFile) => navigateTo(`/play/${encodeURIComponent(newFile.id)}`, true)}
        />
      )}

      {showIntegrations && (
        <IntegrationsModal
          status={status}
          onClose={closeCurrentModal}
        />
      )}

      {showRoutes && routes && (
        <RoutesModal
          currentIp={routes.current_ip}
          currentSni={routes.current_sni}
          endpoints={routes.endpoints}
          onTriggerScan={triggerScan}
          onSwitchRoute={handleSwitchRoute}
          onRefresh={loadRoutes}
          onClose={closeCurrentModal}
        />
      )}

      {showSessions && (
        <SessionsModal
          sessions={sessions}
          onTerminate={handleTerminateSession}
          onRefresh={loadStatusAndSessions}
          onClose={closeCurrentModal}
        />
      )}

      {showSettings && (
        <SettingsModal
          config={config}
          onUpdateConfig={handleUpdateConfig}
          onClose={closeCurrentModal}
        />
      )}

      {showLogin && (
        <LoginModal
          currentAccount={defaultAccount}
          onSuccess={() => {
            loadAccounts();
            loadStatusAndSessions();
            loadFiles(currentFolder);
          }}
          onClose={closeCurrentModal}
        />
      )}
    </div>
  );
};
