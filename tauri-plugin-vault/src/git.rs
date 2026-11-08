//! Git sync for the vault: commit local changes, merge what the remote has, push.
//!
//! On desktop the vault folder itself is the repository. On Android the vault is a
//! `content://` tree that git cannot open, so a clone lives in the app's private storage
//! and is mirrored to and from the picked folder around every sync.

use std::{
    cell::{Cell, RefCell},
    path::{Path, PathBuf},
    rc::Rc,
    time::{SystemTime, UNIX_EPOCH},
};

use git2::{
    build::CheckoutBuilder, AnnotatedCommit, ConfigLevel, Cred, CredentialType, ErrorCode, FetchOptions, IndexEntry, MergeAnalysis,
    MergeOptions, PushOptions, RemoteCallbacks, Repository, RepositoryInitOptions, Signature,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use crate::{Error, Result};

const DEFAULT_IGNORE: &str = ".trash/\n.DS_Store\n*.supstack-tmp\n";
/// Section of the repository config that holds this app's settings, and the one versions up to 0.19 used.
const SECTION: &str = "supstack";
const OLD_SECTION: &str = "supsidian";
const STAGE_MASK: u16 = 0x3000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitConfig {
    pub remote: String,
    pub branch: String,
    pub username: String,
    pub token: String,
    pub author_name: String,
    pub author_email: String,
}

/// The sync settings as the page edits them. They live in the repository's own config
/// (.git/config, which is never pushed): the remote as `origin`, the author as `user.*`,
/// the rest under `supstack.*` (versions up to 0.19 used `supsidian.*`; it moves on the next save).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSettings {
    pub remote: String,
    pub branch: String,
    pub username: String,
    pub token: String,
    pub author_name: String,
    pub author_email: String,
    pub auto: bool,
    pub minutes: u32,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitReport {
    /// local changes were committed
    pub committed: bool,
    /// the remote had new commits that are now in the vault
    pub pulled: bool,
    /// new commits went to the remote
    pub pushed: bool,
    /// files that changed on both sides: ours stayed, theirs was saved next to it
    pub conflicts: Vec<String>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub is_repo: bool,
    pub remote: Option<String>,
    pub branch: Option<String>,
    /// settings saved in the repository by this app, None when it never saved any
    pub settings: Option<GitSettings>,
    /// where the previous sync died, when it never finished
    pub previous_crash: Option<String>,
}

static TRACE: std::sync::Mutex<Option<PathBuf>> = std::sync::Mutex::new(None);

/// Breadcrumbs of the sync in progress, so a crash that kills the process leaves a hint about where it happened.
pub(crate) fn trace(msg: &str) {
    use std::io::Write;
    let Some(path) = TRACE.lock().ok().and_then(|g| g.clone()) else { return };
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{msg}");
    }
}

/// The unfinished trace of an earlier run: its last lines, or None when it ended with "done" or an error.
fn unfinished(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    let last = text.lines().last()?;
    if last == "done" || last.starts_with("error:") {
        return None;
    }
    let lines: Vec<_> = text.lines().collect();
    Some(lines[lines.len().saturating_sub(4)..].join(" → "))
}

fn begin_trace(path: &Path) {
    let _ = std::fs::write(path, "");
    if let Ok(mut g) = TRACE.lock() {
        *g = Some(path.to_path_buf());
    }
}

/// Android keeps its trusted roots in a format OpenSSL does not read, so libgit2 is handed the Mozilla roots directly.
/// Returns how many were added.
#[cfg(not(windows))]
#[cfg_attr(desktop, allow(dead_code))]
pub(crate) fn install_roots() -> Result<usize> {
    use std::os::raw::{c_int, c_long, c_void};
    // the raw option call below needs an initialized libgit2 (and OpenSSL on Linux and Android);
    // git2 does this on its first call, which may not have happened yet
    libgit2_sys::init();
    let mut added = 0;
    for cert in webpki_root_certs::TLS_SERVER_ROOT_CERTS {
        let der: &[u8] = cert.as_ref();
        let mut p = der.as_ptr();
        // SAFETY: `der` outlives the call; libgit2 takes its own reference to the X509 it is given
        unsafe {
            let x = openssl_sys::d2i_X509(std::ptr::null_mut(), &mut p, der.len() as c_long);
            if x.is_null() {
                continue;
            }
            let rc = libgit2_sys::git_libgit2_opts(libgit2_sys::GIT_OPT_ADD_SSL_X509_CERT as c_int, x as *mut c_void);
            openssl_sys::X509_free(x);
            if rc < 0 {
                return Err(git2::Error::last_error(rc).into());
            }
        }
        added += 1;
    }
    Ok(added)
}

