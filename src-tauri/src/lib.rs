mod commands;
mod db;

use commands::literature::LiteratureClient;
use db::Database;
use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let database = Database::new().expect("Failed to initialize database");
            app.manage(database);

            app.manage(LiteratureClient::new());

            // ─── Native menu bar ───

            // Custom File menu items
            let file_new = MenuItemBuilder::with_id("file-new", "New")
                .accelerator("CmdOrCtrl+N")
                .build(app)?;
            let file_open = MenuItemBuilder::with_id("file-open", "Open")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;
            let file_save = MenuItemBuilder::with_id("file-save", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(app)?;
            let file_save_as = MenuItemBuilder::with_id("file-save-as", "Save As...")
                .accelerator("CmdOrCtrl+Shift+S")
                .build(app)?;
            // Settings menu item
            let settings_item = MenuItemBuilder::with_id("settings", "Settings...")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;
            // Custom Quit item: routes Cmd+Q through the frontend so unsaved
            // changes can be guarded (the predefined quit() bypasses the
            // window's close-requested handler).
            let quit_item = MenuItemBuilder::with_id("quit", "Quit Cladel")
                .accelerator("CmdOrCtrl+Q")
                .build(app)?;

            // App submenu (macOS: appears under the app name)
            let app_submenu = SubmenuBuilder::new(app, "Cladel")
                .about(Some(AboutMetadata {
                    name: Some("Cladel".to_string()),
                    version: Some(env!("CARGO_PKG_VERSION").to_string()),
                    ..Default::default()
                }))
                .separator()
                .item(&settings_item)
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .item(&quit_item)
                .build()?;

            let file_close_tab = MenuItemBuilder::with_id("file-close-tab", "Close Tab")
                .accelerator("CmdOrCtrl+W")
                .build(app)?;

            // File submenu
            let file_submenu = SubmenuBuilder::new(app, "File")
                .item(&file_new)
                .item(&file_open)
                .separator()
                .item(&file_save)
                .item(&file_save_as)
                .separator()
                .item(&file_close_tab)
                .build()?;

            // Edit submenu (predefined items for standard text editing)
            let edit_submenu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            // Window submenu
            let window_submenu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .separator()
                .close_window()
                .build()?;

            let menu = MenuBuilder::new(app)
                .items(&[&app_submenu, &file_submenu, &edit_submenu, &window_submenu])
                .build()?;

            app.set_menu(menu)?;

            // ─── Menu event handler ───
            app.on_menu_event(move |app_handle, event| match event.id().0.as_str() {
                "file-new" => {
                    let _ = app_handle.emit("menu-file-action", "new");
                }
                "file-open" => {
                    let _ = app_handle.emit("menu-file-action", "open");
                }
                "file-save" => {
                    let _ = app_handle.emit("menu-file-action", "save");
                }
                "file-save-as" => {
                    let _ = app_handle.emit("menu-file-action", "save-as");
                }
                "file-close-tab" => {
                    // If a detached (non-main) window is focused, close only that window
                    // instead of closing a tab in the main app.
                    let windows = app_handle.webview_windows();
                    for (label, window) in &windows {
                        if label != "main" {
                            if let Ok(true) = window.is_focused() {
                                let _ = window.close();
                                return;
                            }
                        }
                    }
                    let _ = app_handle.emit("menu-file-action", "close-tab");
                }
                "settings" => {
                    let _ = app_handle.emit("menu-settings", ());
                }
                "quit" => {
                    // Let the frontend check for unsaved changes before quitting.
                    // It will destroy the main window (→ app exit) when clear.
                    if let Some(main) = app_handle.get_webview_window("main") {
                        let _ = main.emit("menu-quit", ());
                    }
                }
                _ => {}
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // File commands
            commands::file_commands::file_new,
            commands::file_commands::file_open,
            commands::file_commands::file_save,
            commands::file_commands::file_save_as,
            commands::file_commands::file_get_current_path,
            // Tab commands
            commands::tab_commands::open_sample_as_new,
            commands::tab_commands::get_tabs,
            commands::tab_commands::get_active_tab_id,
            commands::tab_commands::create_tab,
            commands::tab_commands::open_file_in_tab,
            commands::tab_commands::switch_tab,
            commands::tab_commands::close_tab,
            commands::tab_commands::reload_active_tab_from_disk,
            commands::tab_commands::update_tab_after_save,
            // Node commands
            commands::nodes::create_node,
            commands::nodes::update_node,
            commands::nodes::delete_node,
            commands::nodes::soft_delete_node,
            commands::nodes::restore_node,
            commands::nodes::get_nodes_by_layer,
            commands::nodes::update_display_id,
            commands::nodes::update_paper_bibtex,
            // Edge commands
            commands::edges::create_edge,
            commands::edges::update_edge,
            commands::edges::delete_edge,
            commands::edges::restore_edge,
            commands::edges::get_edges_by_layer,
            // Layer/project commands
            commands::layers::create_project,
            commands::layers::create_layer,
            commands::layers::delete_layer,
            commands::layers::get_layers,
            commands::layers::get_projects,
            // Core version commands
            commands::core_versions::save_core_version,
            commands::core_versions::get_core_versions,
            commands::core_versions::get_core_version_diff,
            // BibTeX commands
            commands::bibtex::parse_bibtex,
            // Literature search commands
            commands::literature::search_papers,
            commands::literature::get_paper_details,
            // Node comment commands
            commands::node_comments::add_node_comment,
            commands::node_comments::get_node_comments,
            commands::node_comments::update_node_comment,
            commands::node_comments::delete_node_comment,
            commands::node_comments::get_node_comment_counts,
            // Edge comment commands
            commands::edge_comments::add_edge_comment,
            commands::edge_comments::get_edge_comments,
            commands::edge_comments::update_edge_comment,
            commands::edge_comments::delete_edge_comment,
            commands::edge_comments::get_edge_comment_counts,
            // Junction commands
            commands::junctions::split_edge_at_junction,
            commands::junctions::dissolve_junction,
            // Note version commands
            commands::note_versions::save_note_version,
            commands::note_versions::get_note_versions,
            // Agent commands
            commands::agent::invoke_agent,
            commands::agent::agent_node::invoke_agent_node,
            commands::agent::comment_agent::invoke_agent_comment,
            commands::agent::paper_chat::invoke_paper_summarize,
            commands::agent::paper_chat::invoke_paper_chat,
            // Settings commands
            commands::settings::save_api_key,
            commands::settings::get_api_key_status,
            commands::settings::get_api_key,
            commands::settings::delete_api_key,
            commands::settings::save_gemini_api_key,
            commands::settings::get_gemini_api_key_status,
            commands::settings::get_gemini_api_key,
            commands::settings::delete_gemini_api_key,
            commands::settings::save_agent_capabilities,
            commands::settings::get_agent_capabilities,
            commands::settings::get_ui_preferences,
            commands::settings::save_ui_preferences,
            commands::settings::get_recent_files,
            commands::settings::add_recent_file,
            commands::settings::remove_recent_file,
            commands::settings::get_paper_summary_prompt,
            commands::settings::save_paper_summary_prompt,
            commands::settings::reset_paper_summary_prompt,
            commands::settings::save_supabase_config,
            commands::settings::get_supabase_config,
            commands::settings::get_supabase_config_status,
            commands::settings::delete_supabase_config,
            // User identity commands
            commands::settings::get_user_identity,
            commands::settings::register_user,
            commands::settings::update_user_name,
            // PDF import commands
            commands::pdf_import::import_pdf,
            commands::pdf_import::extract_pdf_with_claude,
            // Table import commands
            commands::table_import::import_table_file,
            // Image import commands
            commands::image_import::validate_image_file,
            commands::image_import::create_image_node,
            commands::image_import::get_node_image_info,
            commands::image_import::check_file_exists,
            commands::image_import::update_node_image_path,
            commands::image_import::open_file_external,
            commands::image_import::set_paper_pdf_path,
            commands::image_import::get_paper_pdf_path,
            // Export commands
            commands::export::get_paper_nodes_by_layers,
            commands::export::export_bibtex_selected,
            commands::export::export_bibtex_to_file,
            // PDF export commands
            commands::pdf_export::get_export_sections,
            commands::pdf_export::update_export_section_order,
            commands::pdf_export::update_export_citation_style,
            commands::pdf_export::update_export_language,
            commands::pdf_export::update_export_style_config,
            commands::pdf_export::generate_export_pdf,
            // Usage tracking commands
            commands::usage::get_usage_summary,
            commands::usage::get_usage_history,
            commands::usage::clear_usage_log,
            // Agent node message commands
            commands::agent_node_messages::get_agent_node_messages,
            commands::agent_node_messages::add_agent_node_message,
            commands::agent_node_messages::delete_agent_node_message,
            // Sync commands
            commands::sync::sync_list_remote,
            commands::sync::sync_check_status,
            commands::sync::sync_upload,
            commands::sync::sync_download,
            commands::sync::sync_get_remote_stats,
        ])
        .on_window_event(|window, event| {
            // On macOS, clicking the red close button only closes the window
            // but keeps the app running. For a single-window app, quit entirely.
            if let tauri::WindowEvent::Destroyed = event {
                if window.label() == "main" {
                    window.app_handle().exit(0);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
