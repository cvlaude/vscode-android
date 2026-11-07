# Workspace for Android

A local Code OSS workbench, Android WebView shell, and Windows/Android handoff companion. The editor and extension host run on the phone through code-server in Termux. Windows can be powered off after a complete handoff.

The runtime and existing ChatGPT login have been checked on an Android 15 ARM64 phone. The upstream Codex sandbox currently fails on this device with exit code 182, including an allowed workspace write. Automatic approval remains restricted. The Android APK uses the local runtime; set it up and seed the repository over Wi-Fi or USB before relying on mobile data.

## Project mirrors

The connected phone is paired with native Syncthing over encrypted LAN connections. It receives five projects: example-site, example-pages, example-game, example-portal and example-engine. Small code copies arrive first, followed by Codex chats active within the past 14 days, then full repositories. Builds, dependency caches and credentials are excluded. Git history, index and Desktop SCM drafts travel with the full repository. Working copies omit desktop reflogs alongside credentialed Git config and hooks; current refs, staged objects and draft refs still undergo integrity checks.

Open the launcher's Projects list to see progress. **Open code** creates an editable source copy while media and history are still arriving. **Open repository** requires a completed transfer and Git integrity check. Each kind uses a separate working folder; reopening it returns to the existing folder. Upgrading the current code copy carries its edits into the complete repository and preserves competing changes as conflicts. Incoming mirror folders remain separate.

The PC watcher starts at Windows sign-in, refreshes recent chats and code links, and resumes the transfer phases. Its private configuration and progress receipt live beside the dedicated Syncthing configuration. Reinstall it with `scripts/installmirror.ps1 -mirrorhome CONFIGURATION_FOLDER -executable SYNCTHING_EXE`. Pairing a different phone requires its Syncthing device ID and matching receive-only folders; the current pairing is private device setup, not part of the APK.

