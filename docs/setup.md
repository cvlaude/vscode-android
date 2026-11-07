# First setup

The configured phone also uses native Syncthing for the five selected repositories and recent chats. See [project mirrors](../README.md#project-mirrors) for its priority copies and Windows sign-in watcher. A code copy can be edited before the full Git history and assets finish arriving. Keep incoming caches separate from working folders.

Run `scripts/buildnative.ps1` for the Android debug APK, `scripts/exportextensions.ps1` for portable extensions, and `scripts/package.ps1` for the runtime ZIP and mobile-controls VSIX. The packaging script accepts `-destination H:\path\dist` to write the large ZIP to another drive. It streams packages into the archive without a second full staging copy. Private state and credentials are excluded.

To transfer the runtime ZIP without shared-storage permissions, run this in Windows PowerShell from the repository:

```powershell
python -m http.server 8775 --bind 0.0.0.0 --directory .\dist
```

Only serve a directory containing distributable packages. Keep encrypted credential handoffs elsewhere while this server runs. On the phone's Termux terminal, using the PC's local address:

```sh
pkg install curl unzip
curl --fail --output workspace-runtime.zip http://192.168.1.4:8775/workspace-runtime.zip
mkdir -p workspace
unzip workspace-runtime.zip -d workspace
bash workspace/runtime/bootstrap.sh
```

Stop the Windows transfer server after the download. Setup is intended for a local connection while power and Wi-Fi are available. The extension importer installs only the supplied VSIX files and does not fetch optional extension-pack members. It uses native Termux file operations to avoid slow PRoot extraction of large packages. It requires proot-distro 5. Debian package installation still downloads packages on the phone; this is not a fully offline rootfs installer. Do not start this initial installation at 5 KB/s.

After setup, run `~/.local/bin/workspace` once and save its launcher link in the Android app. Bootstrap enables `allow-external-apps` in Termux's settings, preserving an existing configuration. Grant Workspace the Android permission to run Termux commands when prompted. Subsequent app launches start the runtime through Termux's foreground service and open the editor. This cold-start path was checked on the Android 15 device without entering another terminal command. Termux may still suspend background processes under Android battery restrictions. The installed runtime does not require the source ZIP to remain mounted.

# Pair and seed

Start `serve --lan --watch` on Windows and pair the phone with the PC secret through the local launcher. Both devices must use the same pairing secret. The PC's config file stores it; do not paste it in issue reports or screenshots. The phone automatically checks for incoming snapshots every 30 seconds while its runtime is running. Mirroring caches a complete snapshot without changing an active repository.

Use Receive changes, verify the saved snapshot time, and create a working copy. This initializes a separate repository with its Git history, staged index and Desktop SCM queue. The first copy has no credentialed remotes or Git hooks. Review and add an SSH/HTTPS remote separately if direct GitHub operations are needed. Existing desktop GitHub OAuth tokens and credential-manager state are not copied.

The native mirror Projects list manages the five configured projects within the same launcher. Separate snapshot companions can use their own `CONTINUITY_HOME` folders and ports. Multi-root workspaces can be opened within code-server; snapshot handoffs remain configured per repository.

# Session import

Close the Codex extension/CLI on Android before importing session files. A restored handoff retains selected raw sessions under `RESTORE/codex/sessions`. Run the import helper inside the Android runtime:

```sh
node /opt/workspace-install/scripts/importsessions.mjs --source /path/to/restored/codex --repo /path/to/fallback/workspace --mapping /path/to/project-paths.json
```

The optional mapping file maps desktop project roots to Android working folders. Sessions without a matching project use the fallback workspace. Desktop multi-root chats can record the default workspace path even when their work concerns another project; select the appropriate Android folder when continuing them.

The helper copies session JSONL files, updates `session_meta.payload.cwd`, preserves differing phone conversations and keeps incoming versions in recovery. It streams large files, reuses unchanged imports and writes a durable import receipt. Damaged sessions and title-index lines are recorded as errors while valid sessions continue. It does not transplant a live SQLite database. Keep the raw handoff as a recovery source.

Session import and reading a copied thread through Codex's native app-server were checked on an Android phone. Differing conversations are retained in recovery, and damaged files are preserved and reported. Inference and long-term login refresh remain separate checks.

Import the separate encrypted login through Connection before launching Codex. The runtime uses its private `/root/.codex` home. Windows session instructions and historical tool outputs retain their original paths; send a continuation noting the new workspace location before tool work. A currently running desktop turn cannot migrate mid-execution.

# Device acceptance checks

Before relying on this for a cutoff, verify all of these on the phone:

1. Create and save a file in the real editor, restart the runtime, and reopen it with Wi-Fi and PC disconnected.
2. Open Explorer, Desktop SCM, Live Preview and Codex through the mobile controls; test keyboard, text selection, scrolling, rotation and the soft keyboard.
3. Import the encrypted login, read a copied thread and finish one short Codex turn using mobile data. Inspect token refresh errors without posting tokens.
4. Run the sandbox probe, retain its receipt, and leave automatic approval restricted if any check fails.
5. Transfer a snapshot at 5 KB/s, interrupt it, reconnect, and confirm completed chunks are reused. Inspect the saved time before the PC disconnects.
6. Make conflicting edits on both devices, return the phone snapshot and inspect the recovery files. Verify queued draft trees with Desktop SCM without committing.

ADB is not required for ordinary use. Runtime installation, the existing login cache, and the sandbox probe have now been checked on a real Android 15 ARM64 device. The sandbox probe fails during initialization with exit 182, including its allowed write. The remaining interaction and mobile-network checks must pass before relying on this during a cutoff.
