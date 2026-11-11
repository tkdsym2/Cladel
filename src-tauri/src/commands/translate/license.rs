//! PLaMo Community License: fetch the official text that ships with the model
//! repositories (`LICENSE/ja`, `LICENSE/en`), cache it for offline use, and
//! record the user's consent. Downloading or importing a model requires consent.
//!
//! Consent is bound to the SHA-256 of the text the user accepted; if the
//! cached official text changes later, consent must be given again.

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

use super::server::models_dir;

const STORE_FILE: &str = "settings.json";
const KEY_ACCEPTED_AT: &str = "plamo_license_accepted_at";
const KEY_ACCEPTED_SHA: &str = "plamo_license_accepted_sha256";
const KEY_ACCEPTED_LANG: &str = "plamo_license_accepted_lang";

/// The license text is identical in all three repos; read it from the smallest.
const LICENSE_REPO: &str = "pfnet/plamo-3-translate-0.8b-GGUF";
pub const LICENSE_URL_JA: &str = "https://plamo.preferredai.jp/info/plamo-community-license-ja";
pub const LICENSE_URL_EN: &str = "https://plamo.preferredai.jp/info/plamo-community-license-en";

#[derive(Debug, Clone, Serialize)]
pub struct LicenseText {
    pub lang: String,
    /// Full official text, if it could be fetched now or was cached earlier.
    pub text: Option<String>,
    pub sha256: Option<String>,
    pub from_cache: bool,
    /// Official web page of the license (always available).
    pub official_url: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LicenseStatus {
    pub accepted: bool,
    pub accepted_at: Option<String>,
    /// Consent exists but the official text changed since.
    pub needs_reaccept: bool,
}

fn normalize_lang(lang: &str) -> &'static str {
    if lang == "en" {
        "en"
    } else {
        "ja"
    }
}

fn cache_path(app: &AppHandle, lang: &str) -> Result<std::path::PathBuf, String> {
    let dir = models_dir(app)?.join("licenses");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("plamo-community-license-{lang}.txt")))
}

pub fn sha256_hex(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}

/// Fetch the license text from Hugging Face (falls back to the cached copy).
#[tauri::command]
pub async fn translation_get_license(app: AppHandle, lang: String) -> Result<LicenseText, String> {
    let lang = normalize_lang(&lang);
    let official_url = if lang == "en" { LICENSE_URL_EN } else { LICENSE_URL_JA }.to_string();
    let cache = cache_path(&app, lang)?;
    let url = format!("https://huggingface.co/{LICENSE_REPO}/resolve/main/LICENSE/{lang}");

    let fetched: Result<String, String> = async {
        let resp = super::models::hf_client()?
            .get(&url)
            .timeout(std::time::Duration::from_secs(15))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("HTTP {}", resp.status()));
        }
        let text = resp.text().await.map_err(|e| e.to_string())?;
        if text.trim().is_empty() {
            return Err("empty license text".into());
        }
        Ok(text)
    }
    .await;

    match fetched {
        Ok(text) => {
            let _ = std::fs::write(&cache, &text);
            Ok(LicenseText {
                lang: lang.into(),
                sha256: Some(sha256_hex(text.as_bytes())),
                text: Some(text),
                from_cache: false,
                official_url,
                error: None,
            })
        }
        Err(e) => {
            let cached = std::fs::read_to_string(&cache).ok();
            Ok(LicenseText {
                lang: lang.into(),
                sha256: cached.as_ref().map(|t| sha256_hex(t.as_bytes())),
                from_cache: cached.is_some(),
                text: cached,
                official_url,
                error: Some(format!("Could not fetch the license text: {e}")),
            })
        }
    }
}

pub fn license_status(app: &AppHandle) -> Result<LicenseStatus, String> {
    let store = app.store(STORE_FILE).map_err(|e| format!("Failed to open store: {e}"))?;
    let accepted_at = store.get(KEY_ACCEPTED_AT).and_then(|v| v.as_str().map(str::to_string));
    let accepted_sha = store.get(KEY_ACCEPTED_SHA).and_then(|v| v.as_str().map(str::to_string));
    let accepted_lang = store.get(KEY_ACCEPTED_LANG).and_then(|v| v.as_str().map(str::to_string));

    let Some(accepted_at) = accepted_at else {
        return Ok(LicenseStatus { accepted: false, accepted_at: None, needs_reaccept: false });
    };
    // Compare with the currently cached official text of the same language.
    let lang = normalize_lang(accepted_lang.as_deref().unwrap_or("ja"));
    let current_sha = cache_path(app, lang)
        .ok()
        .and_then(|p| std::fs::read(p).ok())
        .map(|b| sha256_hex(&b));
    let changed = matches!((&accepted_sha, &current_sha), (Some(a), Some(c)) if a != c);
    Ok(LicenseStatus { accepted: !changed, accepted_at: Some(accepted_at), needs_reaccept: changed })
}

pub fn require_license(app: &AppHandle) -> Result<(), String> {
    if license_status(app)?.accepted {
        Ok(())
    } else {
        Err("LICENSE_NOT_ACCEPTED: Please read and accept the PLaMo Community License first.".into())
    }
}

#[tauri::command]
pub fn translation_license_status(app: AppHandle) -> Result<LicenseStatus, String> {
    license_status(&app)
}

/// Record consent to the text currently cached for `lang` (the one the user
/// was shown). `sha256` must match it, so stale UIs cannot accept new text.
#[tauri::command]
pub fn translation_accept_license(app: AppHandle, lang: String, sha256: Option<String>) -> Result<LicenseStatus, String> {
    let lang = normalize_lang(&lang);
    let cached_sha = std::fs::read(cache_path(&app, lang)?).ok().map(|b| sha256_hex(&b));
    if let (Some(shown), Some(cached)) = (&sha256, &cached_sha) {
        if shown != cached {
            return Err("The license text changed while it was displayed. Please review it again.".into());
        }
    }
    let store = app.store(STORE_FILE).map_err(|e| format!("Failed to open store: {e}"))?;
    store.set(KEY_ACCEPTED_AT, serde_json::json!(chrono::Utc::now().to_rfc3339()));
    store.set(KEY_ACCEPTED_LANG, serde_json::json!(lang));
    match sha256.or(cached_sha) {
        Some(sha) => store.set(KEY_ACCEPTED_SHA, serde_json::json!(sha)),
        None => {
            store.delete(KEY_ACCEPTED_SHA);
        }
    }
    let _ = store.save();
    license_status(&app)
}

#[tauri::command]
pub fn translation_revoke_license(app: AppHandle) -> Result<LicenseStatus, String> {
    let store = app.store(STORE_FILE).map_err(|e| format!("Failed to open store: {e}"))?;
    store.delete(KEY_ACCEPTED_AT);
    store.delete(KEY_ACCEPTED_SHA);
    store.delete(KEY_ACCEPTED_LANG);
    let _ = store.save();
    license_status(&app)
}
