//! Watching the vault folder on desktop (spec PERF-3): the system tells the app which files changed, and the page
//! reads only those instead of listing the whole vault every few seconds. Changes come in batches: a burst of
//! events (an editor's save, a sync tool copying a folder) is sent once it has been quiet for `QUIET`.

use std::{
    collections::BTreeSet,
    fs,
    path::{Component, Path, PathBuf},
    sync::mpsc,
    thread,
    time::{Duration, Instant, UNIX_EPOCH},
};

use notify::{RecursiveMode, Watcher};
use serde::Serialize;

use crate::{Error, Result};

/// How long the folder must be quiet before a batch goes out.
const QUIET: Duration = Duration::from_millis(200);
/// A batch goes out after this long even if events keep coming.
const AT_MOST: Duration = Duration::from_secs(1);

/// One file that changed: its vault-relative path, and its modification time and size, or neither when it is gone.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Change {
    pub path: String,
    pub mtime: Option<f64>,
    pub size: Option<u64>,
}

/// The vault-relative path of `abs`, or None for the root itself, a path outside it, or anything hidden
/// (".git", ".supstack", ".trash", a ".note.md.supstack-tmp" file), as the listing leaves those out too.
pub(crate) fn relative(root: &Path, abs: &Path) -> Option<String> {
    let rel = abs.strip_prefix(root).ok()?;
    let mut parts = Vec::new();
    for c in rel.components() {
        match c {
            Component::Normal(s) => {
                let s = s.to_string_lossy();
                if s.starts_with('.') {
                    return None;
                }
                parts.push(s.into_owned());
            }
            _ => return None,
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("/"))
    }
}

/// What a changed path is now. A folder that appeared or went away is reported as each file inside it:
/// a new folder's files are listed; a folder that is gone is left to the page, which knows what was in it.
fn changes_for(root: &Path, rel: &str, out: &mut Vec<Change>) {
    let abs = root.join(rel);
    match fs::metadata(&abs) {
        Ok(meta) if meta.is_file() => out.push(Change { path: rel.to_owned(), mtime: Some(mtime_ms(&meta)), size: Some(meta.len()) }),
        Ok(meta) if meta.is_dir() => {
            if let Ok(items) = fs::read_dir(&abs) {
                for item in items.flatten() {
                    let name = item.file_name().to_string_lossy().into_owned();
                    if !name.starts_with('.') {
                        changes_for(root, &format!("{rel}/{name}"), out);
                    }
                }
            }
        }
        Ok(_) => {}
        Err(_) => out.push(Change { path: rel.to_owned(), mtime: None, size: None }),
    }
}

fn mtime_ms(meta: &fs::Metadata) -> f64 {
    meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as f64).unwrap_or(0.0)
}

/// A running watch; dropping it stops watching (and its thread ends).
pub struct Watch {
    pub root: String,
    _watcher: notify::RecommendedWatcher,
}

