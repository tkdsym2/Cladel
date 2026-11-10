use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "settings.json";
const API_KEY_FIELD: &str = "anthropic_api_key";
const GEMINI_API_KEY_FIELD: &str = "gemini_api_key";
const KEY_RECENT_FILES: &str = "recent_files";
const MAX_RECENT_FILES: usize = 10;
const KEY_PAPER_SUMMARY_PROMPT: &str = "paper_summary_prompt";
const KEY_SUPABASE_URL: &str = "supabase_url";
const KEY_SUPABASE_ANON_KEY: &str = "supabase_anon_key";
const KEY_USER_ID: &str = "user_id";
const KEY_USER_NAME: &str = "user_name";

pub const DEFAULT_PAPER_SUMMARY_PROMPT: &str = r#"Please summarize the attached research paper in experimental psychology/cognitive science following this structure:

**Research Question/Objective:** What is the primary hypothesis or research question?

**Participants:** Who were the human subjects? Include sample size (N), demographics, and any specific inclusion criteria.

**Methodology:** Describe the experimental design (e.g., within-subject, between-subject), key tasks, and the primary independent/dependent variables.

**Main Findings:** What were the statistically significant results? Summarize the key data points or effect sizes if mentioned.

**Conclusion & Implications:** How do the authors interpret these results in the context of cognitive science or psychology?

**Limitations:** What are the constraints or future directions identified by the authors?

Please provide the output in Japanese."#;

// Individual store keys for AgentCapabilities fields
const KEY_AGENT_ENABLED: &str = "agent_enabled";
const KEY_AUTONOMOUS_ENABLED: &str = "autonomous_enabled";
const KEY_SEARCH_PAPERS_ENABLED: &str = "search_papers_enabled";
const KEY_SUGGEST_CONNECTIONS_ENABLED: &str = "suggest_connections_enabled";
const KEY_SUGGEST_IDEAS_ENABLED: &str = "suggest_ideas_enabled";
const KEY_AUTONOMOUS_IDLE_SECONDS: &str = "autonomous_idle_seconds";
const KEY_AUTONOMOUS_COOLDOWN_SECONDS: &str = "autonomous_cooldown_seconds";

// Legacy key from old AutonomousSettings (for backward compat migration)
const LEGACY_AUTONOMOUS_SETTINGS_FIELD: &str = "autonomous_settings";

// UI preferences store keys
const KEY_CORE_DEFAULT_WIDTH: &str = "core_default_width";
const KEY_CORE_DEFAULT_HEIGHT: &str = "core_default_height";
const KEY_PAPER_DEFAULT_WIDTH: &str = "paper_default_width";
const KEY_PAPER_DEFAULT_HEIGHT: &str = "paper_default_height";
const KEY_USER_DOC_DEFAULT_WIDTH: &str = "user_doc_default_width";
const KEY_USER_DOC_DEFAULT_HEIGHT: &str = "user_doc_default_height";
const KEY_GHOST_DEFAULT_WIDTH: &str = "ghost_default_width";
const KEY_GHOST_DEFAULT_HEIGHT: &str = "ghost_default_height";
const KEY_IMAGE_DEFAULT_WIDTH: &str = "image_default_width";
const KEY_IMAGE_DEFAULT_HEIGHT: &str = "image_default_height";
const KEY_SIDEBAR_DEFAULT_WIDTH: &str = "sidebar_default_width";
const KEY_CANVAS_BACKGROUND: &str = "canvas_background";
const KEY_CANVAS_GRID_ENABLED: &str = "canvas_grid_enabled";
const KEY_CANVAS_GRID_SIZE: &str = "canvas_grid_size";
const KEY_EDITOR_FONT_SIZE: &str = "editor_font_size";
const KEY_UI_LANGUAGE: &str = "ui_language";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCapabilities {
    pub agent_enabled: bool,
    pub autonomous_enabled: bool,
    pub search_papers_enabled: bool,
    pub suggest_connections_enabled: bool,
    pub suggest_ideas_enabled: bool,
    pub autonomous_idle_seconds: u64,
    pub autonomous_cooldown_seconds: u64,
}

