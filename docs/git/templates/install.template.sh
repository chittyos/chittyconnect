#!/usr/bin/env sh
set -e

# ChittyOS installer template
# This script assumes curl and npm are available; adjust per package needs.

PKG_JSON_URL=${PKG_JSON_URL:-"https://git.chitty.cc/<service>.json"}
echo "Fetching package metadata from $PKG_JSON_URL" 1>&2
JSON=$(curl -fsSL "$PKG_JSON_URL")

PKG=$(printf "%s" "$JSON" | sed -n 's/.*"packages"\s*:\s*\[\s*"\([^"]*\)".*/\1/p')
if [ -z "$PKG" ]; then
  echo "Could not parse package list from metadata" 1>&2
  exit 1
fi

echo "Installing $PKG" 1>&2
npm i -g "$PKG"
echo "Done." 1>&2