pub fn info<R: Runtime>(app: &AppHandle<R>, root: String) -> Result<GitInfo> {
    let dir = workdir(app, &root)?;
    #[cfg(mobile)]
    let previous_crash = dir.parent().and_then(|b| unfinished(&b.join("sync-trace.log")));
    #[cfg(desktop)]
    let previous_crash = None;
    let Ok(repo) = Repository::open(&dir) else { return Ok(GitInfo { previous_crash, ..GitInfo::default() }) };
    let remote = repo.find_remote("origin").ok().and_then(|r| r.url().map(str::to_owned));
    let branch = repo.head().ok().and_then(|h| h.shorthand().map(str::to_owned));
    let settings = read_settings(&repo);
    Ok(GitInfo { is_repo: true, remote, branch, settings, previous_crash })
}

/// Saves the settings into the repository, creating it once there is a remote to sync with.
pub fn save_settings<R: Runtime>(app: &AppHandle<R>, root: String, settings: GitSettings) -> Result<()> {
    let dir = workdir(app, &root)?;
    let repo = match Repository::open(&dir) {
        Ok(r) => r,
        Err(_) if settings.remote.trim().is_empty() => return Ok(()),
        Err(_) => init(&dir, &settings.branch)?,
    };
    write_settings(&repo, &settings)
}

fn init(dir: &Path, branch: &str) -> Result<Repository> {
    let branch = if branch.trim().is_empty() { "main" } else { branch.trim() };
    Ok(Repository::init_opts(dir, RepositoryInitOptions::new().initial_head(branch))?)
}

pub(crate) fn read_settings(repo: &Repository) -> Option<GitSettings> {
    let cfg = repo.config().ok()?.open_level(ConfigLevel::Local).ok()?;
    // `<section>.auto` is always written, so it tells whether this app saved settings here
    let (section, auto) = [SECTION, OLD_SECTION].into_iter().find_map(|s| Some((s, cfg.get_bool(&format!("{s}.auto")).ok()?)))?;
    let get = |key: &str| cfg.get_string(key).unwrap_or_default();
    let ours = |key: &str| get(&format!("{section}.{key}"));
    Some(GitSettings {
        remote: get("remote.origin.url"),
        branch: ours("branch"),
        username: ours("username"),
        token: ours("token"),
        author_name: get("user.name"),
        author_email: get("user.email"),
        auto,
        minutes: cfg.get_i64(&format!("{section}.minutes")).ok().and_then(|m| u32::try_from(m).ok()).unwrap_or(5),
    })
}

pub(crate) fn write_settings(repo: &Repository, s: &GitSettings) -> Result<()> {
    let remote = s.remote.trim();
    match repo.find_remote("origin") {
        Ok(r) if r.url() == Some(remote) => {}
        Ok(_) if remote.is_empty() => repo.remote_delete("origin")?,
        Ok(_) => repo.remote_set_url("origin", remote)?,
        Err(_) if remote.is_empty() => {}
        Err(_) => {
            repo.remote("origin", remote)?;
        }
    }
    let mut cfg = repo.config()?.open_level(ConfigLevel::Local)?;
    cfg.set_bool(&format!("{SECTION}.auto"), s.auto)?;
    cfg.set_i64(&format!("{SECTION}.minutes"), i64::from(s.minutes.max(1)))?;
    let mut put = |key: &str, value: &str| -> Result<()> {
        let value = value.trim();
        if !value.is_empty() {
            return Ok(cfg.set_str(key, value)?);
        }
        match cfg.remove(key) {
            Err(e) if e.code() != ErrorCode::NotFound => Err(e.into()),
            _ => Ok(()),
        }
    };
    put(&format!("{SECTION}.branch"), &s.branch)?;
    put(&format!("{SECTION}.username"), &s.username)?;
    put(&format!("{SECTION}.token"), &s.token)?;
    put("user.name", &s.author_name)?;
    put("user.email", &s.author_email)?;
    for key in ["branch", "username", "token", "auto", "minutes"] {
        put(&format!("{OLD_SECTION}.{key}"), "")?;
    }
    Ok(())
}