impl Default for AgentCapabilities {
    fn default() -> Self {
        Self {
            agent_enabled: false,
            autonomous_enabled: true,
            search_papers_enabled: true,
            suggest_connections_enabled: true,
            suggest_ideas_enabled: true,
            autonomous_idle_seconds: 45,
            autonomous_cooldown_seconds: 120,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UIPreferences {
    pub core_default_width: f64,
    pub core_default_height: f64,
    pub paper_default_width: f64,
    pub paper_default_height: f64,
    pub user_doc_default_width: f64,
    pub user_doc_default_height: f64,
    pub ghost_default_width: f64,
    pub ghost_default_height: f64,
    pub image_default_width: f64,
    pub image_default_height: f64,
    pub sidebar_default_width: f64,
    pub canvas_background: String,
    pub canvas_grid_enabled: bool,
    pub canvas_grid_size: f64,
    pub editor_font_size: f64,
    /// UI language: "en" (default) or "ja".
    pub language: String,
}

impl Default for UIPreferences {
    fn default() -> Self {
        Self {
            core_default_width: 280.0,
            core_default_height: 210.0,
            paper_default_width: 280.0,
            paper_default_height: 210.0,
            user_doc_default_width: 280.0,
            user_doc_default_height: 210.0,
            ghost_default_width: 280.0,
            ghost_default_height: 210.0,
            image_default_width: 280.0,
            image_default_height: 210.0,
            sidebar_default_width: 380.0,
            canvas_background: "#f8fafc".to_string(),
            canvas_grid_enabled: true,
            canvas_grid_size: 20.0,
            editor_font_size: 13.0,
            language: "en".to_string(),
        }
    }
}

/// Legacy struct for migrating old settings
#[derive(Debug, Deserialize)]
struct LegacyAutonomousSettings {
    enabled: bool,
    idle_seconds: u64,
    cooldown_seconds: u64,
}

#[tauri::command]
pub fn save_api_key(app: AppHandle, key: String) -> Result<(), String> {
    if !key.starts_with("sk-ant-") {
        return Err("Invalid API key: must start with \"sk-ant-\"".to_string());
    }
    if key.len() < 20 {
        return Err("Invalid API key: too short".to_string());
    }
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {e}"))?;
    store.set(API_KEY_FIELD, serde_json::json!(key));
    Ok(())
}

#[tauri::command]
pub fn get_api_key_status(app: AppHandle) -> Result<Option<String>, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {e}"))?;
    match store.get(API_KEY_FIELD) {
        Some(val) => {
            let key = val
                .as_str()
                .ok_or("Stored API key is not a string")?
                .to_string();
            // Return masked version: show prefix + last 4 chars
            let masked = if key.len() > 11 {
                let last4 = &key[key.len() - 4..];
                format!("sk-ant-\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}{last4}")
            } else {
                "\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}".to_string()
            };
            Ok(Some(masked))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub fn get_api_key(app: AppHandle) -> Result<Option<String>, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {e}"))?;
    match store.get(API_KEY_FIELD) {
        Some(val) => {
            let key = val
                .as_str()
                .ok_or("Stored API key is not a string")?
                .to_string();
            Ok(Some(key))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub fn delete_api_key(app: AppHandle) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {e}"))?;
    store.delete(API_KEY_FIELD);
    Ok(())
}

// ─── Gemini API Key ───

#[tauri::command]
pub fn save_gemini_api_key(app: AppHandle, key: String) -> Result<(), String> {
    if key.len() < 10 {
        return Err("Invalid API key: too short".to_string());
    }
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {e}"))?;
    store.set(GEMINI_API_KEY_FIELD, serde_json::json!(key));
    Ok(())
}

#[tauri::command]
pub fn get_gemini_api_key_status(app: AppHandle) -> Result<Option<String>, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {e}"))?;
    match store.get(GEMINI_API_KEY_FIELD) {
        Some(val) => {
            let key = val
                .as_str()
                .ok_or("Stored Gemini API key is not a string")?
                .to_string();
            let masked = if key.len() > 6 {
                let last4 = &key[key.len() - 4..];
                format!("AI\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}{last4}")
            } else {
                "\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}".to_string()
            };
            Ok(Some(masked))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub fn get_gemini_api_key(app: AppHandle) -> Result<Option<String>, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {e}"))?;
    match store.get(GEMINI_API_KEY_FIELD) {
        Some(val) => {
            let key = val
                .as_str()
                .ok_or("Stored Gemini API key is not a string")?
                .to_string();
            Ok(Some(key))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub fn delete_gemini_api_key(app: AppHandle) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {e}"))?;
    store.delete(GEMINI_API_KEY_FIELD);
    Ok(())
}

/// Read the Gemini API key from tauri-plugin-store (used by agent modules).
pub fn get_stored_gemini_api_key(app: &AppHandle) -> Option<String> {
    let store = app.store(STORE_FILE).ok()?;
    store
        .get(GEMINI_API_KEY_FIELD)
        .and_then(|v| v.as_str().map(String::from))
}

#[tauri::command]
pub fn save_agent_capabilities(app: AppHandle, capabilities: AgentCapabilities) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {e}"))?;
    store.set(KEY_AGENT_ENABLED, serde_json::json!(capabilities.agent_enabled));
    store.set(KEY_AUTONOMOUS_ENABLED, serde_json::json!(capabilities.autonomous_enabled));
    store.set(KEY_SEARCH_PAPERS_ENABLED, serde_json::json!(capabilities.search_papers_enabled));
    store.set(KEY_SUGGEST_CONNECTIONS_ENABLED, serde_json::json!(capabilities.suggest_connections_enabled));
    store.set(KEY_SUGGEST_IDEAS_ENABLED, serde_json::json!(capabilities.suggest_ideas_enabled));
    store.set(KEY_AUTONOMOUS_IDLE_SECONDS, serde_json::json!(capabilities.autonomous_idle_seconds));
    store.set(KEY_AUTONOMOUS_COOLDOWN_SECONDS, serde_json::json!(capabilities.autonomous_cooldown_seconds));
    // Remove legacy key if present
    store.delete(LEGACY_AUTONOMOUS_SETTINGS_FIELD);
    Ok(())
}

#[tauri::command]
pub fn get_agent_capabilities(app: AppHandle) -> Result<AgentCapabilities, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {e}"))?;

    // Check if new keys exist by looking for agent_enabled
    if store.get(KEY_AGENT_ENABLED).is_some() {
        // New format: read individual keys with defaults
        let defaults = AgentCapabilities::default();
        let agent_enabled = store.get(KEY_AGENT_ENABLED)
            .and_then(|v| v.as_bool())
            .unwrap_or(defaults.agent_enabled);
        let autonomous_enabled = store.get(KEY_AUTONOMOUS_ENABLED)
            .and_then(|v| v.as_bool())
            .unwrap_or(defaults.autonomous_enabled);
        let search_papers_enabled = store.get(KEY_SEARCH_PAPERS_ENABLED)
            .and_then(|v| v.as_bool())
            .unwrap_or(defaults.search_papers_enabled);
        let suggest_connections_enabled = store.get(KEY_SUGGEST_CONNECTIONS_ENABLED)
            .and_then(|v| v.as_bool())
            .unwrap_or(defaults.suggest_connections_enabled);
        let suggest_ideas_enabled = store.get(KEY_SUGGEST_IDEAS_ENABLED)
            .and_then(|v| v.as_bool())
            .unwrap_or(defaults.suggest_ideas_enabled);
        let autonomous_idle_seconds = store.get(KEY_AUTONOMOUS_IDLE_SECONDS)
            .and_then(|v| v.as_u64())
            .unwrap_or(defaults.autonomous_idle_seconds);
        let autonomous_cooldown_seconds = store.get(KEY_AUTONOMOUS_COOLDOWN_SECONDS)
            .and_then(|v| v.as_u64())
            .unwrap_or(defaults.autonomous_cooldown_seconds);

        return Ok(AgentCapabilities {
            agent_enabled,
            autonomous_enabled,
            search_papers_enabled,
            suggest_connections_enabled,
            suggest_ideas_enabled,
            autonomous_idle_seconds,
            autonomous_cooldown_seconds,
        });
    }

    // Backward compat: try to read legacy autonomous_settings
    if let Some(val) = store.get(LEGACY_AUTONOMOUS_SETTINGS_FIELD) {
        if let Ok(legacy) = serde_json::from_value::<LegacyAutonomousSettings>(val.clone()) {
            return Ok(AgentCapabilities {
                agent_enabled: false,
                autonomous_enabled: legacy.enabled,
                search_papers_enabled: true,
                suggest_connections_enabled: true,
                suggest_ideas_enabled: true,
                autonomous_idle_seconds: legacy.idle_seconds,
                autonomous_cooldown_seconds: legacy.cooldown_seconds,
            });
        }
    }

    // No settings at all — return defaults
    Ok(AgentCapabilities::default())
}

// ─── UI Preferences ───

#[tauri::command]
pub fn get_ui_preferences(app: AppHandle) -> Result<UIPreferences, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {e}"))?;

    let defaults = UIPreferences::default();

    Ok(UIPreferences {
        core_default_width: store.get(KEY_CORE_DEFAULT_WIDTH)
            .and_then(|v| v.as_f64())
            .unwrap_or(defaults.core_default_width),
        core_default_height: store.get(KEY_CORE_DEFAULT_HEIGHT)
            .and_then(|v| v.as_f64())
            .unwrap_or(defaults.core_default_height),
        paper_default_width: store.get(KEY_PAPER_DEFAULT_WIDTH)
            .and_then(|v| v.as_f64())
            .unwrap_or(defaults.paper_default_width),
        paper_default_height: store.get(KEY_PAPER_DEFAULT_HEIGHT)
            .and_then(|v| v.as_f64())
            .unwrap_or(defaults.paper_default_height),
        user_doc_default_width: store.get(KEY_USER_DOC_DEFAULT_WIDTH)
            .and_then(|v| v.as_f64())
            .unwrap_or(defaults.user_doc_default_width),
        user_doc_default_height: store.get(KEY_USER_DOC_DEFAULT_HEIGHT)
            .and_then(|v| v.as_f64())
            .unwrap_or(defaults.user_doc_default_height),
        ghost_default_width: store.get(KEY_GHOST_DEFAULT_WIDTH)
            .and_then(|v| v.as_f64())
            .unwrap_or(defaults.ghost_default_width),
        ghost_default_height: store.get(KEY_GHOST_DEFAULT_HEIGHT)
            .and_then(|v| v.as_f64())
            .unwrap_or(defaults.ghost_default_height),
        image_default_width: store.get(KEY_IMAGE_DEFAULT_WIDTH)
            .and_then(|v| v.as_f64())
            .unwrap_or(defaults.image_default_width),
        image_default_height: store.get(KEY_IMAGE_DEFAULT_HEIGHT)
            .and_then(|v| v.as_f64())
            .unwrap_or(defaults.image_default_height),
        sidebar_default_width: store.get(KEY_SIDEBAR_DEFAULT_WIDTH)
            .and_then(|v| v.as_f64())
            .unwrap_or(defaults.sidebar_default_width),
        canvas_background: store.get(KEY_CANVAS_BACKGROUND)
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or(defaults.canvas_background),
        canvas_grid_enabled: store.get(KEY_CANVAS_GRID_ENABLED)
            .and_then(|v| v.as_bool())
            .unwrap_or(defaults.canvas_grid_enabled),
        canvas_grid_size: store.get(KEY_CANVAS_GRID_SIZE)
            .and_then(|v| v.as_f64())
            .unwrap_or(defaults.canvas_grid_size),
        editor_font_size: store.get(KEY_EDITOR_FONT_SIZE)
            .and_then(|v| v.as_f64())
            .unwrap_or(defaults.editor_font_size),
        language: store.get(KEY_UI_LANGUAGE)
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or(defaults.language),
    })
}

#[tauri::command]
pub fn save_ui_preferences(app: AppHandle, preferences: UIPreferences) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {e}"))?;

    store.set(KEY_CORE_DEFAULT_WIDTH, serde_json::json!(preferences.core_default_width));
    store.set(KEY_CORE_DEFAULT_HEIGHT, serde_json::json!(preferences.core_default_height));
    store.set(KEY_PAPER_DEFAULT_WIDTH, serde_json::json!(preferences.paper_default_width));
    store.set(KEY_PAPER_DEFAULT_HEIGHT, serde_json::json!(preferences.paper_default_height));
    store.set(KEY_USER_DOC_DEFAULT_WIDTH, serde_json::json!(preferences.user_doc_default_width));
    store.set(KEY_USER_DOC_DEFAULT_HEIGHT, serde_json::json!(preferences.user_doc_default_height));
    store.set(KEY_GHOST_DEFAULT_WIDTH, serde_json::json!(preferences.ghost_default_width));
    store.set(KEY_GHOST_DEFAULT_HEIGHT, serde_json::json!(preferences.ghost_default_height));
    store.set(KEY_IMAGE_DEFAULT_WIDTH, serde_json::json!(preferences.image_default_width));
    store.set(KEY_IMAGE_DEFAULT_HEIGHT, serde_json::json!(preferences.image_default_height));
    store.set(KEY_SIDEBAR_DEFAULT_WIDTH, serde_json::json!(preferences.sidebar_default_width));
    store.set(KEY_CANVAS_BACKGROUND, serde_json::json!(preferences.canvas_background));
    store.set(KEY_CANVAS_GRID_ENABLED, serde_json::json!(preferences.canvas_grid_enabled));
    store.set(KEY_CANVAS_GRID_SIZE, serde_json::json!(preferences.canvas_grid_size));
    store.set(KEY_EDITOR_FONT_SIZE, serde_json::json!(preferences.editor_font_size));
    store.set(KEY_UI_LANGUAGE, serde_json::json!(preferences.language));

    Ok(())
}

// ─── Recent Files ───

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentFile {
    pub path: String,
    pub name: String,
    pub last_opened: String,
}

#[tauri::command]
pub fn get_recent_files(app: AppHandle) -> Result<Vec<RecentFile>, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {e}"))?;

    match store.get(KEY_RECENT_FILES) {
        Some(val) => {
            let files: Vec<RecentFile> = serde_json::from_value(val.clone())
                .unwrap_or_default();
            Ok(files)
        }
        None => Ok(vec![]),
    }
}

#[tauri::command]
pub fn add_recent_file(app: AppHandle, path: String) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {e}"))?;

    let mut files: Vec<RecentFile> = match store.get(KEY_RECENT_FILES) {
        Some(val) => serde_json::from_value(val.clone()).unwrap_or_default(),
        None => vec![],
    };

    // Remove existing entry with the same path (will be re-added at top)
    files.retain(|f| f.path != path);

    // Extract filename from path
    let name = path
        .replace('\\', "/")
        .rsplit('/')
        .next()
        .unwrap_or(&path)
        .to_string();

    let now = chrono::Utc::now().to_rfc3339();

    files.insert(0, RecentFile {
        path,
        name,
        last_opened: now,
    });

    // Cap at MAX_RECENT_FILES
    files.truncate(MAX_RECENT_FILES);

    store.set(KEY_RECENT_FILES, serde_json::json!(files));
    Ok(())
}

#[tauri::command]
pub fn remove_recent_file(app: AppHandle, path: String) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {e}"))?;

    let mut files: Vec<RecentFile> = match store.get(KEY_RECENT_FILES) {
        Some(val) => serde_json::from_value(val.clone()).unwrap_or_default(),
        None => vec![],
    };

    files.retain(|f| f.path != path);
    store.set(KEY_RECENT_FILES, serde_json::json!(files));
    Ok(())
}

// ─── Paper Summary Prompt ───

#[tauri::command]
pub fn get_paper_summary_prompt(app: AppHandle) -> Result<String, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {e}"))?;
    match store.get(KEY_PAPER_SUMMARY_PROMPT) {
        Some(val) => Ok(val.as_str().unwrap_or(DEFAULT_PAPER_SUMMARY_PROMPT).to_string()),
        None => Ok(DEFAULT_PAPER_SUMMARY_PROMPT.to_string()),
    }
}

#[tauri::command]
pub fn save_paper_summary_prompt(app: AppHandle, prompt: String) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {e}"))?;
    store.set(KEY_PAPER_SUMMARY_PROMPT, serde_json::json!(prompt));
    Ok(())
}

