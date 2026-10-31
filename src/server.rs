use axum::{
    Router,
    extract::{Path, Query, Request, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{any, delete, get, post},
};
#[cfg(feature = "web")]
use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Arc, time::Instant};
use tower_http::cors::{Any, CorsLayer};

use crate::{
    api::Api,
    auth_middleware::{generate_signed_ticket, is_authorized},
    extensions::{
        ApiExt, CustomStore, ServiceAccount, VideoSubtitleConfig, get_service_account_token,
    },
    scan,
    store::Store,
    stream::{AsyncDirectClient, StreamConfig, StreamEngine, parse_range},
    strm::{export_strm_zip, generate_strm_content},
    webdav::{WebDavTree, handle_webdav},
};

#[cfg(feature = "web")]
#[derive(RustEmbed)]
#[folder = "web/dist/"]
struct Assets;

#[derive(Clone)]
pub struct AppState {
    pub api: Arc<std::sync::RwLock<Api>>,
    pub engine: StreamEngine,
    pub webdav: WebDavTree,
    pub db_path: PathBuf,
    pub start_time: Instant,
}

impl AppState {
    pub fn api_client(&self) -> Api {
        self.api.read().unwrap().clone()
    }
}

pub fn create_router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
            Method::HEAD,
            Method::from_bytes(b"PROPFIND").unwrap(),
        ])
        .allow_headers(Any)
        .expose_headers([
            header::CONTENT_RANGE,
            header::CONTENT_LENGTH,
            header::ACCEPT_RANGES,
            HeaderName::from_static("x-stream-session"),
            HeaderName::from_static("x-google-direct-ip"),
        ]);

    Router::new()
        // Streaming endpoints
        .route(
            "/stream/{id}",
            get(stream_handler).head(stream_head_handler),
        )
        .route(
            "/d/{id}/{name}",
            get(stream_friendly_handler).head(stream_friendly_head_handler),
        )
        // WebDAV endpoint (supports OPTIONS, PROPFIND, GET, HEAD)
        .route("/webdav", any(webdav_entry))
        .route("/webdav/{*path}", any(webdav_entry))
        // Management REST API
        .route("/api/status", get(api_status))
        .route("/api/accounts", get(api_accounts))
        .route("/api/accounts/switch", post(api_switch_account))
        .route("/api/auth/import", post(api_auth_import))
        .route("/api/drive/files", get(api_drive_files))
        .route("/api/drive/search", get(api_drive_search))
        .route("/api/drive/file/{id}", get(api_drive_file))
        .route(
            "/api/drive/file/{id}/subtitle",
            get(api_get_file_subtitle).post(api_save_file_subtitle),
        )
        .route("/api/routes", get(api_routes))
        .route("/api/routes/scan", post(api_trigger_scan))
        .route("/api/routes/switch", post(api_switch_route))
        .route("/api/config", get(api_get_config).post(api_update_config))
        .route("/api/sessions", get(api_get_sessions))
        .route("/api/sessions/{id}", delete(api_terminate_session))
        .route("/api/strm/export", get(api_strm_export))
        .route("/api/strm/file/{id}", get(api_strm_single))
        .route("/api/token/create", post(api_create_ticket))
        // Embedded SPA static assets
        .fallback(static_asset_handler)
        .layer(cors)
        .with_state(state)
}

use axum::http::HeaderName;

// --- Streaming Handlers ---

#[derive(Deserialize)]
struct StreamQuery {
    token: Option<String>,
    ticket: Option<String>,
    export: Option<String>,
    mode: Option<String>,
}

