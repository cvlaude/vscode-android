#!/bin/bash
set -eu

##########################################################################

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git nodejs npm python3 unzip
project=/opt/workspace
mkdir -p /opt/workspace-install
cp -a "$project/." /opt/workspace-install/
cd /opt/workspace-install
version=$(node -p 'require("./runtime/versions.json").codeserver')
architecture=$(uname -m)
case "$architecture" in
  aarch64) architecture=arm64 ;;
  x86_64) architecture=amd64 ;;
  *) echo "Unsupported architecture: $architecture"; exit 1 ;;
esac
archive="code-server-$version-linux-$architecture.tar.gz"
curl --fail --location --retry 3 --output "/opt/$archive" "https://github.com/coder/code-server/releases/download/v$version/$archive"
curl --fail --location --retry 3 --output /opt/checksums.txt "https://github.com/coder/code-server/releases/download/v$version/sha256sum.txt"
cd /opt
awk -v archive="$archive" '$2 == archive || $2 == "*" archive {print}' checksums.txt > selectedchecksum.txt
test -s selectedchecksum.txt
sha256sum --check selectedchecksum.txt
tar -xzf "$archive"
ln -sf "/opt/code-server-$version-linux-$architecture/bin/code-server" /usr/local/bin/code-server
cd /opt/workspace-install
codexversion=$(node -p 'require("./runtime/versions.json").codex')
npm install --global "@openai/codex@$codexversion"
mkdir -p /root/.local/share/code-server/User /root/.codex
cp runtime/mobile/settings.json /root/.local/share/code-server/User/settings.json
cp runtime/mobile/keybindings.json /root/.local/share/code-server/User/keybindings.json
if [ ! -e /root/.codex/config.toml ]; then
  cp runtime/codex/config.toml /root/.codex/config.toml
fi
for package in /opt/workspace-install/packages/extensions/*.vsix; do
  [ -e "$package" ] || continue
  code-server --install-extension "$package"
done
node companion/cli.mjs help
printf '\nInstalled. Start with ~/.local/bin/workspace in Termux.\n'