#[tauri::command]
pub fn reset_paper_summary_prompt(app: AppHandle) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {e}"))?;
    store.delete(KEY_PAPER_SUMMARY_PROMPT);
    Ok(())
}

/// Read the paper summary prompt from store (used by paper_chat module).
pub fn get_stored_paper_summary_prompt(app: &AppHandle) -> String {
    let store = match app.store(STORE_FILE) {
        Ok(s) => s,
        Err(_) => return DEFAULT_PAPER_SUMMARY_PROMPT.to_string(),
    };
    match store.get(KEY_PAPER_SUMMARY_PROMPT) {
        Some(val) => val.as_str().unwrap_or(DEFAULT_PAPER_SUMMARY_PROMPT).to_string(),
        None => DEFAULT_PAPER_SUMMARY_PROMPT.to_string(),
    }
}

// ─── Supabase Config ───

#[tauri::command]
pub fn save_supabase_config(app: AppHandle, url: String, anon_key: String) -> Result<(), String> {
    if url.is_empty() {
        return Err("Supabase URL cannot be empty".to_string());
    }
    if anon_key.is_empty() {
        return Err("Supabase anon key cannot be empty".to_string());
    }
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {e}"))?;
    store.set(KEY_SUPABASE_URL, serde_json::json!(url));
    store.set(KEY_SUPABASE_ANON_KEY, serde_json::json!(anon_key));
    Ok(())
}

