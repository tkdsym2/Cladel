use crate::db::Database;
use crate::commands::settings::get_stored_gemini_api_key;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const IMAGE_MODEL: &str = "gemini-2.5-flash-image";
const MAX_RETRIES: u32 = 2;
const RETRY_DELAYS_MS: [u64; 2] = [2000, 5000];

fn image_api_url() -> String {
    format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
        IMAGE_MODEL
    )
}

// ─── Result type ───

#[derive(Debug, Serialize)]
pub struct NanoBananaResult {
    pub file_path: String,
    pub mime_type: String,
    pub description: Option<String>,
}

// ─── API response types ───

#[derive(Debug, Deserialize)]
struct ApiResponse {
    candidates: Option<Vec<ApiCandidate>>,
    #[serde(rename = "usageMetadata")]
    usage_metadata: Option<ApiUsageMetadata>,
}

#[derive(Debug, Deserialize)]
struct ApiCandidate {
    content: Option<ApiContent>,
}

#[derive(Debug, Deserialize)]
struct ApiContent {
    parts: Option<Vec<ApiPart>>,
}

#[derive(Debug, Deserialize)]
struct ApiPart {
    text: Option<String>,
    #[serde(rename = "inlineData")]
    inline_data: Option<ApiInlineData>,
}

#[derive(Debug, Deserialize)]
struct ApiInlineData {
    #[serde(rename = "mimeType")]
    mime_type: String,
    data: String,
}

#[derive(Debug, Deserialize)]
struct ApiUsageMetadata {
    #[serde(rename = "promptTokenCount", default)]
    prompt_token_count: u64,
    #[serde(rename = "candidatesTokenCount", default)]
    candidates_token_count: u64,
    #[serde(rename = "totalTokenCount", default)]
    total_token_count: u64,
}

// ─── Command ───