async fn stream_head_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<StreamQuery>,
) -> Response {
    let cfg = state.engine.config();
    if !is_authorized(
        &headers,
        query.token.as_deref(),
        query.ticket.as_deref(),
        Some(&id),
        cfg.master_api_key.as_deref(),
    ) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let api = state.api_client();
    let fid = id.clone();
    let meta = match tokio::task::spawn_blocking(move || api.metadata(&fid)).await {
        Ok(Ok(m)) => m,
        _ => return StatusCode::NOT_FOUND.into_response(),
    };

    let is_302_mode = query.mode.as_deref() == Some("302")
        || query.mode.as_deref() == Some("official")
        || cfg.stream_mode.as_deref() == Some("official_302");

    if is_302_mode {
        if let Ok(tok) = state.api_client().token() {
            let is_workspace = meta.mime_type.starts_with("application/vnd.google-apps.");
            let redirect_target = if is_workspace {
                format!(
                    "https://www.googleapis.com/drive/v3/files/{}/export?mimeType=application%2Fpdf&supportsAllDrives=true&access_token={}",
                    meta.id, tok
                )
            } else {
                format!(
                    "https://www.googleapis.com/drive/v3/files/{}?alt=media&supportsAllDrives=true&access_token={}",
                    meta.id, tok
                )
            };
            let mut res = StatusCode::FOUND.into_response();
            res.headers_mut().insert(
                header::LOCATION,
                HeaderValue::from_str(&redirect_target).unwrap(),
            );
            return res;
        }
    }

    let total_size = meta
        .size
        .as_deref()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);
    let mime = mime_guess::from_path(&meta.name)
        .first_or_octet_stream()
        .to_string();

    let mut res = StatusCode::OK.into_response();
    let h = res.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_str(&mime).unwrap());
    h.insert(
        header::CONTENT_LENGTH,
        HeaderValue::from_str(&total_size.to_string()).unwrap(),
    );
    h.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    h.insert(
        HeaderName::from_static("x-google-direct-ip"),
        HeaderValue::from_str(&state.engine.client().current_ip_str()).unwrap(),
    );
    res
}

async fn stream_friendly_head_handler(
    State(state): State<AppState>,
    Path((id, _name)): Path<(String, String)>,
    headers: HeaderMap,
    query: Query<StreamQuery>,
) -> Response {
    stream_head_handler(State(state), Path(id), headers, query).await
}

async fn stream_friendly_handler(
    State(state): State<AppState>,
    Path((id, _name)): Path<(String, String)>,
    headers: HeaderMap,
    query: Query<StreamQuery>,
) -> Response {
    stream_handler_inner(state, id, headers, query, None).await
}

async fn stream_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    query: Query<StreamQuery>,
) -> Response {
    stream_handler_inner(state, id, headers, query, None).await
}

