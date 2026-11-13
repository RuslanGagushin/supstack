#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        // the folder picker on desktop (Android uses the system picker inside the vault plugin)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_vault::init())
        // reminders for tasks with a time: scheduled ahead on Android, shown when due on desktop (web/src/js/services/reminders.js)
        .plugin(tauri_plugin_notification::init());
    // updates from GitHub Releases, then a restart into the new version
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());
    builder
        .run(tauri::generate_context!())
        .expect("error while running Supstack");
}