#[tauri::command]
pub fn get_supabase_config(app: AppHandle) -> Result<(String, String), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {e}"))?;
    let url = store
        .get(KEY_SUPABASE_URL)
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_default();
    let anon_key = store
        .get(KEY_SUPABASE_ANON_KEY)
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_default();
    Ok((url, anon_key))
}

#[tauri::command]
pub fn get_supabase_config_status(app: AppHandle) -> Result<bool, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {e}"))?;
    let url = store
        .get(KEY_SUPABASE_URL)
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_default();
    let anon_key = store
        .get(KEY_SUPABASE_ANON_KEY)
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_default();
    Ok(!url.is_empty() && !anon_key.is_empty())
}

#[tauri::command]
pub fn delete_supabase_config(app: AppHandle) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {e}"))?;
    store.delete(KEY_SUPABASE_URL);
    store.delete(KEY_SUPABASE_ANON_KEY);
    Ok(())
}

/// Read Supabase config from store (used by sync module).
pub fn get_stored_supabase_config(app: &AppHandle) -> Option<(String, String)> {
    let store = app.store(STORE_FILE).ok()?;
    let url = store
        .get(KEY_SUPABASE_URL)
        .and_then(|v| v.as_str().map(String::from))
        .filter(|s| !s.is_empty())?;
    let anon_key = store
        .get(KEY_SUPABASE_ANON_KEY)
        .and_then(|v| v.as_str().map(String::from))
        .filter(|s| !s.is_empty())?;
    Some((url, anon_key))
}

