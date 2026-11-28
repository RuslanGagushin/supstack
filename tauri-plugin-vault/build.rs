const COMMANDS: &[&str] = &[
    "pick",
    "list",
    "read",
    "write",
    "remove",
    "remove_dir",
    "list_dir",
    "exists",
    "git_sync",
    "git_info",
    "git_save_settings",
    "watch",
    "unwatch",
    "take_shared",
    "update_task_widget",
    "take_task_widget_action",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}
