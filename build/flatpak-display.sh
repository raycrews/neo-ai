#!/bin/sh
# Choose a display before Electron initializes Ozone. Session variables alone
# can name a Wayland display that is unavailable (including inside Flatpak).
display=${WAYLAND_DISPLAY:-wayland-0}
case "$display" in
  /*) socket=$display ;;
  *) socket=${XDG_RUNTIME_DIR:+$XDG_RUNTIME_DIR/$display} ;;
esac
backend=x11
if [ -n "$socket" ] && [ -S "$socket" ]; then backend=wayland; fi
printf '%s\n' "$backend"
