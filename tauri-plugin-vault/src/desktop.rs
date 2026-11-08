use std::{
    fs,
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};
use tauri_plugin_dialog::DialogExt;

use crate::{models::*, Error, Result};

pub fn init<R: Runtime, C: DeserializeOwned>(app: &AppHandle<R>, _api: PluginApi<R, C>) -> Result<Vault<R>> {
    Ok(Vault(app.clone()))
}

/// Desktop implementation: plain files under the picked folder.
pub struct Vault<R: Runtime>(AppHandle<R>);

/// Join a vault-relative path ("a/b.md") onto the root, refusing anything that could leave it.
fn join(root: &str, rel: &str) -> Result<PathBuf> {
    let mut p = PathBuf::from(root);
    for comp in Path::new(rel).components() {
        match comp {
            Component::Normal(c) => p.push(c),
            Component::CurDir => {}
            _ => return Err(Error::Msg(format!("invalid path: {rel}"))),
        }
    }
    Ok(p)
}

fn mtime_ms(meta: &fs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

/// Every file under `dir`, skipping hidden names (".supstack", ".trash", ".git", …) like the web version does.
fn walk(dir: &Path, prefix: &str, out: &mut Vec<Entry>) -> Result<()> {
    for item in fs::read_dir(dir)? {
        let item = item?;
        let name = item.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let rel = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
        let ft = item.file_type()?;
        if ft.is_dir() {
            walk(&item.path(), &rel, out)?;
        } else if ft.is_file() || ft.is_symlink() {
            if let Ok(meta) = fs::metadata(item.path()) {
                if meta.is_file() {
                    out.push(Entry { path: rel, mtime: mtime_ms(&meta), size: meta.len() });
                }
            }
        }
    }
    Ok(())
}

impl<R: Runtime> Vault<R> {
    pub fn pick(&self) -> Result<Option<Picked>> {
        let Some(picked) = self.0.dialog().file().set_title("Open vault folder").blocking_pick_folder() else {
            return Ok(None);
        };
        let path = picked.into_path().map_err(|e| Error::Msg(e.to_string()))?;
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string_lossy().into_owned());
        Ok(Some(Picked { root: path.to_string_lossy().into_owned(), name }))
    }

    pub fn list(&self, root: String) -> Result<Vec<Entry>> {
        list(&root)
    }

    pub fn read(&self, root: String, path: String, binary: bool) -> Result<ReadResult> {
        read(&root, &path, binary)
    }

    pub fn write(&self, root: String, path: String, text: Option<String>, base64: Option<String>) -> Result<f64> {
        write(&root, &path, text, base64)
    }

    pub fn remove(&self, root: String, path: String) -> Result<()> {
        remove(&root, &path)
    }

    pub fn remove_dir(&self, root: String, path: String) -> Result<()> {
        remove_dir(&root, &path)
    }

    pub fn list_dir(&self, root: String, path: String) -> Result<Vec<String>> {
        list_dir(&root, &path)
    }

    pub fn exists(&self, root: String, path: String) -> Result<bool> {
        exists(&root, &path)
    }
}

// The file operations themselves, apart from the app handle so they can be tested on a temporary folder.

fn list(root: &str) -> Result<Vec<Entry>> {
    let mut out = Vec::new();
    walk(Path::new(root), "", &mut out)?;
    Ok(out)
}

fn read(root: &str, path: &str, binary: bool) -> Result<ReadResult> {
    let p = join(root, path)?;
    let bytes = fs::read(&p)?;
    let meta = fs::metadata(&p)?;
    let data = if binary { STANDARD.encode(&bytes) } else { String::from_utf8_lossy(&bytes).into_owned() };
    Ok(ReadResult { data, mtime: mtime_ms(&meta), size: bytes.len() as u64 })
}

/// Writes through a temporary file and a rename, so other apps never see a half-written note.
fn write(root: &str, path: &str, text: Option<String>, base64: Option<String>) -> Result<f64> {
    let p = join(root, path)?;
    let bytes = match (text, base64) {
        (Some(t), _) => t.into_bytes(),
        (None, Some(b)) => STANDARD.decode(b).map_err(|e| Error::Msg(e.to_string()))?,
        (None, None) => Vec::new(),
    };
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent)?;
    }
    let file_name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = p.with_file_name(format!(".{file_name}.supstack-tmp"));
    fs::write(&tmp, &bytes)?;
    if fs::rename(&tmp, &p).is_err() {
        let _ = fs::remove_file(&tmp);
        fs::write(&p, &bytes)?;
    }
    Ok(mtime_ms(&fs::metadata(&p)?))
}

fn remove(root: &str, path: &str) -> Result<()> {
    fs::remove_file(join(root, path)?)?;
    Ok(())
}

fn remove_dir(root: &str, path: &str) -> Result<()> {
    fs::remove_dir_all(join(root, path)?)?;
    Ok(())
}

