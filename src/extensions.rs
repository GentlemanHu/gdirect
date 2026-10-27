use anyhow::{Context, Result, bail};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::path::Path;

// --- Custom SQLite Store Extension ---

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct VideoSubtitleConfig {
    pub primary_sub_id: Option<String>,
    pub primary_sub_name: Option<String>,
    pub secondary_sub_id: Option<String>,
    pub secondary_sub_name: Option<String>,
    pub sub_offset: f64,
}

pub struct CustomStore {
    conn: Connection,
}

impl CustomStore {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS search_cache(
                account TEXT NOT NULL,
                query TEXT NOT NULL,
                json TEXT NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY(account, query)
            );
            CREATE TABLE IF NOT EXISTS video_subtitles(
                file_id TEXT PRIMARY KEY,
                primary_sub_id TEXT,
                primary_sub_name TEXT,
                secondary_sub_id TEXT,
                secondary_sub_name TEXT,
                sub_offset REAL DEFAULT 0.0,
                updated_at INTEGER NOT NULL
            );",
        )?;
        Ok(Self { conn })
    }

    pub fn cache_search(&self, account: &str, query: &str, json: &str) -> Result<()> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs() as i64;
        self.conn.execute(
            "INSERT OR REPLACE INTO search_cache VALUES(?,?,?,?)",
            params![account, query, json, now],
        )?;
        Ok(())
    }

    pub fn cached_search(&self, account: &str, query: &str) -> Result<Option<String>> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs() as i64;
        // Valid for 6 hours (21600 seconds)
        Ok(self
            .conn
            .query_row(
                "SELECT json FROM search_cache WHERE account=? AND query=? AND updated_at > ?",
                params![account, query, now - 21600],
                |r| r.get(0),
            )
            .optional()?)
    }

    pub fn save_video_subtitle(&self, file_id: &str, cfg: &VideoSubtitleConfig) -> Result<()> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs() as i64;
        self.conn.execute(
            "INSERT OR REPLACE INTO video_subtitles(
                file_id, primary_sub_id, primary_sub_name, secondary_sub_id, secondary_sub_name, sub_offset, updated_at
            ) VALUES(?, ?, ?, ?, ?, ?, ?)",
            params![
                file_id,
                cfg.primary_sub_id,
                cfg.primary_sub_name,
                cfg.secondary_sub_id,
                cfg.secondary_sub_name,
                cfg.sub_offset,
                now
            ],
        )?;
        Ok(())
    }

    pub fn get_video_subtitle(&self, file_id: &str) -> Result<Option<VideoSubtitleConfig>> {
        Ok(self
            .conn
            .query_row(
                "SELECT primary_sub_id, primary_sub_name, secondary_sub_id, secondary_sub_name, sub_offset FROM video_subtitles WHERE file_id=?",
                [file_id],
                |r| {
                    Ok(VideoSubtitleConfig {
                        primary_sub_id: r.get(0)?,
                        primary_sub_name: r.get(1)?,
                        secondary_sub_id: r.get(2)?,
                        secondary_sub_name: r.get(3)?,
                        sub_offset: r.get(4)?,
                    })
                },
            )
            .optional()?)
    }
}

// --- Service Account Authentication Extension ---

const TOKEN_URI: &str = "https://oauth2.googleapis.com/token";
const SCOPE: &str = "https://www.googleapis.com/auth/drive";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ServiceAccount {
    pub client_email: String,
    pub private_key: String,
    #[serde(default = "default_token_uri")]
    pub token_uri: String,
}

fn default_token_uri() -> String {
    TOKEN_URI.to_string()
}

#[derive(Serialize)]
struct SaClaims<'a> {
    iss: &'a str,
    scope: &'a str,
    aud: &'a str,
    exp: u64,
    iat: u64,
}

