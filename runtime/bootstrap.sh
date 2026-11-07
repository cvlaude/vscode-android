#!/data/data/com.termux/files/usr/bin/bash
set -eu

##########################################################################

project=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ -z "${PREFIX:-}" ] || [ ! -d /data/data/com.termux/files ]; then
  echo "Run this script inside Termux on Android."
  exit 1
fi
if [ -e "$HOME/storage" ]; then
  echo "Remove Termux's shared-storage grant in Android settings before setting up the isolated workspace."
  exit 1
fi
pkg install -y proot-distro python syncthing
if ! proot-distro login debian --isolated -- /bin/true >/dev/null 2>&1; then
  proot-distro install debian
fi
proot-distro login debian --isolated --bind "$project:/opt/workspace" -- /bin/bash /opt/workspace/runtime/install.sh
python "$project/runtime/extensions.py"
mkdir -p "$HOME/.local/bin"
cat > "$HOME/.local/bin/workspace" <<'LAUNCHER'
#!/data/data/com.termux/files/usr/bin/bash
set -eu
export HOME=/data/data/com.termux/files/home
export PREFIX=/data/data/com.termux/files/usr
export PATH="$PREFIX/bin:/system/bin"
export TMPDIR="$PREFIX/tmp"
export LD_PRELOAD="$PREFIX/lib/libtermux-exec.so"
if [ "${1:-}" = "--app" ]; then
  mkdir -p "$HOME/.local/share/workspace-sync"
  exec python "$PREFIX/var/lib/proot-distro/containers/debian/rootfs/opt/workspace-install/runtime/lifecycle.py" "$@" >> "$HOME/.local/share/workspace-sync/startup.log" 2>&1
fi
exec python "$PREFIX/var/lib/proot-distro/containers/debian/rootfs/opt/workspace-install/runtime/lifecycle.py" "$@"
LAUNCHER
chmod 700 "$HOME/.local/bin/workspace"
python "$project/runtime/commands.py"
printf '\nStart the workspace with: ~/.local/bin/workspace\n'