pub fn sync<R: Runtime>(app: &AppHandle<R>, root: String, cfg: GitConfig) -> Result<GitReport> {
    if cfg.remote.trim().is_empty() {
        return Err(Error::Msg("no remote URL".into()));
    }
    #[cfg(desktop)]
    {
        let _ = app;
        sync_repo(Path::new(&root), &cfg)
    }
    #[cfg(mobile)]
    {
        let base = workdir(app, &root)?;
        if let Some(base) = base.parent() {
            begin_trace(&base.join("sync-trace.log"));
        }
        let r = mirror::sync(app, root, cfg);
        trace(&match &r {
            Ok(_) => "done".to_string(),
            Err(e) => format!("error: {e}"),
        });
        r
    }
}

fn workdir<R: Runtime>(app: &AppHandle<R>, root: &str) -> Result<PathBuf> {
    #[cfg(desktop)]
    {
        let _ = app;
        Ok(PathBuf::from(root))
    }
    #[cfg(mobile)]
    {
        mirror::tree(app, root)
    }
}

fn callbacks<'a>(cfg: &'a GitConfig) -> RemoteCallbacks<'a> {
    let mut cb = RemoteCallbacks::new();
    let tries = Cell::new(0);
    cb.credentials(move |_url, _user, allowed| {
        tries.set(tries.get() + 1);
        if tries.get() > 2 || cfg.token.is_empty() || !allowed.contains(CredentialType::USER_PASS_PLAINTEXT) {
            return Err(git2::Error::from_str("authentication failed: check the access token"));
        }
        let user = if cfg.username.is_empty() { "git" } else { cfg.username.as_str() };
        Cred::userpass_plaintext(user, &cfg.token)
    });
    cb
}

/// Days since 1970 → (year, month, day).
fn civil(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

fn stamp() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    let (y, m, d) = civil(secs.div_euclid(86_400));
    let t = secs.rem_euclid(86_400);
    format!("{y:04}-{m:02}-{d:02} {:02}.{:02}.{:02}", t / 3600, t % 3600 / 60, t % 60)
}

/// "Cards/Note.md" → "Cards/Note (conflict 2026-10-28 10.00.00).md"
fn conflict_path(path: &str) -> String {
    let (dir, name) = path.rsplit_once('/').map_or(("", path), |(d, n)| (d, n));
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    let file = format!("{stem} (conflict {}){ext}", stamp());
    if dir.is_empty() { file } else { format!("{dir}/{file}") }
}

fn commit_local(repo: &Repository, sig: &Signature) -> Result<bool> {
    let mut index = repo.index()?;
    // half-written files (`.name.supstack-tmp`) never go into a commit, even where an older .gitignore lists only the old suffix
    let mut skip_tmp = |path: &Path, _: &[u8]| -> i32 { i32::from(path.to_string_lossy().ends_with(".supstack-tmp")) };
    index.add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, Some(&mut skip_tmp))?;
    index.update_all(["*"].iter(), None)?;
    index.write()?;
    let tree_id = index.write_tree()?;
    let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    if parent.as_ref().map(|p| p.tree_id()) == Some(tree_id) {
        return Ok(false);
    }
    if parent.is_none() && index.is_empty() {
        return Ok(false);
    }
    let tree = repo.find_tree(tree_id)?;
    let parents: Vec<_> = parent.iter().collect();
    repo.commit(Some("HEAD"), sig, sig, &format!("Supstack sync {}", stamp()), &tree, &parents)?;
    Ok(true)
}

fn force_checkout(repo: &Repository) -> Result<()> {
    repo.checkout_head(Some(CheckoutBuilder::new().force()))?;
    Ok(())
}

