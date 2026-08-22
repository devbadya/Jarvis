#!/usr/bin/env bash
# Renders the PWA raster icons from the committed SVG sources.
#
# Installability requires PNGs, but checking in binaries that nobody can diff is
# worse than regenerating them. Uses only macOS built-ins (qlmanage, sips).
set -euo pipefail

cd "$(dirname "$0")/.."
public="public"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

render() {
  local source="$1" target="$2" size="$3"
  cp "$public/$source" "$work/"
  qlmanage -t -s 512 -o "$work" "$work/$source" >/dev/null 2>&1
  sips -z "$size" "$size" "$work/$source.png" --out "$public/$target" >/dev/null
  echo "  $target (${size}x${size})"
}

echo "Generating PWA icons:"
render icon.svg pwa-192.png 192
render icon.svg pwa-512.png 512
render icon-maskable.svg pwa-maskable-512.png 512
echo "Done."
