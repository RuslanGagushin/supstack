const COMMANDS: &[&str] = &["pick", "list", "read", "write", "remove", "remove_dir", "list_dir", "exists", "git_sync", "git_info", "git_save_settings", "watch", "unwatch"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}
