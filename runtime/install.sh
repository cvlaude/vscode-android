#!/bin/bash
set -eu

##########################################################################

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl git python3 unzip xz-utils libstdc++6
project=/opt/workspace
mkdir -p /opt/workspace-install
for folder in companion shell runtime scripts; do
  cp -a "$project/$folder" /opt/workspace-install/
done
cp "$project/package.json" /opt/workspace-install/package.json
cd /opt/workspace-install
version=$(python3 -c 'import json; print(json.load(open("runtime/versions.json"))["codeserver"])')
architecture=$(uname -m)
case "$architecture" in
  aarch64) architecture=arm64 ;;
  x86_64) architecture=amd64 ;;
  *) echo "Unsupported architecture: $architecture"; exit 1 ;;
esac
archive="code-server-$version-linux-$architecture.tar.gz"
checksum=$(python3 -c 'import json,sys; print(json.load(open("runtime/versions.json"))["checksums"][sys.argv[1]])' "$architecture")
test -n "$checksum"
if ! printf '%s  %s\n' "$checksum" "/opt/$archive" | sha256sum --check --status 2>/dev/null; then
  if [ -f "$project/packages/runtime/$archive" ]; then
    cp "$project/packages/runtime/$archive" "/opt/$archive"
  else
    curl --fail --location --connect-timeout 20 --max-time 240 --retry 2 --continue-at - --output "/opt/$archive" "https://github.com/coder/code-server/releases/download/v$version/$archive"
  fi
fi
cd /opt
printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check -
if [ ! -e "/opt/code-server-$version-linux-$architecture/.workspacecomplete" ]; then
  tar -xzf "$archive"
  touch "/opt/code-server-$version-linux-$architecture/.workspacecomplete"
fi
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
if ! command -v codex >/dev/null 2>&1 || [ "$(codex --version)" != "codex-cli $codexversion" ]; then
  npm install --global "@openai/codex@$codexversion"
fi
mkdir -p /root/.local/share/code-server/User /root/.codex
cp runtime/mobile/settings.json /root/.local/share/code-server/User/settings.json
cp runtime/mobile/keybindings.json /root/.local/share/code-server/User/keybindings.json
if [ ! -e /root/.codex/config.toml ]; then
  cp runtime/codex/config.toml /root/.codex/config.toml
fi
if [ ! -e /root/.codex/AGENTS.md ]; then
  cp runtime/codex/instructions.md /root/.codex/AGENTS.md
fi
node companion/cli.mjs help
printf '\nInstalled. Start with ~/.local/bin/workspace in Termux.\n'
