use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::AppHandle;

use super::settings::get_stored_supabase_config;

const BUCKET_NAME: &str = "cladel";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteFileInfo {
    pub name: String,
    pub updated_at: String,
    #[serde(default)]
    pub size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalFileStats {
    pub path: String,
    pub updated_at: String,
    pub size: i64,
    pub node_count: i64,
    pub edge_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteFileStats {
    pub name: String,
    pub updated_at: String,
    pub size: i64,
    pub node_count: i64,
    pub edge_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncStatusResult {
    pub has_remote: bool,
    pub local: Option<LocalFileStats>,
    pub remote: Option<RemoteFileStats>,
    pub is_in_sync: bool,
}

/// Raw response item from Supabase Storage list endpoint.
#[derive(Debug, Deserialize)]
struct StorageListItem {
    name: String,
    #[serde(default)]
    updated_at: String,
    #[serde(default)]
    metadata: Option<StorageItemMetadata>,
}

#[derive(Debug, Deserialize)]
struct StorageItemMetadata {
    #[serde(default)]
    size: i64,
}

fn get_config(app: &AppHandle) -> Result<(String, String), String> {
    get_stored_supabase_config(app).ok_or_else(|| "Supabase is not configured".to_string())
}

fn build_client(anon_key: &str) -> Result<reqwest::Client, String> {
    use reqwest::header::{HeaderMap, HeaderValue};
    let mut headers = HeaderMap::new();
    headers.insert(
        "apikey",
        HeaderValue::from_str(anon_key).map_err(|e| format!("Invalid anon key header: {e}"))?,
    );
    headers.insert(
        "Authorization",
        HeaderValue::from_str(&format!("Bearer {anon_key}"))
            .map_err(|e| format!("Invalid auth header: {e}"))?,
    );
    reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

fn count_nodes_edges(db_path: &str) -> Result<(i64, i64), String> {
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| format!("Failed to open SQLite file: {e}"))?;
    let node_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM nodes WHERE status != 'deleted' AND node_type != 'deleted'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    let edge_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM edges", [], |row| row.get(0))
        .unwrap_or(0);
    Ok((node_count, edge_count))
}

fn file_modified_iso(path: &str) -> Result<String, String> {
    let metadata =
        std::fs::metadata(path).map_err(|e| format!("Failed to read file metadata: {e}"))?;
    let modified = metadata
        .modified()
        .map_err(|e| format!("Failed to get modified time: {e}"))?;
    let dt: chrono::DateTime<chrono::Utc> = modified.into();
    Ok(dt.to_rfc3339())
}

fn file_size(path: &str) -> Result<i64, String> {
    let metadata =
        std::fs::metadata(path).map_err(|e| format!("Failed to read file metadata: {e}"))?;
    Ok(metadata.len() as i64)
}

fn extract_filename(path: &str) -> Result<String, String> {
    Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .map(String::from)
        .ok_or_else(|| "Failed to extract filename from path".to_string())
}

async fn ensure_bucket(client: &reqwest::Client, base_url: &str) -> Result<(), String> {
    let url = format!("{base_url}/storage/v1/bucket");
    let body = serde_json::json!({
        "id": BUCKET_NAME,
        "name": BUCKET_NAME,
        "public": false
    });
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to create bucket: {e}"))?;
    let status = resp.status();
    // 200/201 = created, 409 = already exists — both are fine
    if status.is_success() || status.as_u16() == 409 {
        Ok(())
    } else {
        let text = resp.text().await.unwrap_or_default();
        Err(format!("Failed to create bucket (HTTP {status}): {text}"))
    }
}

#[tauri::command]
pub async fn sync_list_remote(app: AppHandle) -> Result<Vec<RemoteFileInfo>, String> {
    let (base_url, anon_key) = get_config(&app)?;
    let client = build_client(&anon_key)?;

    let url = format!("{base_url}/storage/v1/object/list/{BUCKET_NAME}");
    let body = serde_json::json!({
        "prefix": "",
        "limit": 100,
        "offset": 0
    });

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to list remote files: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        // Empty bucket or bucket not found — return empty list
        if status.as_u16() == 404 {
            return Ok(vec![]);
        }
        return Err(format!("Failed to list remote files (HTTP {status}): {text}"));
    }

    let items: Vec<StorageListItem> = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {e}"))?;

    let results = items
        .into_iter()
        .filter(|item| !item.name.is_empty() && (item.name.ends_with(".cld") || item.name.ends_with(".klv") || item.name.ends_with(".tmgx")))
        .map(|item| RemoteFileInfo {
            name: item.name,
            updated_at: item.updated_at,
            size: item.metadata.map(|m| m.size).unwrap_or(0),
        })
        .collect();

    Ok(results)
}

#[tauri::command]
pub async fn sync_check_status(
    app: AppHandle,
    local_path: String,
) -> Result<SyncStatusResult, String> {
    let (base_url, anon_key) = get_config(&app)?;
    let client = build_client(&anon_key)?;
    let filename = extract_filename(&local_path)?;

    // Local stats
    let local = if Path::new(&local_path).exists() {
        let updated_at = file_modified_iso(&local_path)?;
        let size = file_size(&local_path)?;
        let (node_count, edge_count) = count_nodes_edges(&local_path)?;
        Some(LocalFileStats {
            path: local_path.clone(),
            updated_at,
            size,
            node_count,
            edge_count,
        })
    } else {
        None
    };

    // Check remote via list endpoint filtered by name
    let list_url = format!("{base_url}/storage/v1/object/list/{BUCKET_NAME}");
    let list_body = serde_json::json!({
        "prefix": "",
        "limit": 100,
        "offset": 0,
        "search": filename
    });
    let list_resp = client
        .post(&list_url)
        .json(&list_body)
        .send()
        .await
        .map_err(|e| format!("Failed to check remote: {e}"))?;

    let has_remote;
    let mut remote: Option<RemoteFileStats> = None;

    if list_resp.status().is_success() {
        let items: Vec<StorageListItem> = list_resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse list: {e}"))?;
        let found = items.into_iter().find(|i| i.name == filename);
        if let Some(item) = found {
            has_remote = true;
            let remote_size = item.metadata.map(|m| m.size).unwrap_or(0);
            let remote_updated = item.updated_at.clone();

            // Download to temp to get node/edge counts
            let temp_path = std::env::temp_dir().join(format!("cladel_sync_check_{filename}"));
            let dl_url =
                format!("{base_url}/storage/v1/object/{BUCKET_NAME}/{filename}");
            let dl_resp = client
                .get(&dl_url)
                .send()
                .await
                .map_err(|e| format!("Failed to download for stats: {e}"))?;
            if dl_resp.status().is_success() {
                let bytes = dl_resp
                    .bytes()
                    .await
                    .map_err(|e| format!("Failed to read download: {e}"))?;
                std::fs::write(&temp_path, &bytes)
                    .map_err(|e| format!("Failed to write temp file: {e}"))?;
                let (nc, ec) = count_nodes_edges(temp_path.to_str().unwrap_or(""))?;
                let _ = std::fs::remove_file(&temp_path);
                remote = Some(RemoteFileStats {
                    name: filename.clone(),
                    updated_at: remote_updated,
                    size: remote_size,
                    node_count: nc,
                    edge_count: ec,
                });
            }
        } else {
            has_remote = false;
        }
    } else {
        has_remote = false;
    }

    let is_in_sync = match (&local, &remote) {
        (Some(l), Some(r)) => l.size == r.size && l.updated_at == r.updated_at,
        _ => false,
    };

    Ok(SyncStatusResult {
        has_remote,
        local,
        remote,
        is_in_sync,
    })
}

#[tauri::command]
pub async fn sync_upload(app: AppHandle, local_path: String) -> Result<(), String> {
    let (base_url, anon_key) = get_config(&app)?;
    let client = build_client(&anon_key)?;
    let filename = extract_filename(&local_path)?;

    let bytes =
        std::fs::read(&local_path).map_err(|e| format!("Failed to read local file: {e}"))?;

    let url = format!("{base_url}/storage/v1/object/{BUCKET_NAME}/{filename}");
    let resp = client
        .post(&url)
        .header("Content-Type", "application/octet-stream")
        .header("x-upsert", "true")
        .body(bytes.clone())
        .send()
        .await
        .map_err(|e| format!("Failed to upload: {e}"))?;

    let status = resp.status();
    if status.is_success() {
        return Ok(());
    }

    // Check for bucket-not-found → create bucket and retry
    let text = resp.text().await.unwrap_or_default();
    if status.as_u16() == 404 || text.contains("Bucket not found") {
        ensure_bucket(&client, &base_url).await?;
        // Retry upload
        let retry_resp = client
            .post(&url)
            .header("Content-Type", "application/octet-stream")
            .header("x-upsert", "true")
            .body(bytes)
            .send()
            .await
            .map_err(|e| format!("Failed to upload (retry): {e}"))?;
        let retry_status = retry_resp.status();
        if retry_status.is_success() {
            return Ok(());
        }
        let retry_text = retry_resp.text().await.unwrap_or_default();
        return Err(format!(
            "Failed to upload after bucket creation (HTTP {retry_status}): {retry_text}"
        ));
    }

    Err(format!("Failed to upload (HTTP {status}): {text}"))
}

#[tauri::command]
pub async fn sync_download(
    app: AppHandle,
    remote_name: String,
    local_path: String,
) -> Result<(), String> {
    let (base_url, anon_key) = get_config(&app)?;
    let client = build_client(&anon_key)?;

    let url = format!("{base_url}/storage/v1/object/{BUCKET_NAME}/{remote_name}");
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to download: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Failed to download (HTTP {status}): {text}"));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {e}"))?;

    // Create parent dirs if needed
    if let Some(parent) = Path::new(&local_path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directories: {e}"))?;
    }

    std::fs::write(&local_path, &bytes).map_err(|e| format!("Failed to write file: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn sync_get_remote_stats(
    app: AppHandle,
    remote_name: String,
) -> Result<RemoteFileStats, String> {
    let (base_url, anon_key) = get_config(&app)?;
    let client = build_client(&anon_key)?;

    // Get metadata from list endpoint
    let list_url = format!("{base_url}/storage/v1/object/list/{BUCKET_NAME}");
    let list_body = serde_json::json!({
        "prefix": "",
        "limit": 100,
        "offset": 0,
        "search": remote_name
    });
    let list_resp = client
        .post(&list_url)
        .json(&list_body)
        .send()
        .await
        .map_err(|e| format!("Failed to list: {e}"))?;

    let mut updated_at = String::new();
    let mut size: i64 = 0;
    if list_resp.status().is_success() {
        let items: Vec<StorageListItem> = list_resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse list: {e}"))?;
        if let Some(item) = items.into_iter().find(|i| i.name == remote_name) {
            updated_at = item.updated_at;
            size = item.metadata.map(|m| m.size).unwrap_or(0);
        }
    }

    // Download to temp to count nodes/edges
    let temp_path = std::env::temp_dir().join(format!("cladel_sync_stats_{remote_name}"));
    let dl_url = format!("{base_url}/storage/v1/object/{BUCKET_NAME}/{remote_name}");
    let dl_resp = client
        .get(&dl_url)
        .send()
        .await
        .map_err(|e| format!("Failed to download: {e}"))?;

    if !dl_resp.status().is_success() {
        let text = dl_resp.text().await.unwrap_or_default();
        return Err(format!("Failed to download remote file: {text}"));
    }

    let bytes = dl_resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read: {e}"))?;
    std::fs::write(&temp_path, &bytes).map_err(|e| format!("Failed to write temp: {e}"))?;

    let (node_count, edge_count) = count_nodes_edges(temp_path.to_str().unwrap_or(""))?;
    let _ = std::fs::remove_file(&temp_path);

    Ok(RemoteFileStats {
        name: remote_name,
        updated_at,
        size,
        node_count,
        edge_count,
    })
}