async fn stream_handler_inner(
    state: AppState,
    id: String,
    headers: HeaderMap,
    Query(query): Query<StreamQuery>,
    client_ip: Option<String>,
) -> Response {
    let cfg = state.engine.config();
    if !is_authorized(
        &headers,
        query.token.as_deref(),
        query.ticket.as_deref(),
        Some(&id),
        cfg.master_api_key.as_deref(),
    ) {
        return (
            StatusCode::UNAUTHORIZED,
            [(header::CONTENT_TYPE, "application/json")],
            r#"{"error":"Unauthorized - Invalid or missing token/ticket"}"#,
        )
            .into_response();
    }

    let api = state.api_client();
    let fid = id.clone();
    let meta = match tokio::task::spawn_blocking(move || api.metadata(&fid)).await {
        Ok(Ok(m)) => m,
        Err(e) => {
            eprintln!("Drive metadata error: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
        Ok(Err(e)) => {
            eprintln!("File not found: {e}");
            return StatusCode::NOT_FOUND.into_response();
        }
    };

    let total_size = meta
        .size
        .as_deref()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);
    let mime = mime_guess::from_path(&meta.name)
        .first_or_octet_stream()
        .to_string();

    let range_header = headers.get(header::RANGE).and_then(|v| v.to_str().ok());

    let (start, end, is_partial) = match range_header {
        Some(r) => match parse_range(r, total_size) {
            Some(range) => (range.0, range.1, true),
            None => {
                return (
                    StatusCode::RANGE_NOT_SATISFIABLE,
                    [(header::CONTENT_RANGE, format!("bytes */{total_size}"))],
                )
                    .into_response();
            }
        },
        None => (0, total_size.saturating_sub(1), false),
    };

    let is_workspace = meta.mime_type.starts_with("application/vnd.google-apps.");
    let (download_url, final_mime) = if is_workspace {
        let export_mime = match meta.mime_type.as_str() {
            "application/vnd.google-apps.spreadsheet" => {
                if query.export.as_deref() == Some("csv") {
                    "text/csv"
                } else if query.export.as_deref() == Some("pdf") {
                    "application/pdf"
                } else {
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                }
            }
            "application/vnd.google-apps.document" => {
                if query.export.as_deref() == Some("docx") {
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                } else {
                    "application/pdf"
                }
            }
            _ => "application/pdf",
        };
        let encoded_export =
            url::form_urlencoded::byte_serialize(export_mime.as_bytes()).collect::<String>();
        (
            format!(
                "https://www.googleapis.com/drive/v3/files/{}/export?mimeType={}&supportsAllDrives=true",
                meta.id, encoded_export
            ),
            export_mime.to_string(),
        )
    } else {
        (
            format!(
                "https://www.googleapis.com/drive/v3/files/{}?alt=media&supportsAllDrives=true",
                meta.id
            ),
            mime,
        )
    };

    let token = state.api_client().token().ok();
    let ip = client_ip.unwrap_or_else(|| "media-client".into());

    let is_302_mode = query.mode.as_deref() == Some("302")
        || query.mode.as_deref() == Some("official")
        || cfg.stream_mode.as_deref() == Some("official_302");

    if is_302_mode {
        if let Some(ref tok) = token {
            let redirect_target = format!("{}&access_token={}", download_url, tok);
            let mut res = StatusCode::FOUND.into_response();
            res.headers_mut().insert(
                header::LOCATION,
                HeaderValue::from_str(&redirect_target).unwrap(),
            );
            res.headers_mut()
                .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
            return res;
        }
    }

    if is_workspace {
        match state
            .engine
            .client()
            .fetch_whole_file(&download_url, token.as_deref())
            .await
        {
            Ok(bytes) => {
                let mut res = (StatusCode::OK, bytes).into_response();
                let h = res.headers_mut();
                h.insert(
                    header::CONTENT_TYPE,
                    HeaderValue::from_str(&final_mime).unwrap(),
                );
                h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
                return res;
            }
            Err(e) => {
                eprintln!("Failed to export Google doc: {e}");
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            }
        }
    }

    let body = match state
        .engine
        .create_range_stream(
            meta.id.clone(),
            meta.name.clone(),
            download_url,
            token,
            ip,
            start,
            end,
            total_size,
        )
        .await
    {
        Ok(b) => b,
        Err(e) => {
            eprintln!("Failed to init stream: {e:?}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };

    let content_len = (end - start + 1).to_string();
    let content_range = format!("bytes {start}-{end}/{total_size}");

    let status = if is_partial {
        StatusCode::PARTIAL_CONTENT
    } else {
        StatusCode::OK
    };

    let mut res = (status, body).into_response();
    let h = res.headers_mut();
    h.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&final_mime).unwrap(),
    );
    h.insert(
        header::CONTENT_LENGTH,
        HeaderValue::from_str(&content_len).unwrap(),
    );
    h.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    if is_partial {
        h.insert(
            header::CONTENT_RANGE,
            HeaderValue::from_str(&content_range).unwrap(),
        );
    }
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    h.insert(
        HeaderName::from_static("x-google-direct-ip"),
        HeaderValue::from_str(&state.engine.client().current_ip_str()).unwrap(),
    );
    res
}

// --- WebDAV Handler ---

async fn webdav_entry(State(state): State<AppState>, req: Request) -> Response {
    handle_webdav(state.webdav.clone(), state.engine.clone(), req).await
}

// --- Management REST API Handlers ---

#[derive(Serialize)]
struct StatusResponse {
    version: &'static str,
    account: Option<String>,
    direct_ip: String,
    forged_sni: Option<String>,
    uptime_secs: u64,
    active_streams: usize,
    chunk_size_mb: f64,
    prefetch_mb: f64,
    concurrency: usize,
    webdav_redirect: bool,
    stream_mode: String,
}

async fn api_status(State(state): State<AppState>) -> impl IntoResponse {
    let cfg = state.engine.config();
    let (ip, sni) = state.engine.client().active_route();
    let sessions = state.engine.active_sessions();

    let res = StatusResponse {
        version: "0.9.0-streaming-gateway",
        account: state.api.read().unwrap().account.clone(),
        direct_ip: ip
            .map(|i| i.to_string())
            .unwrap_or_else(|| "system DNS".into()),
        forged_sni: sni,
        uptime_secs: state.start_time.elapsed().as_secs(),
        active_streams: sessions.len(),
        chunk_size_mb: (cfg.chunk_size as f64) / (1024.0 * 1024.0),
        prefetch_mb: ((cfg.chunk_size * cfg.prefetch_chunks) as f64) / (1024.0 * 1024.0),
        concurrency: cfg.concurrency,
        webdav_redirect: cfg.webdav_redirect,
        stream_mode: cfg.stream_mode.unwrap_or_else(|| "direct".into()),
    };

    (StatusCode::OK, axum::Json(res))
}

async fn api_accounts(State(state): State<AppState>) -> impl IntoResponse {
    let db = match Store::open(&state.db_path) {
        Ok(db) => db,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };

    let accounts = db.accounts().unwrap_or_default();
    let default = db.default_account().unwrap_or(None);

    let res = serde_json::json!({
        "accounts": accounts,
        "default": default,
    });

    (StatusCode::OK, axum::Json(res)).into_response()
}

#[derive(Deserialize)]
struct SwitchAccountReq {
    account: String,
}

async fn api_switch_account(
    State(state): State<AppState>,
    axum::Json(req): axum::Json<SwitchAccountReq>,
) -> impl IntoResponse {
    let db = match Store::open(&state.db_path) {
        Ok(db) => db,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };

    if let Err(e) = db.set_default_account(&req.account) {
        return (StatusCode::BAD_REQUEST, e.to_string()).into_response();
    }

    (
        StatusCode::OK,
        serde_json::json!({"success": true, "account": req.account}).to_string(),
    )
        .into_response()
}

#[derive(Deserialize)]
struct ImportAuthReq {
    credentials_json: String,
}

async fn api_auth_import(
    State(state): State<AppState>,
    axum::Json(req): axum::Json<ImportAuthReq>,
) -> impl IntoResponse {
    let raw = req.credentials_json.trim();
    let val: serde_json::Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                axum::Json(serde_json::json!({"error": format!("Invalid JSON format: {e}")})),
            )
                .into_response();
        }
    };

    let db = match Store::open(&state.db_path) {
        Ok(db) => db,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response();
        }
    };

    // Case 1: authorized_user credentials
    if val.get("type").and_then(|t| t.as_str()) == Some("authorized_user") {
        let creds = match serde_json::from_value::<crate::auth::Credentials>(val.clone()) {
            Ok(c) => c,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    axum::Json(
                        serde_json::json!({"error": format!("Invalid authorized_user JSON: {e}")}),
                    ),
                )
                    .into_response();
            }
        };

        let token_res = match crate::auth::refresh(&creds) {
            Ok(t) => t,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    axum::Json(serde_json::json!({"error": format!("Google OAuth token refresh failed: {e}")})),
                )
                    .into_response();
            }
        };

        let email = match state
            .api_client()
            .account_for_token_ext(&token_res.access_token)
        {
            Ok(em) => em,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    axum::Json(serde_json::json!({"error": format!("Cannot verify account identity: {e}")})),
                )
                    .into_response();
            }
        };

        if let Err(e) = db.save_account(&email, &serde_json::to_string(&creds).unwrap_or_default())
        {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response();
        }
        let _ = db.save_token(&email, &token_res.access_token, token_res.expires_in);
        let _ = db.set_default_account(&email);

        return (
            StatusCode::OK,
            axum::Json(serde_json::json!({
                "success": true,
                "account": email,
                "type": "authorized_user",
                "message": format!("成功授权并保存账号 {email}！")
            })),
        )
            .into_response();
    }

    // Case 2: service_account credentials
    if val.get("type").and_then(|t| t.as_str()) == Some("service_account") {
        let sa: ServiceAccount = match serde_json::from_value(val.clone()) {
            Ok(s) => s,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    axum::Json(
                        serde_json::json!({"error": format!("Invalid service_account JSON: {e}")}),
                    ),
                )
                    .into_response();
            }
        };

        let token_res = match get_service_account_token(&sa) {
            Ok(t) => t,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    axum::Json(serde_json::json!({"error": format!("Service Account JWT verification failed: {e}")})),
                )
                    .into_response();
            }
        };

        let email = sa.client_email.clone();
        if let Err(e) = db.save_account(&email, &serde_json::to_string(&sa).unwrap_or_default()) {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response();
        }
        let _ = db.save_token(&email, &token_res.access_token, token_res.expires_in);
        let _ = db.set_default_account(&email);

        return (
            StatusCode::OK,
            axum::Json(serde_json::json!({
                "success": true,
                "account": email,
                "type": "service_account",
                "message": format!("Service Account ({email}) 导入成功！已开启永久免登与多倍流量！")
            })),
        )
            .into_response();
    }

    // Case 2: client_secret.json (installed app)
    if val.get("installed").is_some() {
        let client_val = &val["installed"];
        let client_id = client_val
            .get("client_id")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if !client_id.is_empty() {
            let _ = db.set(
                "oauth_client",
                &serde_json::to_string(&client_val).unwrap_or_default(),
            );
            return (
                StatusCode::OK,
                axum::Json(serde_json::json!({
                    "success": true,
                    "type": "oauth_client",
                    "client_id": client_id,
                    "message": "OAuth Client 凭据已成功保存！"
                })),
            )
                .into_response();
        }
    }

    // Case 3: access_token direct
    if let Some(tok) = val.get("access_token").and_then(|v| v.as_str()) {
        if let Ok(email) = state.api_client().account_for_token_ext(tok) {
            let _ = db.save_token(&email, tok, 3600);
            let _ = db.set_default_account(&email);
            return (
                StatusCode::OK,
                axum::Json(serde_json::json!({
                    "success": true,
                    "account": email,
                    "type": "access_token",
                    "message": format!("临时访问令牌有效，已绑定账号 {email}！")
                })),
            )
                .into_response();
        }
    }

    (
        StatusCode::BAD_REQUEST,
        axum::Json(serde_json::json!({
            "error": "未识别的凭据格式。请粘贴包含 \"type\": \"authorized_user\" 的凭据 JSON，或 client_secret.json 内容。"
        })),
    )
        .into_response()
}