pub fn get_service_account_token(sa: &ServiceAccount) -> Result<crate::auth::Token> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_secs();

    let claims = SaClaims {
        iss: &sa.client_email,
        scope: SCOPE,
        aud: &sa.token_uri,
        exp: now + 3600,
        iat: now,
    };

    let header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256);
    let key = jsonwebtoken::EncodingKey::from_rsa_pem(sa.private_key.as_bytes())
        .context("Invalid Service Account RSA private key")?;

    let assertion = jsonwebtoken::encode(&header, &claims, &key)
        .context("Failed to sign Service Account JWT")?;

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()?;

    let response = client
        .post(&sa.token_uri)
        .form(&[
            ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
            ("assertion", &assertion),
        ])
        .send()
        .map_err(|e| anyhow::anyhow!("Failed to request token from {}: {}", sa.token_uri, e))?;

    let status = response.status();
    let data: serde_json::Value = response.json()?;
    crate::auth::refreshed(status, &data)
}

#[allow(dead_code)]
pub fn refresh_token_for_account(
    db: &crate::store::Store,
    account: Option<&str>,
) -> Result<crate::auth::Token> {
    if let Some(raw) = account.map(|a| db.credentials(a)).transpose()?.flatten() {
        let val: serde_json::Value = serde_json::from_str(&raw)?;
        if val.get("type").and_then(|t| t.as_str()) == Some("service_account") {
            let sa: ServiceAccount = serde_json::from_value(val)?;
            return get_service_account_token(&sa);
        } else {
            let creds = crate::auth::Credentials::parse(raw.as_bytes())?;
            return crate::auth::refresh(&creds);
        }
    }
    bail!("First login requires a Desktop OAuth client JSON or Service Account JSON")
}

// --- Api Extension Trait ---

pub trait ApiExt {
    fn search_files(&self, query_str: &str) -> Result<Vec<crate::api::File>>;
    fn account_for_token_ext(&self, token: &str) -> Result<String>;
}

impl ApiExt for crate::api::Api {
    fn search_files(&self, query_str: &str) -> Result<Vec<crate::api::File>> {
        let account = self.account.as_deref().unwrap_or_default();
        if let Ok(store) = CustomStore::open(&self.db) {
            if let Ok(Some(cached_json)) = store.cached_search(account, query_str) {
                if let Ok(cached_files) =
                    serde_json::from_str::<Vec<crate::api::File>>(&cached_json)
                {
                    return Ok(cached_files);
                }
            }
        }

        let token = self.token()?;
        let mut files = Vec::new();
        let mut page = String::new();
        let escaped = query_str.replace('\\', "\\\\").replace('\'', "\\'");
        let q = format!("name contains '{escaped}' and trashed = false");

        loop {
            let mut query = vec![
                ("q".to_string(), q.clone()),
                (
                    "fields".to_string(),
                    "nextPageToken,files(id,name,mimeType,size,modifiedTime,md5Checksum,resourceKey)".to_string(),
                ),
                ("pageSize".to_string(), "100".to_string()),
                ("supportsAllDrives".to_string(), "true".to_string()),
                ("includeItemsFromAllDrives".to_string(), "true".to_string()),
            ];
            if !page.is_empty() {
                query.push(("pageToken".to_string(), page));
            }

            let response = self.deliver(|client, forged| {
                client
                    .get(crate::api::url_for(forged, "drive/v3/files"))
                    .query(&query)
                    .bearer_auth(&token)
            })?;

            let data: serde_json::Value = response.json()?;
            if let Some(list) = data["files"].as_array() {
                files.extend(serde_json::from_value::<Vec<crate::api::File>>(
                    serde_json::Value::Array(list.clone()),
                )?);
            }
            page = data["nextPageToken"]
                .as_str()
                .unwrap_or_default()
                .to_owned();
            if page.is_empty() || files.len() >= 200 {
                break;
            }
        }

        if let Ok(store) = CustomStore::open(&self.db) {
            let _ = store.cache_search(account, query_str, &serde_json::to_string(&files)?);
        }
        Ok(files)
    }

    fn account_for_token_ext(&self, token: &str) -> Result<String> {
        let response = self.deliver(|client, forged| {
            client
                .get(crate::api::url_for(forged, "drive/v3/about"))
                .query(&[("fields", "user(emailAddress)")])
                .bearer_auth(token)
        })?;
        let data: serde_json::Value = response.json()?;
        let email = data["user"]["emailAddress"]
            .as_str()
            .context("Google returned invalid user info")?;
        Ok(email.to_string())
    }
}
