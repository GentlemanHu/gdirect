use anyhow::{Context, Result, bail};
use axum::body::Body;
use bytes::Bytes;
use reqwest::header::RANGE;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    net::{IpAddr, SocketAddr},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::{
    api::{API_HOST, Endpoint, FORGED_HOST, GTS_PEM},
    store::Store,
};

pub const DEFAULT_CHUNK_SIZE: usize = 2 * 1024 * 1024; // 2 MiB per chunk
pub const DEFAULT_PREFETCH_CHUNKS: usize = 8; // 16 MiB RAM window per stream
pub const DEFAULT_CONCURRENCY: usize = 3; // 3 concurrent chunks per stream

/// Global stream configuration
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StreamConfig {
    pub chunk_size: usize,
    pub prefetch_chunks: usize,
    pub concurrency: usize,
    pub webdav_redirect: bool,
    pub master_api_key: Option<String>,
    #[serde(default)]
    pub stream_mode: Option<String>,
    #[serde(default)]
    pub proxy_url: Option<String>,
}

impl Default for StreamConfig {
    fn default() -> Self {
        Self {
            chunk_size: DEFAULT_CHUNK_SIZE,
            prefetch_chunks: DEFAULT_PREFETCH_CHUNKS,
            concurrency: DEFAULT_CONCURRENCY,
            webdav_redirect: true,
            master_api_key: None,
            stream_mode: Some("direct".into()),
            proxy_url: None,
        }
    }
}

/// Statistics for an active playback stream
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StreamSessionStats {
    pub session_id: String,
    pub file_id: String,
    pub file_name: String,
    pub client_ip: String,
    pub range_start: u64,
    pub range_end: u64,
    pub total_size: u64,
    pub bytes_streamed: u64,
    pub current_offset: u64,
    pub speed_kbps: u64,
    pub active_chunks: usize,
    pub duration_secs: u64,
    pub google_ip: String,
    pub created_at: String,
}

struct SessionTracker {
    session_id: String,
    file_id: String,
    file_name: String,
    client_ip: String,
    range_start: u64,
    range_end: u64,
    total_size: u64,
    bytes_streamed: Arc<AtomicU64>,
    current_offset: Arc<AtomicU64>,
    active_chunks: Arc<AtomicUsize>,
    google_ip: String,
    start_time: Instant,
    created_at: String,
}

impl SessionTracker {
    fn to_stats(&self) -> StreamSessionStats {
        let elapsed = self.start_time.elapsed().as_secs();
        let bytes = self.bytes_streamed.load(Ordering::Relaxed);
        let speed = if elapsed > 0 {
            (bytes / elapsed) / 1024
        } else {
            0
        };

        StreamSessionStats {
            session_id: self.session_id.clone(),
            file_id: self.file_id.clone(),
            file_name: self.file_name.clone(),
            client_ip: self.client_ip.clone(),
            range_start: self.range_start,
            range_end: self.range_end,
            total_size: self.total_size,
            bytes_streamed: bytes,
            current_offset: self.current_offset.load(Ordering::Relaxed),
            speed_kbps: speed,
            active_chunks: self.active_chunks.load(Ordering::Relaxed),
            duration_secs: elapsed,
            google_ip: self.google_ip.clone(),
            created_at: self.created_at.clone(),
        }
    }
}

/// Async Direct Client for high-speed Google Drive Range requests
#[derive(Clone)]
pub struct AsyncDirectClient {
    db_path: PathBuf,
    current_ip: Arc<Mutex<Option<IpAddr>>>,
    forged_sni: Arc<Mutex<Option<String>>>,
    proxy_url: Arc<Mutex<Option<String>>>,
    backups: Arc<Mutex<VecDeque<Endpoint>>>,
    auto_fallback: bool,
    client: Arc<Mutex<reqwest::Client>>,
}

