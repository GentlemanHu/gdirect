use axum::http::HeaderMap;
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

const SIGNING_SECRET: &[u8] = b"gdirect-secret-key-google-streaming-matrix-2026";
const TICKET_TTL_SECS: u64 = 4 * 3600; // 4 hours for streaming tickets

fn compute_hash(file_id: &str, expires_at: u64) -> String {
    let mut hasher = Sha256::new();
    hasher.update(SIGNING_SECRET);
    hasher.update(b":");
    hasher.update(file_id.as_bytes());
    hasher.update(b":");
    hasher.update(expires_at.to_string().as_bytes());
    hex::encode(hasher.finalize())
}

/// Generate a signed playback ticket for a given file ID
pub fn generate_signed_ticket(file_id: &str) -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let expires_at = now + TICKET_TTL_SECS;
    let sig = compute_hash(file_id, expires_at);
    format!("{expires_at}.{sig}")
}

/// Verify a signed ticket for a given file ID
pub fn verify_signed_ticket(file_id: &str, ticket: &str) -> bool {
    let mut parts = ticket.split('.');
    let Some(expires_str) = parts.next() else {
        return false;
    };
    let Some(sig) = parts.next() else {
        return false;
    };

    let Ok(expires_at) = expires_str.parse::<u64>() else {
        return false;
    };

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    if now > expires_at {
        return false; // Expired
    }

    let expected_sig = compute_hash(file_id, expires_at);
    sig == expected_sig
}

/// Check if a request has valid authentication (API Key, Media Token, or Ticket)
pub fn is_authorized(
    headers: &HeaderMap,
    query_token: Option<&str>,
    query_ticket: Option<&str>,
    file_id: Option<&str>,
    configured_key: Option<&str>,
) -> bool {
    // 1. If no master key is set, allow access
    let Some(master_key) = configured_key else {
        return true;
    };

    if master_key.trim().is_empty() {
        return true;
    }

    // 2. Check X-API-Key header
    if let Some(val) = headers.get("x-api-key") {
        if let Ok(s) = val.to_str() {
            if s == master_key {
                return true;
            }
        }
    }

    // 3. Check Authorization header
    if let Some(val) = headers.get("authorization") {
        if let Ok(s) = val.to_str() {
            if let Some(token) = s.strip_prefix("Bearer ") {
                if token == master_key {
                    return true;
                }
            }
        }
    }

    // 4. Check query token
    if let Some(tok) = query_token {
        if tok == master_key {
            return true;
        }
    }

    // 5. Check signed ticket (for streaming endpoints)
    if let (Some(f_id), Some(ticket)) = (file_id, query_ticket) {
        if verify_signed_ticket(f_id, ticket) {
            return true;
        }
    }

    false
}
