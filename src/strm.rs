use anyhow::Result;
use std::io::{Cursor, Write};
use zip::{ZipWriter, write::SimpleFileOptions};

use crate::api::{Api, File};

pub const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "ts", "iso", "rmvb", "m2ts",
];

pub fn is_video_file(file: &File) -> bool {
    if file.folder() {
        return false;
    }
    if file.mime_type.starts_with("video/") {
        return true;
    }
    let lower = file.name.to_lowercase();
    VIDEO_EXTENSIONS
        .iter()
        .any(|ext| lower.ends_with(&format!(".{ext}")))
}

/// Generate .strm content for a single file
pub fn generate_strm_content(base_url: &str, file_id: &str, token: Option<&str>) -> String {
    let base = base_url.trim_end_matches('/');
    if let Some(tok) = token {
        if !tok.is_empty() {
            return format!("{base}/stream/{file_id}?token={tok}\n");
        }
    }
    format!("{base}/stream/{file_id}\n")
}

/// Recursively collect all video files in a Google Drive folder
pub fn collect_video_files_recursive(
    api: &Api,
    folder_id: &str,
    current_path: &str,
    results: &mut Vec<(String, File)>, // (relative_path, File)
) -> Result<()> {
    let items = api.list(folder_id)?;
    for item in items {
        if item.folder() {
            let next_path = if current_path.is_empty() {
                clean_filename(&item.name)
            } else {
                format!("{}/{}", current_path, clean_filename(&item.name))
            };
            // Recurse into subfolder
            let _ = collect_video_files_recursive(api, &item.id, &next_path, results);
        } else if is_video_file(&item) {
            results.push((current_path.to_string(), item));
        }
    }
    Ok(())
}

/// Clean filenames for filesystem compatibility in .strm paths
pub fn clean_filename(name: &str) -> String {
    name.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_")
}

/// Generate a ZIP archive containing all .strm files for Emby
pub fn export_strm_zip(
    api: &Api,
    folder_id: &str,
    base_url: &str,
    token: Option<&str>,
) -> Result<Vec<u8>> {
    let mut files = Vec::new();
    collect_video_files_recursive(api, folder_id, "", &mut files)?;

    let buffer = Vec::new();
    let mut zip = ZipWriter::new(Cursor::new(buffer));
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);

    for (rel_path, file) in files {
        let clean_name = clean_filename(&file.name);
        // Strip media extension and add .strm
        let stem = std::path::Path::new(&clean_name)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(&clean_name);
        let strm_filename = format!("{stem}.strm");

        let zip_path = if rel_path.is_empty() {
            strm_filename
        } else {
            format!("{rel_path}/{strm_filename}")
        };

        zip.start_file(zip_path, options)?;
        let content = generate_strm_content(base_url, &file.id, token);
        zip.write_all(content.as_bytes())?;
    }

    let cursor = zip.finish()?;
    Ok(cursor.into_inner())
}