impl AsyncDirectClient {
    pub fn new(
        db_path: PathBuf,
        ip: Option<IpAddr>,
        forged: Option<String>,
        auto: bool,
    ) -> Result<Self> {
        let client = build_async_client(ip, forged.as_deref(), None)?;
        Ok(Self {
            db_path,
            current_ip: Arc::new(Mutex::new(ip)),
            forged_sni: Arc::new(Mutex::new(forged)),
            proxy_url: Arc::new(Mutex::new(None)),
            backups: Arc::new(Mutex::new(VecDeque::new())),
            auto_fallback: auto,
            client: Arc::new(Mutex::new(client)),
        })
    }

    pub fn with_backups(self, backups: Vec<Endpoint>) -> Self {
        *self.backups.lock().unwrap() = backups.into();
        self
    }

    pub fn current_ip_str(&self) -> String {
        if let Some(ref p) = *self.proxy_url.lock().unwrap() {
            return format!("Proxy: {p}");
        }
        self.current_ip
            .lock()
            .unwrap()
            .map(|ip| ip.to_string())
            .unwrap_or_else(|| "system DNS".into())
    }

    pub fn active_route(&self) -> (Option<IpAddr>, Option<String>) {
        (
            *self.current_ip.lock().unwrap(),
            self.forged_sni.lock().unwrap().clone(),
        )
    }

    pub fn switch_route(&self, ip: Option<IpAddr>, forged: Option<String>) -> Result<()> {
        let proxy = self.proxy_url.lock().unwrap().clone();
        let new_client = build_async_client(ip, forged.as_deref(), proxy.as_deref())?;
        *self.client.lock().unwrap() = new_client;
        *self.current_ip.lock().unwrap() = ip;
        *self.forged_sni.lock().unwrap() = forged;
        Ok(())
    }

    pub fn set_proxy(&self, proxy: Option<String>) -> Result<()> {
        let ip = *self.current_ip.lock().unwrap();
        let forged = self.forged_sni.lock().unwrap().clone();
        let new_client = build_async_client(ip, forged.as_deref(), proxy.as_deref())?;
        *self.client.lock().unwrap() = new_client;
        *self.proxy_url.lock().unwrap() = proxy;
        Ok(())
    }

    /// Execute a request with automatic Google Direct IP failover
    pub async fn fetch_chunk(
        &self,
        url_str: &str,
        token: Option<&str>,
        range_start: u64,
        range_end: u64,
    ) -> Result<Bytes> {
        let range_val = format!("bytes={range_start}-{range_end}");
        let expected_len = (range_end - range_start + 1) as usize;

        // Try current client first
        let res = self.send_once(url_str, token, &range_val).await;
        match res {
            Ok(bytes) => {
                if bytes.len() == expected_len || bytes.len() > 0 {
                    return Ok(bytes);
                }
            }
            Err(e) => {
                if !self.auto_fallback {
                    return Err(e);
                }
            }
        }

        // Try alternating SNI identity or next backup IP
        let mut tried_alt = false;
        loop {
            let next_route = {
                let current_ip = *self.current_ip.lock().unwrap();
                let current_sni = self.forged_sni.lock().unwrap().clone();

                if !tried_alt && current_ip.is_some() {
                    tried_alt = true;
                    let alt_sni = match &current_sni {
                        Some(_) => None,
                        None => Some(FORGED_HOST.to_string()),
                    };
                    Some((current_ip.unwrap(), alt_sni))
                } else {
                    let mut backups = self.backups.lock().unwrap();
                    backups.pop_front()
                }
            };

            let Some((next_ip, next_sni)) = next_route else {
                bail!("All Google direct endpoints failed for chunk {range_start}-{range_end}");
            };

            if let Ok(()) = self.switch_route(Some(next_ip), next_sni.clone()) {
                if let Ok(bytes) = self.send_once(url_str, token, &range_val).await {
                    if !bytes.is_empty() {
                        // Record working SNI in SQLite
                        if let Ok(db) = Store::open(&self.db_path) {
                            let _ = db.set_sni(
                                &next_ip.to_string(),
                                next_sni.as_deref().unwrap_or_default(),
                            );
                        }
                        return Ok(bytes);
                    }
                }
            }
        }
    }

