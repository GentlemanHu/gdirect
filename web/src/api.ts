import { DriveFile, RouteEndpoint, RoutesResponse, StreamConfig, StreamSession, SystemStatus } from './types';

function getHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };
  const token = localStorage.getItem('gdirect_api_key');
  if (token) {
    headers['x-api-key'] = token;
  }
  return headers;
}

export async function fetchStatus(): Promise<SystemStatus> {
  const res = await fetch('/api/status', { headers: getHeaders() });
  if (!res.ok) throw new Error('Failed to fetch system status');
  return res.json();
}

export async function fetchAccounts(): Promise<{ accounts: string[]; default: string | null }> {
  const res = await fetch('/api/accounts', { headers: getHeaders() });
  if (!res.ok) throw new Error('Failed to fetch accounts');
  return res.json();
}

export async function switchAccount(account: string): Promise<void> {
  const res = await fetch('/api/accounts/switch', {
    method: 'POST',
    headers: { ...getHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ account }),
  });
  if (!res.ok) throw new Error('Failed to switch account');
}

export async function fetchDriveFiles(folder: string = 'root'): Promise<DriveFile[]> {
  const res = await fetch(`/api/drive/files?folder=${encodeURIComponent(folder)}`, { headers: getHeaders() });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const err: any = new Error(data?.error || `获取文件列表失败 (${res.status})`);
    err.status = res.status;
    err.authExpired = data?.auth_expired || res.status === 401;
    err.detail = data?.detail;
    throw err;
  }
  return res.json();
}

export async function searchDriveFiles(query: string): Promise<DriveFile[]> {
  const res = await fetch(`/api/drive/search?q=${encodeURIComponent(query)}`, { headers: getHeaders() });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const err: any = new Error(data?.error || `搜索文件失败 (${res.status})`);
    err.status = res.status;
    err.authExpired = data?.auth_expired || res.status === 401;
    err.detail = data?.detail;
    throw err;
  }
  return res.json();
}

export async function fetchDriveFile(id: string): Promise<DriveFile> {
  const res = await fetch(`/api/drive/file/${encodeURIComponent(id)}`, { headers: getHeaders() });
  if (!res.ok) throw new Error('Failed to fetch file metadata');
  return res.json();
}

export interface VideoSubtitlePref {
  primary_sub_id?: string | null;
  primary_sub_name?: string | null;
  secondary_sub_id?: string | null;
  secondary_sub_name?: string | null;
  sub_offset?: number;
}

export async function fetchVideoSubtitle(fileId: string): Promise<VideoSubtitlePref | null> {
  try {
    const res = await fetch(`/api/drive/file/${encodeURIComponent(fileId)}/subtitle`, { headers: getHeaders() });
    if (res.ok) return res.json();
  } catch {}
  return null;
}

export async function saveVideoSubtitle(fileId: string, pref: VideoSubtitlePref): Promise<void> {
  try {
    await fetch(`/api/drive/file/${encodeURIComponent(fileId)}/subtitle`, {
      method: 'POST',
      headers: { ...getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(pref),
    });
  } catch {}
}

export async function fetchRoutes(): Promise<RoutesResponse> {
  const res = await fetch('/api/routes', { headers: getHeaders() });
  if (!res.ok) throw new Error('Failed to fetch routes');
  return res.json();
}

export async function triggerScan(): Promise<void> {
  const res = await fetch('/api/routes/scan', {
    method: 'POST',
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error('Failed to trigger scan');
}

export async function switchRoute(ip: string, sni?: string | null): Promise<void> {
  const res = await fetch('/api/routes/switch', {
    method: 'POST',
    headers: { ...getHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ip, sni }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to switch route');
  }
}

export interface OAuthStatusResponse {
  has_client: boolean;
  client_id?: string | null;
  current_account?: string | null;
}

export async function fetchOAuthStatus(): Promise<OAuthStatusResponse> {
  const res = await fetch('/api/auth/oauth-status', { headers: getHeaders() });
  if (!res.ok) throw new Error('Failed to fetch OAuth status');
  return res.json();
}

export async function startOAuthLogin(params?: {
  client_id?: string;
  client_secret?: string;
  redirect_uri?: string;
}): Promise<{
  auth_url: string;
  state: string;
  redirect_uri: string;
}> {
  const res = await fetch('/api/auth/start-login', {
    method: 'POST',
    headers: { ...getHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to start OAuth login');
  return data;
}

export async function exchangeOAuthCode(
  codeOrUrl: string,
  state?: string,
): Promise<{ success: boolean; account: string; message: string }> {
  const res = await fetch('/api/auth/exchange-code', {
    method: 'POST',
    headers: { ...getHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ code_or_url: codeOrUrl, state }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to exchange OAuth code');
  return data;
}

export async function importAuth(credentialsJson: string): Promise<{ success: boolean; account?: string; message?: string }> {
  const res = await fetch('/api/auth/import', {
    method: 'POST',
    headers: { ...getHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ credentials_json: credentialsJson }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Failed to import auth credentials');
  }
  return data;
}

export async function fetchConfig(): Promise<StreamConfig> {
  const res = await fetch('/api/config', { headers: getHeaders() });
  if (!res.ok) throw new Error('Failed to fetch config');
  return res.json();
}

export async function updateConfig(config: StreamConfig): Promise<StreamConfig> {
  const res = await fetch('/api/config', {
    method: 'POST',
    headers: { ...getHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error('Failed to update config');
  return res.json();
}

export async function fetchSessions(): Promise<StreamSession[]> {
  const res = await fetch('/api/sessions', { headers: getHeaders() });
  if (!res.ok) throw new Error('Failed to fetch active sessions');
  return res.json();
}

export async function terminateSession(sessionId: string): Promise<void> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error('Failed to terminate session');
}

export async function createTicket(fileId: string): Promise<{ file_id: string; ticket: string; expires_in_hours: number }> {
  const res = await fetch('/api/token/create', {
    method: 'POST',
    headers: { ...getHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId }),
  });
  if (!res.ok) throw new Error('Failed to generate ticket');
  return res.json();
}
