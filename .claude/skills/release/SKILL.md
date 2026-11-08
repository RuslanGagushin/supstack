---
name: release
description: Release a new Supstack version — bump the version everywhere, commit "Release X.Y.Z", tag vX.Y.Z and push so GitHub Actions builds the Windows, macOS and Android apps and publishes the GitHub release. Use when the user asks to release, ship, publish, cut a version or "push and release".
---

# Releasing Supstack

A release is a version bump commit plus a `vX.Y.Z` tag. Pushing the tag runs `.github/workflows/apps.yml`
("Build apps"), which builds the apps, signs the desktop updates, writes `latest.json` and publishes the
GitHub release with generated notes. Nothing is built or uploaded by hand.

## 1. Check the tree

- On `main`, working tree clean apart from what the user wants in the release (`git status -sb`).
  Uncommitted work the user asked for gets its own commit first, never mixed into the release commit.
- `npm test` passes (needs the installed Chrome). Don't release on red tests.
- Last version: `git tag --sort=-creatordate | head -1`. What's new: `git log --oneline <last tag>..HEAD`.

## 2. Pick the version

Semver from the commits since the last tag: new features → minor (0.11.0 → 0.12.0),
only fixes → patch (0.12.0 → 0.12.1). If the user names a version, use theirs.

## 3. Bump it in all five places (keep them equal)

| File | What |
| --- | --- |
| `package.json` | `"version"` |
| `package-lock.json` | the top `"version"` and `packages[""].version` (the first two, lines ~3 and ~9) |
| `src-tauri/Cargo.toml` | `version` under `[package]` |
| `src-tauri/Cargo.lock` | `version` of the `name = "supstack"` package (not other crates) |
| `src-tauri/tauri.conf.json` | `"version"` |

The page's `APP_VERSION` is not one of them: `scripts/page.mjs` fills it in from `package.json` when it builds the page.
Check with `git diff | grep "^[-+][^-+]"`: exactly six old/new version pairs (package-lock.json has two), nothing else.
Run `npm test` again.

## 4. Commit, tag, push

Commit only those five files. The message is `Release X.Y.Z`, then a short plain-language paragraph of what
changed for the user (features first, no commit hashes), then the attribution line the session asks for:

```
Release 0.12.0

Callouts can be folded… Tables are edited in place… The app icon is…

Co-Authored-By: …
```

Then a lightweight tag on that commit and push both (the user asking to release is the go-ahead to push):

```bash
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

## 5. Follow the build

- `gh run list --limit 3` shows "Build apps" and "Tests" for the tag. A build takes about 15 minutes.
  Don't poll in a loop: check once later, or `gh run watch <id>` in the background.
- On failure: `gh run view <id> --log-failed`, fix on `main`, then move the tag:
  `git tag -f vX.Y.Z && git push -f origin vX.Y.Z` (only while the release isn't public yet), or release a patch.
- When it's done, `gh release view vX.Y.Z` should list: the `.dmg`, `Supstack.app.tar.gz` + `.sig`,
  the `.msi`, the `-setup.exe` + `.sig`, `app-universal-release.apk` and `latest.json`.
  A missing `.sig` / `latest.json` means the `TAURI_SIGNING_PRIVATE_KEY` secret is gone: the apps won't self-update.

## 6. Report

Tell the user the version, the commit, the release URL
(`https://github.com/RuslanGagushin/supstack/releases/tag/vX.Y.Z`) and whether the build has finished.