    /// Fetch a whole file (used for Google Workspace export without HTTP Range)
    pub async fn fetch_whole_file(&self, url_str: &str, token: Option<&str>) -> Result<Bytes> {
        let (client, forged) = {
            let c = self.client.lock().unwrap().clone();
            let f = self.forged_sni.lock().unwrap().clone();
            (c, f)
        };

        let mut parsed_url = url::Url::parse(url_str)?;
        let real_host = parsed_url.host_str().unwrap_or(API_HOST).to_string();

        if let Some(host) = forged.as_deref() {
            let _ = parsed_url.set_host(Some(host));
        }

        let mut req = client
            .get(parsed_url)
            .header(reqwest::header::HOST, &real_host)
            .header(reqwest::header::USER_AGENT, "gdirect/0.8.0")
            .header(reqwest::header::ACCEPT, "*/*");

        if let Some(tok) = token {
            req = req.bearer_auth(tok);
        }

        let resp = req.send().await?.error_for_status()?;
        let bytes = resp.bytes().await?;
        Ok(bytes)
    }

    async fn send_once(
        &self,
        url_str: &str,
        token: Option<&str>,
        range_val: &str,
    ) -> Result<Bytes> {
        let (client, forged) = {
            let c = self.client.lock().unwrap().clone();
            let f = self.forged_sni.lock().unwrap().clone();
            (c, f)
        };

        let mut parsed_url = url::Url::parse(url_str)?;
        let real_host = parsed_url.host_str().unwrap_or(API_HOST).to_string();

        if let Some(host) = forged.as_deref() {
            let _ = parsed_url.set_host(Some(host));
        }

        let mut req = client
            .get(parsed_url)
            .header(reqwest::header::HOST, &real_host)
            .header(RANGE, range_val)
            .header(reqwest::header::USER_AGENT, "gdirect/0.8.0")
            .header(reqwest::header::ACCEPT, "*/*");

        if let Some(tok) = token {
            req = req.bearer_auth(tok);
        }

        let resp = req.send().await?.error_for_status()?;
        let bytes = resp.bytes().await?;
        Ok(bytes)
    }
}

fn build_async_client(
    ip: Option<IpAddr>,
    forged: Option<&str>,
    proxy: Option<&str>,
) -> Result<reqwest::Client> {
    let mut builder = reqwest::Client::builder()
        .tls_built_in_root_certs(false)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(25))
        .pool_max_idle_per_host(16);

    const BEGIN: &str = "-----BEGIN CERTIFICATE-----";
    const END: &str = "-----END CERTIFICATE-----";
    for block in GTS_PEM.split(BEGIN).skip(1) {
        let end = block
            .find(END)
            .context("bundled GTS root must be complete")?
            + END.len();
        builder = builder.add_root_certificate(
            reqwest::Certificate::from_pem(format!("{BEGIN}{}", &block[..end]).as_bytes())
                .context("bundled GTS root must parse")?,
        );
    }

    if let Some(proxy_str) = proxy {
        if !proxy_str.trim().is_empty() {
            builder = builder.proxy(reqwest::Proxy::all(proxy_str)?);
        }
    } else if let Some(ip) = ip {
        builder = builder
            .no_proxy()
            .resolve(forged.unwrap_or(API_HOST), SocketAddr::new(ip, 443));
    }

    Ok(builder.build()?)
}

/// Core streaming manager coordinating active video sessions and memory buffers
#[derive(Clone)]
pub struct StreamEngine {
    client: AsyncDirectClient,
    config: Arc<Mutex<StreamConfig>>,
    sessions: Arc<Mutex<HashMap<String, Arc<SessionTracker>>>>,
    session_cancel: Arc<Mutex<HashMap<String, CancellationToken>>>,
}

