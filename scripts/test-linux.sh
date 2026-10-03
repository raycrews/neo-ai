#!/usr/bin/env bash
# Run within dbus-run-session and xvfb-run. A window manager is needed for focus
# and fullscreen checks; an X server alone cannot exercise those behaviors.
set -euo pipefail
openbox > /tmp/neo-openbox-$$.log 2>&1 &
manager=$!
trap 'kill "$manager" 2>/dev/null || true' EXIT
for suite in panes settings chat general search export revision instruction-library menus formatting context-menu; do
  # Explicit X11 keeps WSL/Wayland environment variables from bypassing Xvfb.
  node_modules/.bin/electron --ozone-platform=x11 --disable-dev-shm-usage "scripts/test-$suite.cjs"
done