fn recover_best_api(state: &AppState) -> Option<Api> {
    let db = Store::open(&state.db_path).ok()?;
    let best = db.best_route().ok()??;
    let current_account = state.api.read().unwrap().account.clone();
    let google = crate::ranges::current(&db);
    let backups: Vec<crate::api::Endpoint> =
        scan::usable(db.routes(16).unwrap_or_default(), &google, false)
            .into_iter()
            .filter(|r| r.ip != best.ip)
            .map(|r| (r.ip, (!r.sni.is_empty()).then_some(r.sni)))
            .take(8)
            .collect();

    let new_api = Api::new(
        state.db_path.clone(),
        current_account,
        Some(best.ip),
        (!best.sni.is_empty()).then_some(best.sni.clone()),
        true,
    )
    .ok()?
    .with_backups(backups);

    let _ = state
        .engine
        .client()
        .switch_route(Some(best.ip), (!best.sni.is_empty()).then_some(best.sni));
    if let Ok(mut lock) = state.api.write() {
        *lock = new_api.clone();
    }
    Some(new_api)
}

#[derive(Deserialize)]
struct DriveFilesQuery {
    folder: Option<String>,
}

async fn api_drive_files(
    State(state): State<AppState>,
    Query(query): Query<DriveFilesQuery>,
) -> impl IntoResponse {
    let folder = query.folder.unwrap_or_else(|| "root".into());
    let api = state.api_client();
    let folder_clone = folder.clone();

    let files = match tokio::task::spawn_blocking(move || api.list(&folder_clone)).await {
        Ok(Ok(files)) => files,
        _ => {
            // Self-healing: if current endpoint failed or timed out, auto-failover to best verified route
            if let Some(fallback_api) = recover_best_api(&state) {
                let fld = folder.clone();
                if let Ok(Ok(recovered_files)) =
                    tokio::task::spawn_blocking(move || fallback_api.list(&fld)).await
                {
                    return (StatusCode::OK, axum::Json(recovered_files)).into_response();
                }
            }
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({"error": "Failed to list files. All direct endpoints failed."})),
            )
                .into_response();
        }
    };

    (StatusCode::OK, axum::Json(files)).into_response()
}