/// Watch `root` and call `send` with each batch of changes, from a thread of its own.
pub fn start(root: &str, send: impl Fn(Vec<Change>) + Send + 'static) -> Result<Watch> {
    let dir = PathBuf::from(root);
    let (tx, rx) = mpsc::channel::<PathBuf>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            if ev.kind.is_access() {
                return;
            }
            for p in ev.paths {
                let _ = tx.send(p);
            }
        }
    })
    .map_err(|e| Error::Msg(format!("can't watch the folder: {e}")))?;
    watcher.watch(&dir, RecursiveMode::Recursive).map_err(|e| Error::Msg(format!("can't watch the folder: {e}")))?;
    let base = dir.clone();
    thread::spawn(move || {
        // the watcher owns the sender: when the watch is dropped, recv fails and the thread ends
        while let Ok(first) = rx.recv() {
            let mut paths = BTreeSet::new();
            paths.insert(first);
            let started = Instant::now();
            loop {
                let left = AT_MOST.saturating_sub(started.elapsed());
                match rx.recv_timeout(QUIET.min(left)) {
                    Ok(p) => {
                        paths.insert(p);
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
                if left.is_zero() {
                    break;
                }
            }
            let rels: BTreeSet<String> = paths.iter().filter_map(|p| relative(&base, p)).collect();
            let mut changes = Vec::new();
            for rel in &rels {
                changes_for(&base, rel, &mut changes);
            }
            changes.dedup_by(|a, b| a.path == b.path);
            if !changes.is_empty() {
                send(changes);
            }
        }
    });
    Ok(Watch { root: root.to_owned(), _watcher: watcher })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    struct Tmp(PathBuf);
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn tmp(name: &str) -> Tmp {
        let p = std::env::temp_dir().join(format!("supstack-watch-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(p.join("cards")).unwrap();
        // the canonical path: macOS reports /private/var/… for /var/…
        Tmp(fs::canonicalize(&p).unwrap())
    }
    /// The batches seen so far, waiting up to two seconds until `until` holds.
    fn wait(seen: &Arc<Mutex<Vec<Change>>>, until: impl Fn(&[Change]) -> bool) -> Vec<Change> {
        let start = Instant::now();
        loop {
            let got = seen.lock().unwrap().clone();
            if until(&got) || start.elapsed() > Duration::from_secs(2) {
                return got;
            }
            thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn relative_paths_leave_out_hidden_files_and_the_outside() {
        let root = Path::new("/v");
        assert_eq!(relative(root, Path::new("/v/cards/A.md")).as_deref(), Some("cards/A.md"));
        assert_eq!(relative(root, Path::new("/v/.git/index")), None);
        assert_eq!(relative(root, Path::new("/v/cards/.A.md.supstack-tmp")), None);
        assert_eq!(relative(root, Path::new("/v")), None);
        assert_eq!(relative(root, Path::new("/other/A.md")), None);
    }

    #[test]
    fn a_file_written_elsewhere_is_reported_with_its_time_and_size_within_two_seconds() {
        let t = tmp("write");
        let seen = Arc::new(Mutex::new(Vec::new()));
        let s = seen.clone();
        let _w = start(&t.0.to_string_lossy(), move |c| s.lock().unwrap().extend(c)).unwrap();
        thread::sleep(Duration::from_millis(100));
        fs::write(t.0.join("cards/A.md"), "hello").unwrap();
        fs::write(t.0.join("cards/.A.md.supstack-tmp"), "hidden").unwrap();
        let got = wait(&seen, |c| c.iter().any(|x| x.path == "cards/A.md"));
        let a = got.iter().find(|x| x.path == "cards/A.md").expect("cards/A.md reported");
        assert_eq!(a.size, Some(5));
        assert!(a.mtime.unwrap() > 0.0);
        assert!(got.iter().all(|x| !x.path.contains(".supstack-tmp")), "hidden files are not reported: {got:?}");
    }

    #[test]
    fn a_deleted_file_is_reported_as_gone() {
        let t = tmp("delete");
        fs::write(t.0.join("cards/B.md"), "bye").unwrap();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let s = seen.clone();
        let _w = start(&t.0.to_string_lossy(), move |c| s.lock().unwrap().extend(c)).unwrap();
        thread::sleep(Duration::from_millis(100));
        fs::remove_file(t.0.join("cards/B.md")).unwrap();
        let got = wait(&seen, |c| c.iter().any(|x| x.path == "cards/B.md"));
        assert!(got.contains(&Change { path: "cards/B.md".into(), mtime: None, size: None }), "{got:?}");
    }

    #[test]
    fn a_folder_copied_in_is_reported_file_by_file() {
        let t = tmp("folder");
        let seen = Arc::new(Mutex::new(Vec::new()));
        let s = seen.clone();
        let _w = start(&t.0.to_string_lossy(), move |c| s.lock().unwrap().extend(c)).unwrap();
        thread::sleep(Duration::from_millis(100));
        let outside = t.0.with_extension("staging");
        let _ = fs::remove_dir_all(&outside);
        fs::create_dir_all(outside.join("Trip")).unwrap();
        fs::write(outside.join("Trip/Day 1.md"), "one").unwrap();
        fs::write(outside.join("Trip/Day 2.md"), "two").unwrap();
        fs::rename(outside.join("Trip"), t.0.join("cards/Trip")).unwrap();
        let _ = fs::remove_dir_all(&outside);
        let got = wait(&seen, |c| ["cards/Trip/Day 1.md", "cards/Trip/Day 2.md"].iter().all(|p| c.iter().any(|x| x.path == *p)));
        for p in ["cards/Trip/Day 1.md", "cards/Trip/Day 2.md"] {
            assert!(got.iter().any(|x| x.path == p && x.size == Some(3)), "{p} in {got:?}");
        }
    }
}
