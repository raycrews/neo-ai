#!/bin/sh
# Choose the display before Electron initializes, including on library restart.
set -eu
app_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
backend=$(sh "$app_dir/neo-display-backend")
# Explicit user arguments come last so --ozone-platform remains overridable.
exec "$app_dir/neo-ai-bin" "--ozone-platform=$backend" "$@"
