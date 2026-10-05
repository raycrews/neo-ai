#!/usr/bin/env bash
# Exercise the installed package on real virtual display servers. Each gets
# its own bus so portals and automatic restarts inherit the matching display.
set -euo pipefail
xvfb-run -a dbus-run-session -- node scripts/test-packaged-linux.cjs --flatpak --x11
xvfb-run -a dbus-run-session -- node scripts/test-packaged-linux.cjs --flatpak

if [[ -z "${XDG_RUNTIME_DIR:-}" || ! -d "$XDG_RUNTIME_DIR" ]]; then
  export XDG_RUNTIME_DIR
  XDG_RUNTIME_DIR=$(mktemp -d)
fi
export WAYLAND_DISPLAY="neo-test-wayland-$$"
export XDG_SESSION_TYPE=wayland
unset DISPLAY
log=$(mktemp)
weston --backend=headless-backend.so --socket="$WAYLAND_DISPLAY" --idle-time=0 --width=1440 --height=1000 --log="$log" &
compositor=$!
trap 'kill "$compositor" 2>/dev/null || true' EXIT
for ((attempt=0; attempt<100; attempt++)); do
  if [[ -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]]; then break; fi
  if ! kill -0 "$compositor" 2>/dev/null; then cat "$log"; exit 1; fi
  sleep 0.1
done
if [[ ! -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]]; then cat "$log"; exit 1; fi
dbus-run-session -- node scripts/test-packaged-linux.cjs --flatpak --wayland