#[derive(Deserialize)]
struct DriveSearchQuery {
    q: String,
}

async fn api_drive_search(
    State(state): State<AppState>,
    Query(query): Query<DriveSearchQuery>,
) -> impl IntoResponse {
    let q = query.q.trim().to_string();
    if q.is_empty() {
        return (StatusCode::OK, axum::Json(Vec::<crate::api::File>::new())).into_response();
    }
    let api = state.api_client();
    let q_clone = q.clone();

    let files = match tokio::task::spawn_blocking(move || api.search_files(&q_clone)).await {
        Ok(Ok(files)) => files,
        _ => {
            if let Some(fallback_api) = recover_best_api(&state) {
                let q_str = q.clone();
                if let Ok(Ok(recovered_files)) =
                    tokio::task::spawn_blocking(move || fallback_api.search_files(&q_str)).await
                {
                    return (StatusCode::OK, axum::Json(recovered_files)).into_response();
                }
            }
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(
                    serde_json::json!({"error": "Search failed. All direct endpoints failed."}),
                ),
            )
                .into_response();
        }
    };

    (StatusCode::OK, axum::Json(files)).into_response()
}

async fn api_drive_file(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let api = state.api_client();
    let file = match tokio::task::spawn_blocking(move || api.metadata(&id)).await {
        Ok(Ok(file)) => file,
        Ok(Err(e)) => {
            return (
                StatusCode::NOT_FOUND,
                axum::Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response();
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response();
        }
    };

    (StatusCode::OK, axum::Json(file)).into_response()
}

async fn api_get_file_subtitle(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let db = match CustomStore::open(&state.db_path) {
        Ok(db) => db,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response();
        }
    };
    match db.get_video_subtitle(&id) {
        Ok(Some(cfg)) => (StatusCode::OK, axum::Json(cfg)).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            axum::Json(serde_json::json!({"message": "No subtitle config found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn api_save_file_subtitle(
    State(state): State<AppState>,
    Path(id): Path<String>,
    axum::Json(cfg): axum::Json<VideoSubtitleConfig>,
) -> impl IntoResponse {
    let db = match CustomStore::open(&state.db_path) {
        Ok(db) => db,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response();
        }
    };
    match db.save_video_subtitle(&id, &cfg) {
        Ok(_) => (
            StatusCode::OK,
            axum::Json(serde_json::json!({"success": true})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn api_routes(State(state): State<AppState>) -> impl IntoResponse {
    let db = match Store::open(&state.db_path) {
        Ok(db) => db,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };

    let endpoints = db.endpoints().unwrap_or_default();
    let (current_ip, current_sni) = state.engine.client().active_route();

    let res = serde_json::json!({
        "current_ip": current_ip.map(|i| i.to_string()),
        "current_sni": current_sni,
        "endpoints": endpoints.into_iter().map(|e| serde_json::json!({
            "ip": e.ip,
            "latency_ms": e.latency_ms,
            "error": e.error,
            "sni": e.sni,
        })).collect::<Vec<_>>(),
    });

    (StatusCode::OK, axum::Json(res)).into_response()
}

async fn api_trigger_scan(State(state): State<AppState>) -> impl IntoResponse {
    let db_path = state.db_path.clone();
    tokio::task::spawn_blocking(move || {
        if let Ok(db) = Store::open(&db_path) {
            let _ = scan::run(&db, None, false);
        }
    });

    (
        StatusCode::ACCEPTED,
        axum::Json(serde_json::json!({"status": "scan_started"})),
    )
}

#[derive(Deserialize)]
struct SwitchRouteReq {
    ip: String,
    sni: Option<String>,
}

async fn api_switch_route(
    State(state): State<AppState>,
    axum::Json(req): axum::Json<SwitchRouteReq>,
) -> impl IntoResponse {
    let ip: Option<std::net::IpAddr> = if req.ip == "system" || req.ip.is_empty() {
        None
    } else {
        match req.ip.parse() {
            Ok(ip) => Some(ip),
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    axum::Json(serde_json::json!({"error": format!("Invalid IP: {e}")})),
                )
                    .into_response();
            }
        }
    };

    let sni = req.sni.filter(|s| !s.is_empty());

    // Switch both the stream engine client and the drive API client
    if let Err(e) = state.engine.client().switch_route(ip, sni.clone()) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response();
    }
    if let Ok(mut lock) = state.api.write() {
        let current_account = lock.account.clone();
        let backups = if let Ok(db) = Store::open(&state.db_path) {
            let google = crate::ranges::current(&db);
            scan::usable(db.routes(16).unwrap_or_default(), &google, false)
                .into_iter()
                .filter(|r| Some(r.ip) != ip)
                .map(|r| (r.ip, (!r.sni.is_empty()).then_some(r.sni)))
                .take(8)
                .collect()
        } else {
            Vec::new()
        };

        if let Ok(new_api) = Api::new(
            state.db_path.clone(),
            current_account,
            ip,
            sni.clone(),
            true,
        ) {
            *lock = new_api.with_backups(backups);
        }
    }

    if let (Some(ip_addr), Ok(db)) = (ip, Store::open(&state.db_path)) {
        let _ = db.set_sni(&ip_addr.to_string(), sni.as_deref().unwrap_or_default());
        let _ = db.set("preferred_direct_ip", &ip_addr.to_string());
    }

    (
        StatusCode::OK,
        axum::Json(serde_json::json!({
            "success": true,
            "current_ip": ip.map(|i| i.to_string()),
            "current_sni": sni,
        })),
    )
        .into_response()
}

async fn api_get_config(State(state): State<AppState>) -> impl IntoResponse {
    let cfg = state.engine.config();
    (StatusCode::OK, axum::Json(cfg))
}

async fn api_update_config(
    State(state): State<AppState>,
    axum::Json(new_cfg): axum::Json<StreamConfig>,
) -> impl IntoResponse {
    state.engine.update_config(new_cfg.clone());
    let _ = state.engine.client().set_proxy(new_cfg.proxy_url.clone());
    if let Ok(db) = Store::open(&state.db_path) {
        if let Ok(json_str) = serde_json::to_string(&new_cfg) {
            let _ = db.set("stream_config", &json_str);
        }
    }
    (StatusCode::OK, axum::Json(new_cfg))
}

async fn api_get_sessions(State(state): State<AppState>) -> impl IntoResponse {
    let sessions = state.engine.active_sessions();
    (StatusCode::OK, axum::Json(sessions))
}

async fn api_terminate_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let success = state.engine.terminate_session(&id);
    (
        StatusCode::OK,
        axum::Json(serde_json::json!({"terminated": success})),
    )
}

#[derive(Deserialize)]
struct StrmQuery {
    folder: Option<String>,
    base_url: Option<String>,
    token: Option<String>,
}

async fn api_strm_export(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<StrmQuery>,
) -> Response {
    let folder_id = query.folder.unwrap_or_else(|| "root".into());
    let token = query.token;

    let base_url = query.base_url.unwrap_or_else(|| {
        let host = headers
            .get(header::HOST)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("localhost:8080");
        format!("http://{host}")
    });

    let api = state.api_client();
    let zip_res = tokio::task::spawn_blocking(move || {
        export_strm_zip(&api, &folder_id, &base_url, token.as_deref())
    })
    .await;

    match zip_res {
        Ok(Ok(bytes)) => (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, "application/zip"),
                (
                    header::CONTENT_DISPOSITION,
                    "attachment; filename=\"emby_strm_library.zip\"",
                ),
            ],
            bytes,
        )
            .into_response(),
        _ => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn api_strm_single(
    State(_state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<StrmQuery>,
) -> Response {
    let host = headers
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("localhost:8080");
    let base_url = query.base_url.unwrap_or_else(|| format!("http://{host}"));

    let strm_text = generate_strm_content(&base_url, &id, query.token.as_deref());
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "text/plain; charset=utf-8"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"video.strm\"",
            ),
        ],
        strm_text,
    )
        .into_response()
}

#[derive(Deserialize)]
struct CreateTicketReq {
    file_id: String,
}

async fn api_create_ticket(axum::Json(req): axum::Json<CreateTicketReq>) -> impl IntoResponse {
    let ticket = generate_signed_ticket(&req.file_id);
    (
        StatusCode::OK,
        axum::Json(serde_json::json!({
            "file_id": req.file_id,
            "ticket": ticket,
            "expires_in_hours": 4
        })),
    )
}

// --- Static Asset / SPA Fallback Handler ---

#[cfg(feature = "web")]
async fn static_asset_handler(uri: axum::http::Uri) -> Response {
    let path = uri.path().trim_start_matches('/');

    // 1. Try exact path match in embedded assets
    if let Some(file) = Assets::get(path) {
        let mime = mime_guess::from_path(path)
            .first_or_octet_stream()
            .to_string();
        return (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, mime),
                (
                    header::CACHE_CONTROL,
                    "public, max-age=31536000".to_string(),
                ),
            ],
            file.data,
        )
            .into_response();
    }

    // 2. SPA Fallback: serve index.html for all non-asset paths
    if let Some(index) = Assets::get("index.html") {
        return (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, "text/html; charset=utf-8".to_string()),
                (header::CACHE_CONTROL, "no-cache".to_string()),
            ],
            index.data,
        )
            .into_response();
    }

    StatusCode::NOT_FOUND.into_response()
}