/// Merge `their` into HEAD. Files changed on both sides keep our text; theirs is saved beside it.
fn merge(repo: &Repository, their: &AnnotatedCommit, sig: &Signature, report: &mut GitReport) -> Result<()> {
    let our = repo.head()?.peel_to_commit()?;
    let their_commit = repo.find_commit(their.id())?;
    let mut opts = MergeOptions::new();
    opts.find_renames(true);
    let mut idx = repo.merge_commits(&our, &their_commit, Some(&opts))?;
    if idx.has_conflicts() {
        let conflicts: Vec<_> = idx.conflicts()?.collect::<std::result::Result<_, _>>()?;
        for c in conflicts {
            let entry = c.our.as_ref().or(c.their.as_ref()).or(c.ancestor.as_ref()).ok_or_else(|| Error::Msg("empty conflict".into()))?;
            let path = String::from_utf8_lossy(&entry.path).into_owned();
            idx.conflict_remove(Path::new(&path))?;
            let resolved = |e: &IndexEntry| IndexEntry { flags: e.flags & !STAGE_MASK, ..clone_entry(e) };
            match (&c.our, &c.their) {
                (Some(o), Some(t)) => {
                    idx.add(&resolved(o))?;
                    let copy = conflict_path(&path);
                    idx.add(&IndexEntry { path: copy.clone().into_bytes(), ..resolved(t) })?;
                    report.conflicts.push(copy);
                }
                // deleted on one side, edited on the other: keep the edit
                (Some(e), None) | (None, Some(e)) => idx.add(&resolved(e))?,
                (None, None) => {}
            }
        }
    }
    let tree = repo.find_tree(idx.write_tree_to(repo)?)?;
    repo.commit(Some("HEAD"), sig, sig, &format!("Supstack merge {}", stamp()), &tree, &[&our, &their_commit])?;
    force_checkout(repo)
}

fn clone_entry(e: &IndexEntry) -> IndexEntry {
    IndexEntry {
        ctime: e.ctime,
        mtime: e.mtime,
        dev: e.dev,
        ino: e.ino,
        mode: e.mode,
        uid: e.uid,
        gid: e.gid,
        file_size: e.file_size,
        id: e.id,
        flags: e.flags,
        flags_extended: e.flags_extended,
        path: e.path.clone(),
    }
}

pub(crate) fn sync_repo(dir: &Path, cfg: &GitConfig) -> Result<GitReport> {
    let branch = if cfg.branch.trim().is_empty() { "main" } else { cfg.branch.trim() };
    let repo = match Repository::open(dir) {
        Ok(r) => r,
        Err(_) => init(dir, branch)?,
    };
    match repo.find_remote("origin") {
        Ok(r) if r.url() == Some(cfg.remote.as_str()) => {}
        Ok(_) => repo.remote_set_url("origin", &cfg.remote)?,
        Err(_) => {
            repo.remote("origin", &cfg.remote)?;
        }
    }
    let name = if cfg.author_name.is_empty() { "Supstack" } else { cfg.author_name.as_str() };
    let email = if cfg.author_email.is_empty() { "supstack@localhost" } else { cfg.author_email.as_str() };
    let sig = Signature::now(name, email)?;
    trace("fetch");
    let mut fo = FetchOptions::new();
    fo.remote_callbacks(callbacks(cfg));
    repo.find_remote("origin")?.fetch(&["+refs/heads/*:refs/remotes/origin/*"], Some(&mut fo), None)?;

    let remote_ref = format!("refs/remotes/origin/{branch}");
    if repo.find_reference(&remote_ref).is_err() {
        let ignore = dir.join(".gitignore");
        if !ignore.exists() {
            std::fs::write(&ignore, DEFAULT_IGNORE)?;
        }
    }
    trace("commit");
    let mut report = GitReport { committed: commit_local(&repo, &sig)?, ..Default::default() };

    trace("merge");
    if let Ok(r) = repo.find_reference(&remote_ref) {
        let their = repo.reference_to_annotated_commit(&r)?;
        if repo.head().is_err() {
            // nothing here yet: take the remote branch as is
            repo.reference(&format!("refs/heads/{branch}"), their.id(), true, "supstack: first pull")?;
            repo.set_head(&format!("refs/heads/{branch}"))?;
            force_checkout(&repo)?;
            report.pulled = true;
        } else {
            let (analysis, _) = repo.merge_analysis(&[&their])?;
            if analysis.contains(MergeAnalysis::ANALYSIS_UP_TO_DATE) {
            } else if analysis.contains(MergeAnalysis::ANALYSIS_FASTFORWARD) {
                let head = repo.head()?;
                let name = head.name().ok_or_else(|| Error::Msg("detached HEAD".into()))?.to_owned();
                repo.reference(&name, their.id(), true, "supstack: fast-forward")?;
                force_checkout(&repo)?;
                report.pulled = true;
            } else {
                merge(&repo, &their, &sig, &mut report)?;
                report.pulled = true;
            }
        }
    }

    trace("push");
    let Ok(head) = repo.head() else { return Ok(report) };
    let local = head.peel_to_commit()?.id();
    let remote_id = repo.find_reference(&remote_ref).ok().and_then(|r| r.target());
    if remote_id != Some(local) {
        let rejected = Rc::new(RefCell::new(None::<String>));
        let mut cb = callbacks(cfg);
        let seen = rejected.clone();
        cb.push_update_reference(move |r, status| {
            if let Some(s) = status {
                *seen.borrow_mut() = Some(format!("{r}: {s}"));
            }
            Ok(())
        });
        let mut po = PushOptions::new();
        po.remote_callbacks(cb);
        repo.find_remote("origin")?.push(&[format!("refs/heads/{branch}:refs/heads/{branch}")], Some(&mut po))?;
        if let Some(msg) = rejected.borrow().clone() {
            return Err(Error::Msg(format!("push rejected ({msg})")));
        }
        report.pushed = true;
    }
    Ok(report)
}

