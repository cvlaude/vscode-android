# Essential extensions

The export script reads installed manifests and builds VSIX files for portable packages. It records package hashes and excludes packages with Windows platform metadata or native executable modules. All 15 packages, including Workspace Mobile, were installed on the Android device. Desktop SCM renders its transferred draft queue, Codex opens its panel, and Codex Stats reads the imported account. The remaining extensions still need individual interaction checks; installation alone is not compatibility proof.

| Extension | Initial route |
| --- | --- |
| Add to .gitignore | Installed portable package |
| Codex | Official Linux ARM64 VSIX included in the runtime ZIP, plus the pinned local CLI; Windows package is excluded |
| Codex Stats | Installed portable package; account reading still needs runtime verification |
| Desktop SCM | Existing 0.1.9 VSIX plus transferred `.git/ghdesktop/queue.json` and referenced Git objects |
| Error Lens | Installed portable package |
| Font Preview | Installed portable package; installed Android fonts differ from Windows |
| inifmt | Installed portable package, subject to native-binary scan |
| Live Preview | Installed Microsoft package; preview must use the local workbench's port proxy |
| LLM Slop Checker | Installed portable package |
| PlainText+ | Installed portable package |
| Prettier | Installed portable package |
| Rainbow CSV | Installed portable package |
| Remove Comments | Official publisher VSIX downloaded for private installation |
| vscode-pdf | Installed portable package |

Code-server uses Open VSX by default. Microsoft Marketplace extensions may have separate distribution or runtime restrictions. This project does not modify extension manifests to bypass host checks or redistribute a patched Codex extension. Fetch an official Linux ARM64 package for private installation if available. Workspace Mobile's Codex button calls the existing extension's `chatgpt.openSidebar` command; use the local CLI in the integrated terminal if that extension cannot load under Code OSS.

Workspace Mobile uses VS Code's existing codicons. The launcher SVG icons use Material-style paths and a local workspace mark, without network fonts. The workbench's own Dark Modern theme and button components remain in use.
