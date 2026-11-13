use std::{
    collections::HashSet,
    fs,
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_dialog::DialogExt;

use crate::{models::*, Error, Result};

pub fn init<R: Runtime, C: DeserializeOwned>(app: &AppHandle<R>, _api: PluginApi<R, C>) -> Result<Vault<R>> {
    let file = app.path().app_config_dir().ok().map(|d| d.join("vaults.json"));
    Ok(Vault { app: app.clone(), roots: Roots::load(file), watch: Mutex::new(None) })
}

/// Desktop implementation: plain files under the picked folder.
pub struct Vault<R: Runtime> {
    app: AppHandle<R>,
    roots: Roots,
    /// the folder being watched for outside changes (one at a time: the open vault)
    watch: Mutex<Option<crate::watch::Watch>>,
}

/// The folders the user picked in the app's own folder dialog. The page names the vault by its path, and only those
/// folders are served: a script that got into the page cannot reach the rest of the disk. They are kept in the
/// app's config folder, so a vault opens again on the next launch without being picked again.
pub(crate) struct Roots {
    file: Option<PathBuf>,
    /// None until the file exists: the first launch after an update from a version that kept no list
    known: Mutex<Option<HashSet<String>>>,
}

impl Roots {
    pub(crate) fn load(file: Option<PathBuf>) -> Self {
        let known = file
            .as_ref()
            .and_then(|f| fs::read_to_string(f).ok())
            .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
            .map(|v| v.into_iter().collect());
        Roots { file, known: Mutex::new(known) }
    }

    fn save(&self, known: &HashSet<String>) {
        let Some(file) = &self.file else { return };
        let mut list: Vec<_> = known.iter().collect();
        list.sort();
        if let Some(dir) = file.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let _ = fs::write(file, serde_json::to_string_pretty(&list).unwrap_or_default());
    }

    /// The user picked `root`.
    pub(crate) fn add(&self, root: &str) {
        let mut g = self.known.lock().unwrap_or_else(|e| e.into_inner());
        let known = g.get_or_insert_with(HashSet::new);
        if known.insert(root.to_owned()) {
            self.save(known);
        }
    }

    /// May the page use `root`? On the first launch after the update the app reopens the folder it had open,
    /// which the user picked before there was a list: that one is taken as picked.
    pub(crate) fn check(&self, root: &str) -> Result<()> {
        let mut g = self.known.lock().unwrap_or_else(|e| e.into_inner());
        match &mut *g {
            Some(known) if known.contains(root) => Ok(()),
            Some(_) => Err(Error::Msg(format!("open this folder from the app first: {root}"))),
            None => {
                let known = HashSet::from([root.to_owned()]);
                self.save(&known);
                *g = Some(known);
                Ok(())
            }
        }
    }
}

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
        let Some(picked) = self.app.dialog().file().set_title("Open vault folder").blocking_pick_folder() else {
            return Ok(None);
        };
        let path = picked.into_path().map_err(|e| Error::Msg(e.to_string()))?;
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string_lossy().into_owned());
        let root = path.to_string_lossy().into_owned();
        self.roots.add(&root);
        Ok(Some(Picked { root, name }))
    }

    /// Refuses a folder the user did not pick (see [`Roots`]).
    pub(crate) fn check_root(&self, root: &str) -> Result<()> {
        self.roots.check(root)
    }

    pub fn list(&self, root: String) -> Result<Vec<Entry>> {
        self.check_root(&root)?;
        list(&root)
    }

    pub fn read(&self, root: String, path: String, binary: bool) -> Result<ReadResult> {
        self.check_root(&root)?;
        read(&root, &path, binary)
    }

    pub fn write(&self, root: String, path: String, text: Option<String>, base64: Option<String>) -> Result<f64> {
        self.check_root(&root)?;
        write(&root, &path, text, base64)
    }

    pub fn remove(&self, root: String, path: String) -> Result<()> {
        self.check_root(&root)?;
        remove(&root, &path)
    }

    pub fn remove_dir(&self, root: String, path: String) -> Result<()> {
        self.check_root(&root)?;
        remove_dir(&root, &path)
    }

    pub fn list_dir(&self, root: String, path: String) -> Result<Vec<String>> {
        self.check_root(&root)?;
        list_dir(&root, &path)
    }

    pub fn exists(&self, root: String, path: String) -> Result<bool> {
        self.check_root(&root)?;
        exists(&root, &path)
    }

    /// Watch `root` instead of the folder watched so far; each batch of changes is sent to the page as a
    /// "vault://changed" event with { root, changes: [{ path, mtime, size }] } (mtime and size null: the file is gone).
    pub fn watch(&self, root: String) -> Result<bool> {
        self.check_root(&root)?;
        let mut g = self.watch.lock().unwrap_or_else(|e| e.into_inner());
        if g.as_ref().is_some_and(|w| w.root == root) {
            return Ok(true);
        }
        *g = None;
        let app = self.app.clone();
        let r = root.clone();
        *g = Some(crate::watch::start(&root, move |changes| {
            let _ = app.emit("vault://changed", serde_json::json!({ "root": r, "changes": changes }));
        })?);
        Ok(true)
    }

    pub fn unwatch(&self) -> Result<()> {
        *self.watch.lock().unwrap_or_else(|e| e.into_inner()) = None;
        Ok(())
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
    let size = bytes.len() as u64;
    let data = if binary {
        STANDARD.encode(&bytes)
    } else {
        // replacing the bad bytes would damage the file on its next save
        String::from_utf8(bytes).map_err(|_| Error::Msg(format!("{path} is not UTF-8 text")))?
    };
    Ok(ReadResult { data, mtime: mtime_ms(&meta), size })
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
    fn only_picked_folders_are_served_and_the_list_is_kept() {
        let t = Tmp::new("roots");
        let file = t.0.join("config/vaults.json");
        let roots = Roots::load(Some(file.clone()));
        assert!(roots.check("/old/vault").is_ok(), "the first launch after the update keeps the folder the app reopens");
        assert!(roots.check("/somewhere/else").is_err(), "then only picked folders");
        roots.add("/picked");
        assert!(roots.check("/picked").is_ok());

        let again = Roots::load(Some(file));
        assert!(again.check("/old/vault").is_ok() && again.check("/picked").is_ok(), "the list survives a restart");
        assert!(again.check("/").is_err() && again.check("/old/vault/..").is_err());

        let fresh = Roots::load(Some(t.0.join("none/vaults.json")));
        fresh.add("/a");
        assert!(fresh.check("/b").is_err(), "a list started by a pick trusts nothing else");
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
    fn text_reads_refuse_what_is_not_utf8() {
        let t = Tmp::new("utf8");
        fs::write(t.0.join("a.md"), [b'o', b'k', 0xff]).unwrap();
        let e = read(t.root(), "a.md", false).unwrap_err().to_string();
        assert!(e.contains("not UTF-8"), "{e}");
        assert_eq!(STANDARD.decode(read(t.root(), "a.md", true).unwrap().data).unwrap(), [b'o', b'k', 0xff], "as binary it reads");
        fs::write(t.0.join("b.md"), "привет").unwrap();
        assert_eq!(read(t.root(), "b.md", false).unwrap().data, "привет");
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
