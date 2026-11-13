use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::{models::*, Result};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.supstack.vault";

pub fn init<R: Runtime, C: DeserializeOwned>(_app: &AppHandle<R>, api: PluginApi<R, C>) -> Result<Vault<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "VaultPlugin")?;
    #[cfg(target_os = "ios")]
    let handle: PluginHandle<R> = {
        let _ = api;
        return Err(crate::Error::Msg("iOS is not supported yet".into()));
    };
    Ok(Vault(handle))
}

/// Android implementation: the Kotlin `VaultPlugin` talks to the Storage Access Framework.
pub struct Vault<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Vault<R> {
    pub fn pick(&self) -> Result<Option<Picked>> {
        let r: PickResponse = self.0.run_mobile_plugin("pick", serde_json::json!({}))?;
        Ok(match (r.root, r.name) {
            (Some(root), Some(name)) => Some(Picked { root, name }),
            _ => None,
        })
    }

    pub fn list(&self, root: String) -> Result<Vec<Entry>> {
        let r: ListResponse = self.0.run_mobile_plugin("list", RootArgs { root })?;
        Ok(r.items)
    }

    pub fn read(&self, root: String, path: String, binary: bool) -> Result<ReadResult> {
        Ok(self.0.run_mobile_plugin("read", ReadArgs { root, path, binary })?)
    }

    pub fn write(&self, root: String, path: String, text: Option<String>, base64: Option<String>) -> Result<f64> {
        let r: MtimeResponse = self.0.run_mobile_plugin("write", WriteArgs { root, path, text, base64 })?;
        Ok(r.mtime)
    }

    pub fn remove(&self, root: String, path: String) -> Result<()> {
        let _: serde_json::Value = self.0.run_mobile_plugin("remove", PathArgs { root, path })?;
        Ok(())
    }

    pub fn remove_dir(&self, root: String, path: String) -> Result<()> {
        let _: serde_json::Value = self.0.run_mobile_plugin("remove_dir", PathArgs { root, path })?;
        Ok(())
    }

    pub fn list_dir(&self, root: String, path: String) -> Result<Vec<String>> {
        let r: NamesResponse = self.0.run_mobile_plugin("list_dir", PathArgs { root, path })?;
        Ok(r.names)
    }

    pub fn exists(&self, root: String, path: String) -> Result<bool> {
        let r: BoolResponse = self.0.run_mobile_plugin("exists", PathArgs { root, path })?;
        Ok(r.value)
    }

    /// The Storage Access Framework has no way to watch a folder: the page keeps polling.
    pub fn watch(&self, _root: String) -> Result<bool> {
        Ok(false)
    }

    pub fn unwatch(&self) -> Result<()> {
        Ok(())
    }
}