impl StreamEngine {
    pub fn new(client: AsyncDirectClient, config: StreamConfig) -> Self {
        Self {
            client,
            config: Arc::new(Mutex::new(config)),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            session_cancel: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn client(&self) -> &AsyncDirectClient {
        &self.client
    }

    pub fn config(&self) -> StreamConfig {
        self.config.lock().unwrap().clone()
    }

    pub fn update_config(&self, new_cfg: StreamConfig) {
        *self.config.lock().unwrap() = new_cfg;
    }

    pub fn active_sessions(&self) -> Vec<StreamSessionStats> {
        let sessions = self.sessions.lock().unwrap();
        sessions.values().map(|s| s.to_stats()).collect()
    }

    pub fn terminate_session(&self, session_id: &str) -> bool {
        let cancel = self.session_cancel.lock().unwrap().remove(session_id);
        if let Some(token) = cancel {
            token.cancel();
            self.sessions.lock().unwrap().remove(session_id);
            true
        } else {
            false
        }
    }

    /// Stream a file range with in-memory chunk prefetch and zero disk writing
    pub async fn create_range_stream(
        &self,
        file_id: String,
        file_name: String,
        download_url: String,
        token: Option<String>,
        client_ip: String,
        range_start: u64,
        range_end: u64,
        total_size: u64,
    ) -> Result<Body> {
        let cfg = self.config();
        let chunk_size = cfg.chunk_size.max(512 * 1024);
        let prefetch_chunks = cfg.prefetch_chunks.max(2);
        let concurrency = cfg.concurrency.clamp(1, 16);

        let session_id = format!(
            "{}-{:x}",
            file_id,
            Instant::now().elapsed().as_nanos() % 0xffffff
        );

        let cancel_token = CancellationToken::new();
        let cancel_child = cancel_token.clone();

        let bytes_counter = Arc::new(AtomicU64::new(0));
        let offset_counter = Arc::new(AtomicU64::new(range_start));
        let active_chunks = Arc::new(AtomicUsize::new(0));

        let tracker = Arc::new(SessionTracker {
            session_id: session_id.clone(),
            file_id: file_id.clone(),
            file_name: file_name.clone(),
            client_ip: client_ip.clone(),
            range_start,
            range_end,
            total_size,
            bytes_streamed: bytes_counter.clone(),
            current_offset: offset_counter.clone(),
            active_chunks: active_chunks.clone(),
            google_ip: self.client.current_ip_str(),
            start_time: Instant::now(),
            created_at: chrono::Local::now().to_rfc3339(),
        });

        {
            self.sessions
                .lock()
                .unwrap()
                .insert(session_id.clone(), tracker.clone());
            self.session_cancel
                .lock()
                .unwrap()
                .insert(session_id.clone(), cancel_token);
        }

        // Bounded channel so memory buffer is strictly limited
        let (tx, rx) = mpsc::channel::<Result<Bytes, std::io::Error>>(prefetch_chunks);

        let client = self.client.clone();
        let s_id = session_id.clone();
        let sessions_map = self.sessions.clone();
        let cancels_map = self.session_cancel.clone();

        // Background worker fetching chunks in parallel and feeding the channel in order
        tokio::spawn(async move {
            let mut curr = range_start;

            // Generate chunk segments
            let mut chunks = Vec::new();
            while curr <= range_end {
                let end = (curr + chunk_size as u64 - 1).min(range_end);
                chunks.push((curr, end));
                curr = end + 1;
            }

            let semaphore = Arc::new(tokio::sync::Semaphore::new(concurrency));
            let mut chunk_index = 0;

            // Stream chunks sequentially through an ordered buffer
            while chunk_index < chunks.len() {
                if cancel_child.is_cancelled() {
                    break;
                }

                // Batch up to `prefetch_chunks` for parallel fetching
                let batch_end = (chunk_index + prefetch_chunks).min(chunks.len());
                let mut batch_handles = Vec::new();

                for i in chunk_index..batch_end {
                    let (c_start, c_end) = chunks[i];
                    let sem = semaphore.clone();
                    let cl = client.clone();
                    let url = download_url.clone();
                    let tok = token.clone();
                    let ct = cancel_child.clone();
                    let active = active_chunks.clone();

                    let handle = tokio::spawn(async move {
                        let _permit = sem.acquire().await.ok()?;
                        if ct.is_cancelled() {
                            return None;
                        }
                        active.fetch_add(1, Ordering::Relaxed);
                        let res = cl.fetch_chunk(&url, tok.as_deref(), c_start, c_end).await;
                        active.fetch_sub(1, Ordering::Relaxed);
                        match res {
                            Ok(bytes) => Some(bytes),
                            Err(e) => {
                                eprintln!("Error fetching chunk {c_start}-{c_end}: {e:?}");
                                None
                            }
                        }
                    });
                    batch_handles.push(handle);
                }

                // Deliver chunks in strict sequential order
                for handle in batch_handles {
                    if cancel_child.is_cancelled() {
                        break;
                    }

                    match handle.await {
                        Ok(Some(bytes)) => {
                            let len = bytes.len() as u64;
                            bytes_counter.fetch_add(len, Ordering::Relaxed);
                            offset_counter.fetch_add(len, Ordering::Relaxed);

                            if tx.send(Ok(bytes)).await.is_err() {
                                // Downstream receiver dropped (player seeked or closed)
                                cancel_child.cancel();
                                break;
                            }
                        }
                        _ => {
                            let _ = tx
                                .send(Err(std::io::Error::new(
                                    std::io::ErrorKind::ConnectionAborted,
                                    "Google upstream chunk read failed",
                                )))
                                .await;
                            cancel_child.cancel();
                            break;
                        }
                    }
                }

                chunk_index = batch_end;
            }

            // Cleanup session tracking
            sessions_map.lock().unwrap().remove(&s_id);
            cancels_map.lock().unwrap().remove(&s_id);
        });

        // Convert Tokio receiver to Axum Body stream
        let stream = tokio_stream::wrappers::ReceiverStream::new(rx);
        Ok(Body::from_stream(stream))
    }
}

/// Parse HTTP Range header format (e.g. "bytes=0-1048575", "bytes=1048576-", "bytes=-1048576")
pub fn parse_range(header_str: &str, total_size: u64) -> Option<(u64, u64)> {
    if !header_str.starts_with("bytes=") {
        return None;
    }

    let range_val = header_str.trim_start_matches("bytes=").trim();
    // In case of multiple ranges (e.g. multipart), take first range for single video stream
    let range_part = range_val.split(',').next()?.trim();

    if let Some(suffix) = range_part.strip_prefix('-') {
        // bytes=-500 -> last 500 bytes (e.g. MP4 moov atom / MKV cues)
        let count: u64 = suffix.parse().ok()?;
        if count == 0 || total_size == 0 {
            return None;
        }
        let start = total_size.saturating_sub(count);
        let end = total_size - 1;
        Some((start, end))
    } else if let Some(prefix) = range_part.strip_suffix('-') {
        // bytes=1000- -> from 1000 to end
        let start: u64 = prefix.parse().ok()?;
        if start >= total_size {
            return None;
        }
        let end = total_size - 1;
        Some((start, end))
    } else {
        // bytes=100-200 -> exact range
        let mut parts = range_part.split('-');
        let start: u64 = parts.next()?.parse().ok()?;
        let end: u64 = parts.next()?.parse().ok()?;
        if start > end || start >= total_size {
            return None;
        }
        let end = end.min(total_size - 1);
        Some((start, end))
    }
}