// ─── User Identity ───

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserIdentity {
    pub user_id: Option<String>,
    pub user_name: Option<String>,
}

#[tauri::command]
pub fn get_user_identity(app: AppHandle) -> Result<UserIdentity, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {e}"))?;
    let user_id = store
        .get(KEY_USER_ID)
        .and_then(|v| v.as_str().map(String::from));
    let user_name = store
        .get(KEY_USER_NAME)
        .and_then(|v| v.as_str().map(String::from));
    Ok(UserIdentity { user_id, user_name })
}

#[tauri::command]
pub fn register_user(app: AppHandle, user_name: String) -> Result<UserIdentity, String> {
    let trimmed = user_name.trim().to_string();
    if trimmed.is_empty() {
        return Err("User name cannot be empty".to_string());
    }
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {e}"))?;
    let user_id = uuid::Uuid::new_v4().to_string();
    store.set(KEY_USER_ID, serde_json::json!(user_id));
    store.set(KEY_USER_NAME, serde_json::json!(trimmed));
    Ok(UserIdentity {
        user_id: Some(user_id),
        user_name: Some(trimmed),
    })
}

#[tauri::command]
pub fn update_user_name(app: AppHandle, user_name: String) -> Result<UserIdentity, String> {
    let trimmed = user_name.trim().to_string();
    if trimmed.is_empty() {
        return Err("User name cannot be empty".to_string());
    }
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {e}"))?;
    let user_id = store
        .get(KEY_USER_ID)
        .and_then(|v| v.as_str().map(String::from));
    store.set(KEY_USER_NAME, serde_json::json!(trimmed));
    Ok(UserIdentity {
        user_id,
        user_name: Some(trimmed),
    })
}
