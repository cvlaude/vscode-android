#!/bin/bash
set -eu

##########################################################################

cd /opt/workspace-install
umask 077
mkdir -p /root/.local/share/vscode-android
if [ -s /root/.local/share/vscode-android/runtime.pid ]; then
  oldpid=$(cat /root/.local/share/vscode-android/runtime.pid)
  if kill -0 "$oldpid" 2>/dev/null; then
    echo "The workspace runtime is already running."
    exit 1
  fi
fi
echo "$$" > /root/.local/share/vscode-android/runtime.pid
PASSWORD=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')
export PASSWORD
printf '%s' "$PASSWORD" > /root/.local/share/vscode-android/workbench-password
python3 runtime/copilot.py
code-server --bind-addr 127.0.0.1:8766 --auth password --disable-telemetry --disable-update-check --disable-extension GitHub.copilot --disable-extension GitHub.copilot-chat --enable-proposed-api openai.chatgpt --trusted-origins 127.0.0.1:8765 > /root/.local/share/vscode-android/workbench.log 2>&1 &
workbenchpid=$!
cleanup() {
  kill "$workbenchpid" 2>/dev/null || true
  wait "$workbenchpid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM
node companion/cli.mjs serve --follow
