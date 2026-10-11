#!/usr/bin/env bash
# Test the normal AppImage launcher without forcing an Electron display backend.
set -euo pipefail
image=${1:-"dist/Neo-AI-$(node -p 'require("./package.json").version')-linux-x86_64.AppImage"}
runtime=$(mktemp -d)
export XDG_RUNTIME_DIR="$runtime"
export WAYLAND_DISPLAY="neo-test-wayland-$$"
compositor=
cleanup() {
  if [[ -n "$compositor" ]]; then kill "$compositor" 2>/dev/null || true; wait "$compositor" 2>/dev/null || true; fi
  rm -rf -- "$runtime"
}
trap cleanup EXIT
xvfb-run -a dbus-run-session -- node scripts/test-packaged-linux.cjs "$image" --x11
xvfb-run -a dbus-run-session -- node scripts/test-packaged-linux.cjs "$image" --stale-wayland
export XDG_SESSION_TYPE=wayland
unset DISPLAY
weston --backend=headless-backend.so --socket="$WAYLAND_DISPLAY" --idle-time=0 --width=1440 --height=1000 --log="$runtime/weston.log" &
compositor=$!
for ((attempt=0; attempt<100; attempt++)); do
  if [[ -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]]; then break; fi
  if ! kill -0 "$compositor" 2>/dev/null; then cat "$runtime/weston.log"; exit 1; fi
  sleep 0.1
done
if [[ ! -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]]; then cat "$runtime/weston.log"; exit 1; fi
dbus-run-session -- node scripts/test-packaged-linux.cjs "$image" --wayland