#[cfg(mobile)]
mod mirror {
    use std::{
        collections::{HashMap, HashSet},
        fs,
        path::{Path, PathBuf},
        time::UNIX_EPOCH,
    };

    use base64::{engine::general_purpose::STANDARD, Engine};
    use tauri::{AppHandle, Manager, Runtime};

    use super::{sync_repo, GitConfig, GitReport};
    use crate::{Error, Result, VaultExt};

    type Snapshot = HashMap<String, (u64, u128)>;

    fn fnv(s: &str) -> String {
        let mut h: u64 = 0xcbf29ce484222325;
        for b in s.bytes() {
            h = (h ^ u64::from(b)).wrapping_mul(0x100000001b3);
        }
        format!("{h:016x}")
    }

    fn base<R: Runtime>(app: &AppHandle<R>, root: &str) -> Result<PathBuf> {
        let dir = app.path().app_data_dir().map_err(|e| Error::Msg(e.to_string()))?;
        Ok(dir.join("git").join(fnv(root)))
    }

    pub fn tree<R: Runtime>(app: &AppHandle<R>, root: &str) -> Result<PathBuf> {
        Ok(base(app, root)?.join("tree"))
    }

    /// Visible files under `dir` with size and mtime, like the vault listing.
    fn snapshot(dir: &Path) -> Snapshot {
        fn walk(dir: &Path, prefix: &str, out: &mut Snapshot) {
            let Ok(rd) = fs::read_dir(dir) else { return };
            for item in rd.flatten() {
                let name = item.file_name().to_string_lossy().into_owned();
                if name.starts_with('.') {
                    continue;
                }
                let rel = if prefix.is_empty() { name } else { format!("{prefix}/{name}") };
                let Ok(meta) = item.metadata() else { continue };
                if meta.is_dir() {
                    walk(&item.path(), &rel, out);
                } else if meta.is_file() {
                    let m = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_nanos());
                    out.insert(rel, (meta.len(), m));
                }
            }
        }
        let mut out = Snapshot::new();
        walk(dir, "", &mut out);
        out
    }

    fn load_manifest(path: &Path) -> HashMap<String, (f64, u64)> {
        fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    }

    pub fn sync<R: Runtime>(app: &AppHandle<R>, root: String, cfg: GitConfig) -> Result<GitReport> {
        let vault = app.vault();
        let base = base(app, &root)?;
        let work = base.join("tree");
        fs::create_dir_all(&work)?;
        static ROOTS: std::sync::Once = std::sync::Once::new();
        let mut roots = Ok(0);
        ROOTS.call_once(|| roots = super::install_roots());
        roots?;
        let manifest_path = base.join("manifest.json");
        let manifest = load_manifest(&manifest_path);

        // 1. the picked folder → the clone, so git sees the edits made since the last sync
        super::trace("list");
        let listing = vault.list(root.clone())?;
        let mut present = HashSet::new();
        for e in &listing {
            present.insert(e.path.clone());
            let dest = work.join(&e.path);
            if manifest.get(&e.path) == Some(&(e.mtime, e.size)) && dest.exists() {
                continue;
            }
            super::trace(&format!("copy-in {} ({} bytes)", e.path, e.size));
            let bytes = STANDARD.decode(vault.read(root.clone(), e.path.clone(), true)?.data).map_err(|e| Error::Msg(e.to_string()))?;
            if fs::read(&dest).map_or(true, |old| old != bytes) {
                if let Some(parent) = dest.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::write(&dest, bytes)?;
            }
        }
        for path in snapshot(&work).keys() {
            if !present.contains(path) {
                let _ = fs::remove_file(work.join(path));
            }
        }

        // 2. git
        super::trace("git");
        let before = snapshot(&work);
        let report = sync_repo(&work, &cfg)?;
        let after = snapshot(&work);

        // 3. what git changed in the clone → the picked folder
        for (path, stamp) in &after {
            if before.get(path) != Some(stamp) {
                super::trace(&format!("copy-out {path}"));
                let bytes = fs::read(work.join(path))?;
                vault.write(root.clone(), path.clone(), None, Some(STANDARD.encode(bytes)))?;
            }
        }
        for path in before.keys() {
            if !after.contains_key(path) {
                let _ = vault.remove(root.clone(), path.clone());
            }
        }

        super::trace("manifest");
        let fresh: HashMap<String, (f64, u64)> = vault.list(root)?.into_iter().map(|e| (e.path, (e.mtime, e.size))).collect();
        fs::write(&manifest_path, serde_json::to_string(&fresh).unwrap_or_default())?;
        Ok(report)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn cfg(remote: &Path) -> GitConfig {
        GitConfig {
            remote: remote.to_string_lossy().into_owned(),
            branch: "main".into(),
            username: String::new(),
            token: String::new(),
            author_name: String::new(),
            author_email: String::new(),
        }
    }

    #[test]
    fn civil_dates() {
        assert_eq!(civil(0), (1970, 1, 1));
        assert_eq!(civil(-1), (1969, 12, 31));
        assert_eq!(civil(19_782), (2024, 2, 29), "leap day");
        assert_eq!(civil(20_755), (2026, 10, 29));
        assert_eq!(civil(11_016), (2000, 2, 29), "a leap century");
    }

    #[test]
    fn conflict_names_keep_folder_and_extension() {
        let re = |p: &str| {
            let c = conflict_path(p);
            let at = c.find(" (conflict ").unwrap_or_else(|| panic!("{c}"));
            (c[..at].to_string(), c[at + 11..at + 30].len(), c[at + 30..].to_string())
        };
        assert_eq!(re("Cards/Note.md"), ("Cards/Note".into(), 19, ").md".into()));
        assert_eq!(re("Note.md"), ("Note".into(), 19, ").md".into()));
        assert_eq!(re("a/b/archive.tar.gz"), ("a/b/archive.tar".into(), 19, ").gz".into()));
        assert_eq!(re(".gitignore"), (".gitignore".into(), 19, ")".into()), "a leading dot is not an extension");
        assert_eq!(re("dir.v2/README"), ("dir.v2/README".into(), 19, ")".into()));
    }

    #[cfg(not(windows))]
    #[test]
    fn mozilla_roots_parse() {
        // desktop libgit2 may refuse the option (system TLS); only the parsing is checked here
        let n = webpki_root_certs::TLS_SERVER_ROOT_CERTS.len();
        assert!(n > 100);
        let _ = install_roots();
    }

    #[test]
    fn settings_live_in_the_repository_config() {
        let dir = std::env::temp_dir().join(format!("supstack-settings-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let repo = init(&dir, "main").unwrap();
        assert_eq!(read_settings(&repo), None, "nothing saved yet");

        let mut s = GitSettings {
            remote: "https://example.com/notes.git".into(),
            branch: "main".into(),
            username: "git".into(),
            token: "secret".into(),
            author_name: "Me".into(),
            author_email: "me@example.com".into(),
            auto: false,
            minutes: 15,
        };
        write_settings(&repo, &s).unwrap();
        assert_eq!(read_settings(&repo).as_ref(), Some(&s));
        assert_eq!(repo.find_remote("origin").unwrap().url(), Some("https://example.com/notes.git"));

        s.token.clear();
        s.remote = "https://example.com/other.git".into();
        write_settings(&repo, &s).unwrap();
        assert_eq!(read_settings(&repo).as_ref(), Some(&s), "a cleared field is removed");

        s.remote.clear();
        write_settings(&repo, &s).unwrap();
        assert!(repo.find_remote("origin").is_err(), "a cleared remote is removed");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn settings_saved_by_older_versions_are_read_and_moved() {
        let dir = std::env::temp_dir().join(format!("supstack-old-settings-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let repo = init(&dir, "main").unwrap();
        {
            let mut cfg = repo.config().unwrap().open_level(ConfigLevel::Local).unwrap();
            cfg.set_str(&format!("{OLD_SECTION}.branch"), "notes").unwrap();
            cfg.set_str(&format!("{OLD_SECTION}.token"), "secret").unwrap();
            cfg.set_bool(&format!("{OLD_SECTION}.auto"), true).unwrap();
            cfg.set_i64(&format!("{OLD_SECTION}.minutes"), 7).unwrap();
        }
        let s = read_settings(&repo).expect("old settings are read");
        assert_eq!((s.branch.as_str(), s.token.as_str(), s.auto, s.minutes), ("notes", "secret", true, 7));

        write_settings(&repo, &s).unwrap();
        let cfg = repo.config().unwrap().open_level(ConfigLevel::Local).unwrap();
        assert!(cfg.get_bool(&format!("{OLD_SECTION}.auto")).is_err(), "the old section is cleared");
        assert_eq!(cfg.get_string(&format!("{SECTION}.token")).unwrap(), "secret");
        assert_eq!(read_settings(&repo).as_ref(), Some(&s));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn two_devices_converge_and_keep_both_sides_of_a_conflict() {
        let tmp = std::env::temp_dir().join(format!("supstack-git-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let (remote, a, b) = (tmp.join("remote.git"), tmp.join("a"), tmp.join("b"));
        Repository::init_bare(&remote).unwrap();
        fs::create_dir_all(&a).unwrap();
        fs::create_dir_all(&b).unwrap();
        let c = cfg(&remote);

        fs::write(a.join("Note.md"), "one\n").unwrap();
        let r = sync_repo(&a, &c).unwrap();
        assert!(r.committed && r.pushed);

        let r = sync_repo(&b, &c).unwrap();
        assert!(r.pulled && !r.pushed);
        assert_eq!(fs::read_to_string(b.join("Note.md")).unwrap(), "one\n");

        fs::write(a.join("Note.md"), "from a\n").unwrap();
        fs::write(b.join("Note.md"), "from b\n").unwrap();
        fs::write(b.join("Other.md"), "new\n").unwrap();
        sync_repo(&a, &c).unwrap();
        let r = sync_repo(&b, &c).unwrap();
        assert_eq!(r.conflicts.len(), 1, "{r:?}");
        assert_eq!(fs::read_to_string(b.join("Note.md")).unwrap(), "from b\n");
        assert_eq!(fs::read_to_string(b.join(&r.conflicts[0])).unwrap(), "from a\n");
        assert!(r.pushed);

        let r = sync_repo(&a, &c).unwrap();
        assert!(r.pulled);
        assert_eq!(fs::read_to_string(a.join("Other.md")).unwrap(), "new\n");
        assert_eq!(fs::read_to_string(a.join("Note.md")).unwrap(), "from b\n");
        let _ = fs::remove_dir_all(&tmp);
    }
}
