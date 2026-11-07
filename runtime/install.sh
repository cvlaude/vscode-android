#!/bin/bash
set -eu

##########################################################################

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl git python3 unzip xz-utils libstdc++6
project=/opt/workspace
mkdir -p /opt/workspace-install
cp -a "$project/." /opt/workspace-install/
cd /opt/workspace-install
version=$(python3 -c 'import json; print(json.load(open("runtime/versions.json"))["codeserver"])')
architecture=$(uname -m)
case "$architecture" in
  aarch64) architecture=arm64 ;;
  x86_64) architecture=amd64 ;;
  *) echo "Unsupported architecture: $architecture"; exit 1 ;;
esac
archive="code-server-$version-linux-$architecture.tar.gz"
if [ -f "$project/packages/runtime/$archive" ]; then
  cp "$project/packages/runtime/$archive" "/opt/$archive"
else
  curl --fail --location --connect-timeout 20 --max-time 240 --retry 2 --output "/opt/$archive" "https://github.com/coder/code-server/releases/download/v$version/$archive"
fi
checksum=$(python3 -c 'import json,sys; print(json.load(open("runtime/versions.json"))["checksums"][sys.argv[1]])' "$architecture")
test -n "$checksum"
cd /opt
printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check -
tar -xzf "$archive"
ln -sf "/opt/code-server-$version-linux-$architecture/bin/code-server" /usr/local/bin/code-server
cd /opt/workspace-install
if ! command -v node >/dev/null 2>&1 || ! node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)'; then
  nodeversion=$(python3 -c 'import json; print(json.load(open("runtime/versions.json"))["node"])')
  nodearchitecture=$architecture
  [ "$architecture" != amd64 ] || nodearchitecture=x64
  nodearchive="node-v$nodeversion-linux-$nodearchitecture.tar.xz"
  curl --fail --location --connect-timeout 20 --max-time 240 --retry 2 --output "/opt/$nodearchive" "https://nodejs.org/dist/v$nodeversion/$nodearchive"
  curl --fail --location --connect-timeout 20 --max-time 60 --retry 2 --output /opt/nodechecksums.txt "https://nodejs.org/dist/v$nodeversion/SHASUMS256.txt"
  cd /opt
  awk -v archive="$nodearchive" '$2 == archive {print}' nodechecksums.txt > nodeselectedchecksum.txt
  test -s nodeselectedchecksum.txt
  sha256sum --check nodeselectedchecksum.txt
  tar -xJf "$nodearchive" --strip-components=1 -C /usr/local
  cd /opt/workspace-install
fi
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