fn list_dir(root: &str, path: &str) -> Result<Vec<String>> {
    let mut names = Vec::new();
    for item in fs::read_dir(join(root, path)?)? {
        let item = item?;
        if item.file_type()?.is_file() {
            names.push(item.file_name().to_string_lossy().into_owned());
        }
    }
    Ok(names)
}

fn exists(root: &str, path: &str) -> Result<bool> {
    Ok(join(root, path)?.exists())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh folder per test, removed when it goes out of scope.
    struct Tmp(PathBuf);
    impl Tmp {
        fn new(name: &str) -> Self {
            let p = std::env::temp_dir().join(format!("supstack-desktop-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&p);
            fs::create_dir_all(&p).unwrap();
            Tmp(p)
        }
        fn root(&self) -> &str {
            self.0.to_str().unwrap()
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn join_stays_inside_the_vault() {
        let root = if cfg!(windows) { r"C:\vault" } else { "/vault" };
        assert_eq!(join(root, "a/b.md").unwrap(), Path::new(root).join("a").join("b.md"));
        assert_eq!(join(root, "./a.md").unwrap(), Path::new(root).join("a.md"));
        assert_eq!(join(root, "").unwrap(), PathBuf::from(root));
        for bad in ["../x.md", "a/../../x.md", "/etc/passwd"] {
            assert!(join(root, bad).is_err(), "{bad} must be refused");
        }
    }

    #[test]
    fn write_creates_folders_and_leaves_no_temporary_file() {
        let t = Tmp::new("write");
        let mtime = write(t.root(), "Cards/New/Note.md", Some("hello".into()), None).unwrap();
        assert!(mtime > 0.0);
        assert_eq!(fs::read_to_string(t.0.join("Cards/New/Note.md")).unwrap(), "hello");
        assert_eq!(list_dir(t.root(), "Cards/New").unwrap(), vec!["Note.md".to_string()], "no .supstack-tmp left behind");
        write(t.root(), "Cards/New/Note.md", Some("again".into()), None).unwrap();
        assert_eq!(fs::read_to_string(t.0.join("Cards/New/Note.md")).unwrap(), "again", "overwrites in place");
        assert!(write(t.root(), "../escape.md", Some("x".into()), None).is_err());
    }

    #[test]
    fn binary_files_round_trip_through_base64() {
        let t = Tmp::new("binary");
        let bytes: Vec<u8> = (0..=255).collect();
        write(t.root(), "img/a.png", None, Some(STANDARD.encode(&bytes))).unwrap();
        assert_eq!(fs::read(t.0.join("img/a.png")).unwrap(), bytes);
        let r = read(t.root(), "img/a.png", true).unwrap();
        assert_eq!(STANDARD.decode(r.data).unwrap(), bytes);
        assert_eq!(r.size, 256);
        assert!(write(t.root(), "bad.bin", None, Some("not base64!".into())).is_err());
        write(t.root(), "empty.txt", None, None).unwrap();
        assert_eq!(fs::read(t.0.join("empty.txt")).unwrap(), Vec::<u8>::new());
    }

    #[test]
    fn text_reads_replace_invalid_utf8() {
        let t = Tmp::new("utf8");
        fs::write(t.0.join("a.md"), [b'o', b'k', 0xff]).unwrap();
        assert_eq!(read(t.root(), "a.md", false).unwrap().data, "ok\u{fffd}");
        assert!(read(t.root(), "missing.md", false).is_err());
    }

    #[test]
    fn list_walks_folders_and_skips_hidden_names() {
        let t = Tmp::new("list");
        for p in ["a.md", "Cards/b.md", "Cards/Deep/c.png", ".supstack/settings.json", ".trash/old.md", "Cards/.hidden.md"] {
            write(t.root(), p, Some("x".into()), None).unwrap();
        }
        let mut paths: Vec<String> = list(t.root()).unwrap().into_iter().map(|e| e.path).collect();
        paths.sort();
        assert_eq!(paths, ["Cards/Deep/c.png", "Cards/b.md", "a.md"]);
        let e = list(t.root()).unwrap().into_iter().find(|e| e.path == "a.md").unwrap();
        assert_eq!(e.size, 1);
        assert!(e.mtime > 0.0);
    }

    #[test]
    fn remove_exists_and_remove_dir() {
        let t = Tmp::new("remove");
        write(t.root(), "x/a.md", Some("a".into()), None).unwrap();
        write(t.root(), "x/y/b.md", Some("b".into()), None).unwrap();
        assert!(exists(t.root(), "x/a.md").unwrap());
        assert!(exists(t.root(), "").unwrap(), "the vault itself");
        remove(t.root(), "x/a.md").unwrap();
        assert!(!exists(t.root(), "x/a.md").unwrap());
        assert!(remove(t.root(), "x/a.md").is_err(), "removing twice fails");
        assert_eq!(list_dir(t.root(), "x").unwrap(), Vec::<String>::new(), "folders are not listed as files");
        remove_dir(t.root(), "x").unwrap();
        assert!(!exists(t.root(), "x").unwrap());
        assert!(exists(t.root(), "../").is_err());
    }
}
