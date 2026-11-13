#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        // the folder picker on desktop (Android uses the system picker inside the vault plugin)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_vault::init())
        // reminders for tasks with a time: scheduled ahead on Android, shown when due on desktop (web/src/js/services/reminders.js)
        .plugin(tauri_plugin_notification::init());
    // updates from GitHub Releases, then a restart into the new version; the quick capture shortcut
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(capture::CaptureShortcut::default())
        .invoke_handler(tauri::generate_handler![capture::set_capture_shortcut]);
    builder
        .run(tauri::generate_context!())
        .expect("error while running Supstack");
}

/// Quick capture from anywhere (spec TASK-5): a shortcut the system passes to the app while another one is in front.
/// It brings the Supstack window forward and tells the page, which opens its capture form. The page sets the
/// shortcut from its settings at start and when it changes there; None turns it off.
#[cfg(desktop)]
mod capture {
    use std::sync::Mutex;
    use tauri::{AppHandle, Emitter, Manager, State};
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

    #[derive(Default)]
    pub struct CaptureShortcut(Mutex<Option<String>>);

    #[tauri::command]
    pub fn set_capture_shortcut(app: AppHandle, state: State<'_, CaptureShortcut>, shortcut: Option<String>) -> Result<(), String> {
        let mut cur = state.0.lock().unwrap_or_else(|e| e.into_inner());
        let wanted = shortcut.map(|s| s.trim().to_owned()).filter(|s| !s.is_empty());
        if *cur == wanted {
            return Ok(());
        }
        if let Some(old) = cur.take() {
            let _ = app.global_shortcut().unregister(old.as_str());
        }
        let Some(new) = wanted else { return Ok(()) };
        app.global_shortcut()
            .on_shortcut(new.as_str(), |app, _shortcut, event| {
                if event.state != ShortcutState::Pressed {
                    return;
                }
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.unminimize();
                    let _ = w.show();
                    let _ = w.set_focus();
                }
                let _ = app.emit("quick-capture", ());
            })
            .map_err(|e| e.to_string())?;
        *cur = Some(new);
        Ok(())
    }
}
