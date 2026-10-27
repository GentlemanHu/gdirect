use anyhow::{Context, Result};
use axum::{
    extract::Request,
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use std::{collections::HashMap, sync::Arc};
use tokio::sync::RwLock;

use crate::{
    api::{Api, File},
    auth_middleware::generate_signed_ticket,
    stream::{StreamEngine, parse_range},
};

/// WebDAV directory node cache
#[derive(Clone)]
pub struct WebDavTree {
    api: Arc<std::sync::RwLock<Api>>,
    // Path -> (file_id, is_folder)
    path_cache: Arc<RwLock<HashMap<String, (String, bool)>>>,
    // FolderID -> Vec<File>
    folder_cache: Arc<RwLock<HashMap<String, (Vec<File>, std::time::Instant)>>>,
}

impl WebDavTree {
    pub fn new(api: Arc<std::sync::RwLock<Api>>) -> Self {
        let mut path_cache = HashMap::new();
        path_cache.insert("".to_string(), ("root".to_string(), true));
        path_cache.insert("/".to_string(), ("root".to_string(), true));

        Self {
            api,
            path_cache: Arc::new(RwLock::new(path_cache)),
            folder_cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// List items in a folder with 30-second TTL cache
    pub async fn list_folder(&self, folder_id: &str) -> Result<Vec<File>> {
        {
            let cache = self.folder_cache.read().await;
            if let Some((files, inst)) = cache.get(folder_id) {
                if inst.elapsed() < std::time::Duration::from_secs(30) {
                    return Ok(files.clone());
                }
            }
        }

        let api = self.api.read().unwrap().clone();
        let fid = folder_id.to_string();
        let files = tokio::task::spawn_blocking(move || api.list(&fid)).await??;

        {
            let mut cache = self.folder_cache.write().await;
            cache.insert(
                folder_id.to_string(),
                (files.clone(), std::time::Instant::now()),
            );
        }

        Ok(files)
    }

    /// Resolve a URL path like "/Movies/Action/Film.mp4" to (FileRef, is_folder)
    pub async fn resolve_path(&self, raw_path: &str) -> Result<(File, bool)> {
        {
            let cache = self.path_cache.read().await;
            if let Some((cached_id, is_folder)) = cache.get(raw_path) {
                let api = self.api.read().unwrap().clone();
                let cid = cached_id.clone();
                if let Ok(Ok(file)) = tokio::task::spawn_blocking(move || api.metadata(&cid)).await
                {
                    return Ok((file, *is_folder));
                }
            }
        }

        let clean = raw_path
            .trim_matches('/')
            .split('/')
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>();

        if clean.is_empty() {
            let root_file = File {
                id: "root".into(),
                name: "root".into(),
                mime_type: "application/vnd.google-apps.folder".into(),
                size: None,
                modified_time: None,
                md5_checksum: None,
                resource_key: None,
            };
            return Ok((root_file, true));
        }

        // Support direct access via /webdav/id/{file_id}
        if clean.len() == 2 && clean[0] == "id" {
            let api = self.api.read().unwrap().clone();
            let fid = clean[1].to_string();
            let file = tokio::task::spawn_blocking(move || api.metadata(&fid)).await??;
            let is_folder = file.folder();
            return Ok((file, is_folder));
        }

        // Walk path segments from root
        let mut current_id = "root".to_string();
        let mut current_file = None;

        for (i, segment) in clean.iter().enumerate() {
            let is_last = i == clean.len() - 1;
            let items = self.list_folder(&current_id).await?;

            let found = items
                .into_iter()
                .find(|item| item.name.eq_ignore_ascii_case(segment));

            match found {
                Some(item) => {
                    if is_last {
                        let is_dir = item.folder();
                        return Ok((item, is_dir));
                    }
                    if !item.folder() {
                        anyhow::bail!("Segment is not a folder: {segment}");
                    }
                    current_id = item.id.clone();
                    current_file = Some(item);
                }
                None => anyhow::bail!("Path not found: {segment}"),
            }
        }

        let resolved = current_file
            .map(|f| {
                let is_dir = f.folder();
                (f, is_dir)
            })
            .context("Empty path resolution")?;

        {
            let mut cache = self.path_cache.write().await;
            cache.insert(raw_path.to_string(), (resolved.0.id.clone(), resolved.1));
        }

        Ok(resolved)
    }
}

/// Escape XML special characters
fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Handle WebDAV requests (OPTIONS, PROPFIND, GET, HEAD)
pub async fn handle_webdav(tree: WebDavTree, engine: StreamEngine, req: Request) -> Response {
    let method = req.method().clone();
    let uri = req.uri().clone();
    let headers = req.headers().clone();
    let path = uri.path().trim_start_matches("/webdav");

    match method.as_str() {
        "OPTIONS" => handle_options(),
        "PROPFIND" => handle_propfind(tree, path, headers).await,
        "HEAD" => handle_head(tree, path).await,
        "GET" => handle_get(tree, engine, path, headers).await,
        _ => StatusCode::METHOD_NOT_ALLOWED.into_response(),
    }
}

fn handle_options() -> Response {
    let mut res = StatusCode::OK.into_response();
    let h = res.headers_mut();
    h.insert("DAV", HeaderValue::from_static("1, 2"));
    h.insert("MS-Author-Via", HeaderValue::from_static("DAV"));
    h.insert(
        header::ALLOW,
        HeaderValue::from_static("OPTIONS, GET, HEAD, PROPFIND"),
    );
    res
}

async fn handle_propfind(tree: WebDavTree, path: &str, headers: HeaderMap) -> Response {
    let depth = headers
        .get("Depth")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("1");

    let (file, is_folder) = match tree.resolve_path(path).await {
        Ok(res) => res,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };

    let mut xml = String::from(
        "<?xml version=\"1.0\" encoding=\"utf-8\" ?>\n<D:multistatus xmlns:D=\"DAV:\">\n",
    );

    let clean_path = path.trim_matches('/');
    let current_href = if clean_path.is_empty() {
        "/webdav/".to_string()
    } else if is_folder {
        format!("/webdav/{clean_path}/")
    } else {
        format!("/webdav/{clean_path}")
    };

    // 1. Add current target item
    xml.push_str(&render_prop_entry(
        &current_href,
        &file.name,
        is_folder,
        file.size
            .as_deref()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0),
        file.modified_time.as_deref().unwrap_or(""),
    ));

    // 2. If folder and depth == "1", add direct children
    if is_folder && depth != "0" {
        if let Ok(children) = tree.list_folder(&file.id).await {
            for child in children {
                let child_is_dir = child.folder();
                let child_clean = crate::strm::clean_filename(&child.name);
                let child_href = if clean_path.is_empty() {
                    if child_is_dir {
                        format!("/webdav/{child_clean}/")
                    } else {
                        format!("/webdav/{child_clean}")
                    }
                } else if child_is_dir {
                    format!("/webdav/{clean_path}/{child_clean}/")
                } else {
                    format!("/webdav/{clean_path}/{child_clean}")
                };

                let size = child
                    .size
                    .as_deref()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);
                let mtime = child.modified_time.as_deref().unwrap_or("");
                xml.push_str(&render_prop_entry(
                    &child_href,
                    &child.name,
                    child_is_dir,
                    size,
                    mtime,
                ));
            }
        }
    }

    xml.push_str("</D:multistatus>");

    (
        StatusCode::MULTI_STATUS,
        [(header::CONTENT_TYPE, "application/xml; charset=utf-8")],
        xml,
    )
        .into_response()
}

fn render_prop_entry(
    href: &str,
    display_name: &str,
    is_dir: bool,
    size: u64,
    mtime: &str,
) -> String {
    let esc_href = xml_escape(href);
    let esc_name = xml_escape(display_name);
    let date_str = if mtime.is_empty() {
        "Wed, 01 Jan 2026 00:00:00 GMT"
    } else {
        mtime
    };

    if is_dir {
        format!(
            "  <D:response>\n    <D:href>{esc_href}</D:href>\n    <D:propstat>\n      <D:prop>\n        <D:displayname>{esc_name}</D:displayname>\n        <D:resourcetype><D:collection/></D:resourcetype>\n        <D:getlastmodified>{date_str}</D:getlastmodified>\n      </D:prop>\n      <D:status>HTTP/1.1 200 OK</D:status>\n    </D:propstat>\n  </D:response>\n"
        )
    } else {
        let mime = mime_guess::from_path(display_name)
            .first_or_octet_stream()
            .to_string();
        format!(
            "  <D:response>\n    <D:href>{esc_href}</D:href>\n    <D:propstat>\n      <D:prop>\n        <D:displayname>{esc_name}</D:displayname>\n        <D:getcontentlength>{size}</D:getcontentlength>\n        <D:getcontenttype>{mime}</D:getcontenttype>\n        <D:getlastmodified>{date_str}</D:getlastmodified>\n        <D:resourcetype/>\n      </D:prop>\n      <D:status>HTTP/1.1 200 OK</D:status>\n    </D:propstat>\n  </D:response>\n"
        )
    }
}

async fn handle_head(tree: WebDavTree, path: &str) -> Response {
    let (file, is_folder) = match tree.resolve_path(path).await {
        Ok(res) => res,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };

    if is_folder {
        return (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, "httpd/unix-directory"),
                (header::ACCEPT_RANGES, "none"),
            ],
        )
            .into_response();
    }

    let size = file
        .size
        .as_deref()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let mime = mime_guess::from_path(&file.name)
        .first_or_octet_stream()
        .to_string();

    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, mime),
            (header::CONTENT_LENGTH, size.to_string()),
            (header::ACCEPT_RANGES, "bytes".to_string()),
        ],
    )
        .into_response()
}