#[cfg(not(feature = "web"))]
async fn static_asset_handler(_uri: axum::http::Uri) -> Response {
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        "gdirect running in headless mode (compiled without embedded web console)\n",
    )
        .into_response()
}

pub struct ServeConfig {
    pub host: String,
    pub port: u16,
    pub api_key: Option<String>,
    pub webdav_redirect: bool,
    pub chunk_kb: usize,
    pub prefetch_chunks: usize,
    pub connections: usize,
    pub db_path: PathBuf,
    pub account: Option<String>,
    pub ip: std::net::IpAddr,
    pub sni: Option<String>,
    pub auto: bool,
    pub backups: Vec<crate::api::Endpoint>,
}

pub fn run_serve(cfg: ServeConfig) -> anyhow::Result<()> {
    let api = Api::new(
        cfg.db_path.clone(),
        cfg.account.clone(),
        Some(cfg.ip),
        cfg.sni.clone(),
        cfg.auto,
    )?
    .with_backups(cfg.backups.clone());

    let async_client =
        AsyncDirectClient::new(cfg.db_path.clone(), Some(cfg.ip), cfg.sni.clone(), cfg.auto)?
            .with_backups(cfg.backups.clone());

    let db = Store::open(&cfg.db_path)?;
    let saved_config = db
        .setting("stream_config")
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str::<StreamConfig>(&s).ok());

    let stream_config = saved_config.unwrap_or(StreamConfig {
        chunk_size: cfg.chunk_kb * 1024,
        prefetch_chunks: cfg.prefetch_chunks,
        concurrency: cfg.connections,
        webdav_redirect: cfg.webdav_redirect,
        master_api_key: cfg.api_key.clone(),
        stream_mode: Some("direct".into()),
        proxy_url: None,
    });

    let engine = StreamEngine::new(async_client, stream_config);
    let api_rwlock = Arc::new(std::sync::RwLock::new(api));
    let webdav = WebDavTree::new(api_rwlock.clone());

    let state = AppState {
        api: api_rwlock,
        engine: engine.clone(),
        webdav,
        db_path: cfg.db_path.clone(),
        start_time: std::time::Instant::now(),
    };

    let router = create_router(state.clone());
    let bind_addr = format!("{}:{}", cfg.host, cfg.port);

    println!("============================================================");
    println!("       🚀 gdirect Streaming Gateway & Media Platform       ");
    println!("============================================================");
    println!(
        " 🌐 Web Management Panel : http://{}:{}",
        cfg.host, cfg.port
    );
    println!(
        " 🎬 Stream Endpoint      : http://{}:{}/stream/{{file_id}}",
        cfg.host, cfg.port
    );
    println!(
        " 📁 WebDAV Endpoint      : http://{}:{}/webdav/ (302: {})",
        cfg.host, cfg.port, cfg.webdav_redirect
    );
    println!(
        " 🍿 Emby .strm Generator : http://{}:{}/api/strm/export?folder=root",
        cfg.host, cfg.port
    );
    println!(
        " ⚡ Direct Google Edge IP: {} (SNI: {})",
        cfg.ip,
        cfg.sni.as_deref().unwrap_or("real")
    );
    println!(
        " 👤 Active Account       : {}",
        cfg.account.as_deref().unwrap_or("None (public files only)")
    );
    if cfg.api_key.is_some() {
        println!(" 🔒 Authentication       : Master API Key enabled");
    } else {
        println!(" 🔓 Authentication       : Open (No Master API Key set)");
    }
    println!(
        " 💾 RAM Buffer Policy    : ZERO disk caching! (Chunk: {}KB, Prefetch: {}MB)",
        cfg.chunk_kb,
        (cfg.chunk_kb * cfg.prefetch_chunks) / 1024
    );
    println!("============================================================");

    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;

    // Non-blocking background probe for optimal Google Edge IP
    let bg_state = state.clone();
    let bg_db_path = cfg.db_path.clone();
    rt.spawn(async move {
        // Yield 2 seconds to let the HTTP/WebDAV server start up immediately without blocking
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        let _ = tokio::task::spawn_blocking(move || {
            if let Ok(db) = Store::open(&bg_db_path) {
                let google = crate::ranges::current(&db);
                let routes = scan::usable(db.routes(8).unwrap_or_default(), &google, false);
                if routes.is_empty() {
                    let _ = scan::run(&db, None, false);
                }
                if let Some(recovered) = recover_best_api(&bg_state) {
                    if let Ok(mut lock) = bg_state.api.write() {
                        *lock = recovered;
                    }
                }
            }
        })
        .await;
    });

    rt.block_on(async {
        let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
        axum::serve(listener, router).await?;
        Ok::<(), anyhow::Error>(())
    })?;

    Ok(())
}
