# ADR 0010: Updates on request

- Status: accepted
- Date: 2026-11-05

## Context

Until 1.2, a new version meant downloading the installer from GitHub by hand. Zwopp runs
all day in the tray, so most people would never notice a new release. At the same time an
app that changes itself in the background is unwelcome, and the downloads are not code
signed.

## Decision

1. **Offer, never install by itself.** Zwopp looks for a new release 30 s after the start
   and then every six hours (`update.rs`, `tauri-plugin-updater`). A version found is
   offered in a banner above the library ("Update now", "Later") and as the first entry of
   the tray menu. It is downloaded and installed only after that click; on Windows the
   installer shows its progress (`installMode: passive`) and starts Zwopp again.
   *Settings › General › Updates* shows the version and looks for updates on request.
2. **Signed update files.** The release workflow signs the installers with a key of the
   project (`TAURI_SIGNING_PRIVATE_KEY`, a repository secret) and publishes `latest.json`
   with the release. The app checks every download against the public key in
   tauri.conf.json before installing it. This key is not a code-signing certificate: it
   does not silence the warnings of Windows and macOS for the first installation, but it
   makes sure an update comes from the project.
3. **Where to look:** `https://github.com/cwecode/zwopp/releases/latest/download/latest.json`.
   GitHub only resolves `latest` for published releases, so a draft is never offered.
4. **Development builds do not look for updates** (they would replace themselves with the
   installed app), unless `ZWOPP_UPDATE_ENDPOINT` points them at a `latest.json`, e.g. a
   local one to try the flow. The CI installer build leaves out the update files
   (`ci.conf.json`), since only releases have the signing key.

## Consequences

- 1.2.0 and older have no updater; the first version with it has to be installed by hand
  once.
- Losing the private key means installed apps can no longer verify updates: a new key
  needs a new version installed by hand. The key and its password belong in a password
  manager as well as in the repository secrets.
- No data is sent: the check is a plain download of `latest.json` from GitHub.
