use serde::{Deserialize, Serialize};

/// A vault the user picked: a folder path on desktop, a `content://` tree URI on Android.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Picked {
    pub root: String,
    pub name: String,
}

/// One file in the vault. `mtime` is milliseconds since 1970 (a JS number).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub path: String,
    pub mtime: f64,
    pub size: u64,
}

/// File contents: UTF-8 text, or base64 when `binary` was asked for.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadResult {
    pub data: String,
    pub mtime: f64,
    pub size: u64,
}

// Payloads and replies of the Android side.
#[cfg(mobile)]
#[derive(Serialize)]
pub struct RootArgs {
    pub root: String,
}
#[cfg(mobile)]
#[derive(Serialize)]
pub struct PathArgs {
    pub root: String,
    pub path: String,
}
#[cfg(mobile)]
#[derive(Serialize)]
pub struct ReadArgs {
    pub root: String,
    pub path: String,
    pub binary: bool,
}
#[cfg(mobile)]
#[derive(Serialize)]
pub struct WriteArgs {
    pub root: String,
    pub path: String,
    pub text: Option<String>,
    pub base64: Option<String>,
}
#[cfg(mobile)]
#[derive(Deserialize)]
pub struct PickResponse {
    pub root: Option<String>,
    pub name: Option<String>,
}
#[cfg(mobile)]
#[derive(Deserialize)]
pub struct ListResponse {
    pub items: Vec<Entry>,
}
#[cfg(mobile)]
#[derive(Deserialize)]
pub struct NamesResponse {
    pub names: Vec<String>,
}
#[cfg(mobile)]
#[derive(Deserialize)]
pub struct BoolResponse {
    pub value: bool,
}
#[cfg(mobile)]
#[derive(Deserialize)]
pub struct MtimeResponse {
    pub mtime: f64,
}