#[tauri::command]
pub async fn generate_nano_banana_image(
    app_handle: tauri::AppHandle,
    db: tauri::State<'_, Database>,
    node_id: String,
    layer_id: String,
    prompt: String,
    aspect_ratio: Option<String>,
) -> Result<NanoBananaResult, String> {
    let _ = layer_id; // reserved for future use

    // 1. Retrieve Gemini API key
    let api_key = get_stored_gemini_api_key(&app_handle).ok_or_else(|| {
        "Gemini API key not configured. Nano Banana image generation requires a Gemini API key."
            .to_string()
    })?;

    let aspect = aspect_ratio.unwrap_or_else(|| "1:1".to_string());

    // 2. Build request body
    let body = serde_json::json!({
        "contents": [{
            "parts": [{ "text": prompt }]
        }],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
            "imageConfig": {
                "aspectRatio": aspect
            }
        }
    });

    // 3. HTTP call with retry
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let mut last_error: Option<String> = None;
    let mut api_resp: Option<ApiResponse> = None;

    for attempt in 0..=MAX_RETRIES {
        if attempt > 0 {
            let delay_ms = RETRY_DELAYS_MS[(attempt - 1) as usize];
            eprintln!(
                "[nano_banana] Retry attempt {attempt}/{MAX_RETRIES} after {delay_ms}ms"
            );
            std::thread::sleep(Duration::from_millis(delay_ms));
        }

        let response = client
            .post(image_api_url())
            .header("x-goog-api-key", &api_key)
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await;

        match response {
            Ok(resp) => {
                let status = resp.status();
                if is_retryable_status(status) && attempt < MAX_RETRIES {
                    let body_text = resp.text().await.unwrap_or_default();
                    eprintln!("[nano_banana] Retryable HTTP {status}: {body_text}");
                    last_error = Some(format!("HTTP {status}: {body_text}"));
                    continue;
                }
                if !status.is_success() {
                    let body_text = resp.text().await.unwrap_or_default();
                    return Err(format!("API error (HTTP {status}): {body_text}"));
                }
                let parsed: ApiResponse = resp
                    .json()
                    .await
                    .map_err(|e| format!("Failed to parse API response: {e}"))?;
                api_resp = Some(parsed);
                break;
            }
            Err(e) => {
                if (e.is_timeout() || e.is_connect()) && attempt < MAX_RETRIES {
                    eprintln!("[nano_banana] Retryable network error: {e}");
                    last_error = Some(e.to_string());
                    continue;
                }
                return Err(format!("Network error: {e}"));
            }
        }
    }

    let api_resp = api_resp.ok_or_else(|| {
        format!(
            "All retry attempts failed. Last error: {}",
            last_error.unwrap_or_else(|| "unknown".to_string())
        )
    })?;

    // 4. Parse response: extract text description and image data
    let parts = api_resp
        .candidates
        .as_ref()
        .and_then(|c| c.first())
        .and_then(|c| c.content.as_ref())
        .and_then(|c| c.parts.as_ref())
        .ok_or("No content in API response")?;

    let mut description: Option<String> = None;
    let mut image_data: Option<(String, String)> = None; // (mime_type, base64_data)

    for part in parts {
        if let Some(ref text) = part.text {
            description = Some(text.clone());
        }
        if let Some(ref inline) = part.inline_data {
            image_data = Some((inline.mime_type.clone(), inline.data.clone()));
        }
    }

    let (mime_type, base64_data) = image_data
        .ok_or("No image was generated. The API returned only text.")?;

    // 5. Decode base64 and save to disk
    let image_bytes = base64::engine::general_purpose::STANDARD
        .decode(&base64_data)
        .map_err(|e| format!("Failed to decode base64 image data: {e}"))?;

    let save_dir = {
        let current_path = db.get_current_path()?;
        match current_path {
            Some(klv_path) => {
                if let Some(parent) = klv_path.parent() {
                    parent.join("nano_banana_images")
                } else {
                    std::env::temp_dir().join("cladel-nano-banana")
                }
            }
            None => std::env::temp_dir().join("cladel-nano-banana"),
        }
    };

    std::fs::create_dir_all(&save_dir)
        .map_err(|e| format!("Failed to create save directory: {e}"))?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let filename = format!("{}_{}.png", node_id, timestamp);
    let file_path = save_dir.join(&filename);
    let file_path_str = file_path.to_string_lossy().to_string();

    std::fs::write(&file_path, &image_bytes)
        .map_err(|e| format!("Failed to write image file: {e}"))?;

    // 6. Read image dimensions
    let (width, height) = image::image_dimensions(&file_path)
        .map(|(w, h)| (w, h))
        .unwrap_or((0, 0));

    // 7. Insert into node_images table
    let image_record_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO node_images (id, node_id, file_path, mime_type, original_filename, image_width, image_height, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                image_record_id,
                node_id,
                file_path_str,
                mime_type,
                filename,
                width,
                height,
                now,
            ],
        )
        .map_err(|e| format!("Failed to insert node_images record: {e}"))?;

        // 8. Update node metadata
        let metadata = serde_json::json!({
            "prompt": prompt,
            "aspect_ratio": aspect,
            "model": IMAGE_MODEL,
            "generated_at": now,
            "file_path": file_path_str,
            "description": description,
        });

        conn.execute(
            "UPDATE nodes SET metadata = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![metadata.to_string(), now, node_id],
        )
        .map_err(|e| format!("Failed to update node metadata: {e}"))?;

        // 9. Log usage
        let usage = api_resp.usage_metadata.as_ref();
        let input_tokens = usage.map(|u| u.prompt_token_count).unwrap_or(0);
        let output_tokens = usage.map(|u| u.candidates_token_count).unwrap_or(0);
        let total_tokens = usage.map(|u| u.total_token_count).unwrap_or(0);
        let log_id = uuid::Uuid::new_v4().to_string();

        conn.execute(
            "INSERT INTO agent_usage_log (id, invocation_type, model, input_tokens, output_tokens, total_tokens, success, created_at)
             VALUES (?1, 'nano_banana', ?2, ?3, ?4, ?5, 1, datetime('now'))",
            rusqlite::params![log_id, IMAGE_MODEL, input_tokens, output_tokens, total_tokens],
        )
        .map_err(|e| format!("Failed to log usage: {e}"))?;
    }

    // 10. Return result
    Ok(NanoBananaResult {
        file_path: file_path_str,
        mime_type,
        description,
    })
}

fn is_retryable_status(status: reqwest::StatusCode) -> bool {
    matches!(
        status.as_u16(),
        429 | 500 | 502 | 503 | 529
    )
}
