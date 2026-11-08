//! Vault access for Supstack: the user picks a folder once, then the page lists, reads,
//! writes and deletes files inside it by vault-relative paths ("Cards/Note.md").

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

mod commands;
mod error;
mod git;
mod models;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

#[cfg(desktop)]
use desktop::Vault;
#[cfg(mobile)]
use mobile::Vault;

pub use error::{Error, Result};
pub use models::*;

/// Access the vault API from any `Manager` (app handle, window, …).
pub trait VaultExt<R: Runtime> {
    fn vault(&self) -> &Vault<R>;
}

impl<R: Runtime, T: Manager<R>> VaultExt<R> for T {
    fn vault(&self) -> &Vault<R> {
        self.state::<Vault<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("vault")
        .invoke_handler(tauri::generate_handler![
            commands::pick,
            commands::list,
            commands::read,
            commands::write,
            commands::remove,
            commands::remove_dir,
            commands::list_dir,
            commands::exists,
            commands::git_sync,
            commands::git_info,
            commands::git_save_settings,
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let vault = mobile::init(app, api)?;
            #[cfg(desktop)]
            let vault = desktop::init(app, api)?;
            app.manage(vault);
            Ok(())
        })
        .build()
}
