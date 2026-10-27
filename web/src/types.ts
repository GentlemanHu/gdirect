export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  md5Checksum?: string;
  resourceKey?: string;
}

export interface SystemStatus {
  version: string;
  account: string | null;
  direct_ip: string;
  forged_sni: string | null;
  uptime_secs: number;
  active_streams: number;
  chunk_size_mb: number;
  prefetch_mb: number;
  concurrency: number;
  webdav_redirect: boolean;
  stream_mode?: string;
}

export interface StreamSession {
  session_id: string;
  file_id: string;
  file_name: string;
  client_ip: string;
  range_start: number;
  range_end: number;
  total_size: number;
  bytes_streamed: number;
  current_offset: number;
  speed_kbps: number;
  active_chunks: number;
  duration_secs: number;
  google_ip: string;
  created_at: string;
}

export interface RouteEndpoint {
  ip: string;
  latency_ms: number | null;
  error: string | null;
  sni: string;
}

export interface RoutesResponse {
  current_ip: string | null;
  current_sni: string | null;
  endpoints: RouteEndpoint[];
}

export interface StreamConfig {
  chunk_size: number;
  prefetch_chunks: number;
  concurrency: number;
  webdav_redirect: boolean;
  master_api_key?: string | null;
  stream_mode?: 'direct' | 'official_302' | 'proxy';
  proxy_url?: string | null;
}
