#!/bin/sh
# Choose a display before Electron initializes Ozone. Session variables alone
# can name a Wayland display that Flatpak has not exposed inside the sandbox.
export TMPDIR="$XDG_RUNTIME_DIR/app/$FLATPAK_ID"
display=${WAYLAND_DISPLAY:-wayland-0}
case "$display" in
  /*) socket=$display ;;
  *) socket=${XDG_RUNTIME_DIR:+$XDG_RUNTIME_DIR/$display} ;;
esac
backend=x11
if [ -n "$socket" ] && [ -S "$socket" ]; then backend=wayland; fi
# Explicit user arguments come last so a manual display override still works.
exec zypak-wrapper neo-ai --ozone-platform="$backend" "$@"