Background commands use hidden Windows jobs with bounded execution and descendant cleanup. Known code links and recent chat selection refresh every minute. New code files are discovered when the Git index changes or every ten minutes; the full project mirror watches files directly. Project markers live at `.claude/.stfolder`, excluded from transfers and working copies. Existing configurations can move their markers with `python runtime/markers.py --config PATH_TO_CONFIG_XML`. The helper pauses one folder at a time and preserves its marker contents. See [Syncthing's marker setting](https://docs.syncthing.net/users/config.html#config-option-folder.markername).

LAN transfers are unlimited. The phone's internet transfer limit is 5 KB/s, with compression and resumable blocks. Files already received remain on the phone when the PC loses power. Phone synchronization runs while Workspace is open or backgrounded and stops when Workspace closes.

## Snapshot handoffs on Windows

Requires Node 22.13 or newer and Git. From this repository in PowerShell:

```powershell
node companion/cli.mjs configure --repo "$env:USERPROFILE\Documents\GitHub\example-site"
node companion/cli.mjs capture
node companion/cli.mjs serve --lan --watch
```

Open the local launcher link printed by the companion. The pairing secret is in `%LOCALAPPDATA%\vscode-android\config.json`. Keep it private. The LAN listener exposes only authenticated, encrypted snapshot reads; launcher controls accept loopback requests only. Allow the chosen port on your private network if Windows Firewall requires it. A phone hotspot or USB network connection can provide a local link without internet.

## Android

1. Install Termux from its official F-Droid or GitHub distribution, and install `dist/workspace-android-debug.apk`. Keep Termux's storage, contacts and other personal-data permissions disabled.
2. Transfer and extract `dist/workspace-runtime.zip` into Termux's private home. A one-time local download from Windows avoids granting shared-storage access. See [setup](docs/setup.md).
3. In Termux, run `bash workspace/runtime/bootstrap.sh`. This installs Debian, a pinned code-server and Codex. Installation needs internet for Debian packages and runtime dependencies.
4. Run `~/.local/bin/workspace` once. Paste its local launcher link into the Android app. Allow Workspace's Termux command permission when prompted. Later launches start the runtime and open the editor automatically.
5. Open Connection, enter the PC's LAN address and pairing secret, and use an unlimited transfer limit for the first copy. Receive changes, then create a working copy and open the editor.
6. Select 5 KB/s for subsequent transfers. The runtime also checks the paired PC every 30 seconds and caches changed chunks. A completed snapshot remains available after the PC disconnects. Creating a working copy is an explicit action and does not overwrite an active copy.

Keep Termux installed and exempt it from battery optimization if Android suspends it. The app uses Termux's foreground service to start a stopped runtime. Cold startup into the actual editor was verified on the connected phone. Android can still stop background work; reopening Workspace reconnects or restarts it.

The app uses fullscreen landscape across the available screen width. View contains Zoom In, Zoom Out and Reset Zoom. The initial scale is 66%; changes are saved. Hold an editor tab briefly, then drag over the editor body to preview a split or move it into another group. Pane and group headers have close buttons. Copilot is removed from the Android runtime; Codex is retained. Workspace trust is disabled in the Android profile.

Keyboard input requests disable fullscreen extraction in landscape. A Bluetooth keyboard or a USB keyboard through a compatible USB-C OTG adapter can avoid the soft keyboard. In Android's physical-keyboard settings, turn off showing the on-screen keyboard while a hardware keyboard is connected.

Closing or force-stopping Workspace disconnects its authenticated lifetime socket. The runtime saves and stops its processes, shuts down synchronization and ends Termux. Reopening Workspace starts them again. Android's Termux notification permission is disabled on the configured phone; a new phone can disable Termux notifications in Android app settings.

## Codex login and sessions

The existing file-based login can be exported without a new device code:

```powershell
node companion/cli.mjs auth-export --source "$env:USERPROFILE\.codex\auth.json" --file ".\dist\codex-login.handoff"
```

Enter the pairing secret at the prompt, transfer the encrypted file, then use Connection > Import Codex credentials on Android. Credentials are never included in ordinary repository snapshots. Import into the active runtime home before starting Codex. The existing login was recognized on the configured phone; long-term token refresh has not been checked.

Select session files explicitly when configuring a repository:

```powershell
node companion/cli.mjs configure --repo "C:\path\to\repo" --codexhome "$env:USERPROFILE\.codex" --session "sessions/2026/11/06/rollout-example.jsonl"
```

Raw selected rollouts are retained under the restored copy's `codex` folder. Use [session import](docs/setup.md#session-import) to copy them to the runtime Codex home and update session metadata paths. Live SQLite databases, Windows executables, MCP server commands and the desktop's full-access configuration are not copied into the runtime. Existing session instructions may still reference Windows paths; review the continuation context before running tools.

## Returning phone work

On Android save a snapshot and export a handoff, or start a LAN companion listener and pull from Windows. Import on Windows, then compare against the original PC-to-phone snapshot ID:

```powershell
node companion/cli.mjs import --file "H:\path\phone.handoff"
node companion/cli.mjs merge --base ORIGINALSNAPSHOTID --repo "C:\path\to\repo"
```

Changed-on-both-sides files are retained as conflicts. Replaced and deleted content is saved in the companion's recovery folder. This merge updates working files only. To inspect returned Git refs, index and Desktop SCM drafts, restore the incoming snapshot into a separate empty directory and open that repository. It does not replace your live PC branch, index or draft queue automatically.

For an offline handoff, `export --file PATH.handoff`, `import --file PATH.handoff`, and `restore --destination EMPTYFOLDER` work without a running LAN server.

## Extensions and layout

[The mobile profile](runtime/mobile/settings.json) uses Dark Modern, the top activity bar, wrapping, enlarged code text, autosave and a compact menu. Workspace Mobile adds touch controls for Explorer, Desktop SCM, Live Preview, Codex and recovery snapshots. Use the normal editor split and view movement controls to arrange the explorer/editor/preview/Codex panes from the mockup. Narrow screens can hide individual panes.

Run `scripts/exportextensions.ps1` to package installed portable extensions and the existing Desktop SCM VSIX. Windows-specific Codex binaries are excluded. [Extension notes](docs/extensions.md) distinguish packaged files from actual Android compatibility.

## Build and checks

```powershell
npm test
npm run check
scripts\buildnative.ps1
scripts\package.ps1
```

The native Android build uses the installed Windows Android SDK and JDK 17 directly. A Gradle 8.11.1 project and `scripts/build.ps1` are also supplied; its first build may need to fetch dependencies. Debug signing is for local installation. Node/Git tests cover encrypted handoffs, integrity, safe restore, conflicts, staged objects, authentication and replay prevention. Set `DESKTOP_SCM_QUEUE_MODULE` to the desktop extension's `src/queue.js` to include its actual queue integration check.

See [security](docs/security.md) before changing Codex approvals. Code editing and local preview work without internet once installed. Codex inference still needs an internet connection; a 5 KB/s connection can make large prompts or reconnections slow.