async fn handle_get(
    tree: WebDavTree,
    engine: StreamEngine,
    path: &str,
    headers: HeaderMap,
) -> Response {
    let (file, is_folder) = match tree.resolve_path(path).await {
        Ok(res) => res,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };

    if is_folder {
        return StatusCode::BAD_REQUEST.into_response();
    }

    let cfg = engine.config();
    let force_direct = headers
        .get("x-webdav-direct")
        .and_then(|v| v.to_str().ok())
        .map(|s| s == "true" || s == "1")
        .unwrap_or(false);

    // Mode A: 302 Redirect (Preferred for OpenList)
    if cfg.webdav_redirect && !force_direct {
        let ticket = generate_signed_ticket(&file.id);
        let redirect_url = format!("/stream/{}?ticket={}", file.id, ticket);
        return (StatusCode::FOUND, [(header::LOCATION, redirect_url)]).into_response();
    }

    // Mode B: Direct 206 Range Stream
    let total_size = file
        .size
        .as_deref()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let mime = mime_guess::from_path(&file.name)
        .first_or_octet_stream()
        .to_string();

    let range_str = headers.get(header::RANGE).and_then(|v| v.to_str().ok());

    let (start, end) = match range_str {
        Some(r) => match parse_range(r, total_size) {
            Some(range) => range,
            None => {
                return (
                    StatusCode::RANGE_NOT_SATISFIABLE,
                    [(header::CONTENT_RANGE, format!("bytes */{total_size}"))],
                )
                    .into_response();
            }
        },
        None => (0, total_size.saturating_sub(1)),
    };

    let download_url = format!(
        "https://www.googleapis.com/drive/v3/files/{}?alt=media&supportsAllDrives=true",
        file.id
    );
    let token = tree.api.read().unwrap().token().ok();

    let stream = match engine
        .create_range_stream(
            file.id.clone(),
            file.name.clone(),
            download_url,
            token,
            "webdav-client".to_string(),
            start,
            end,
            total_size,
        )
        .await
    {
        Ok(body) => body,
        Err(e) => {
            eprintln!("WebDAV stream failed: {e:?}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };

    let content_len = (end - start + 1).to_string();
    let content_range = format!("bytes {start}-{end}/{total_size}");

    let mut res = (StatusCode::PARTIAL_CONTENT, stream).into_response();
    let h = res.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_str(&mime).unwrap());
    h.insert(
        header::CONTENT_LENGTH,
        HeaderValue::from_str(&content_len).unwrap(),
    );
    h.insert(
        header::CONTENT_RANGE,
        HeaderValue::from_str(&content_range).unwrap(),
    );
    h.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    res
}
