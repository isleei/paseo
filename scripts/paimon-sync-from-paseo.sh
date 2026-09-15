#!/usr/bin/env bash
# One-way sync of portable daemon state: Paseo (~/.paseo) -> Paimon (~/.paimon).
# Fork-only file; upstream never touches it, so merges stay clean.
#
# Copies (mirror):
#   agents/ projects/ schedules/ plugins/ skills-manager/
#   plugin-settings/ loops/ desktop-attachments/ config.json (listen patched)
# Symlinks (read-only, large):
#   models/ -> source models/ (speech models, ~1GB, no need to duplicate)
# Skipped on purpose (identity / runtime / ephemeral):
#   server-id daemon-keypair.json paseo.pid cli-client-id *.log
#   runtime/ agent-requests/ push-tokens.json
#
# Usage:
#   source scripts/paimon-env.sh            # sets PASEO_HOME=~/.paimon
#   scripts/paimon-sync-from-paseo.sh       # copies from ~/.paseo (override with PASEO_SYNC_SOURCE)
# Re-runnable: rsync mirrors deltas on later runs.
#
# Stop the Paimon daemon first if it is running. The Paseo daemon keeps running;
# its JSON stores write atomically, so reads see complete files.

set -euo pipefail

SRC="${PASEO_SYNC_SOURCE:-$HOME/.paseo}"
DST="${PASEO_HOME:-$HOME/.paimon}"
LISTEN="${PASEO_LISTEN:-127.0.0.1:6777}"

if [ ! -d "$SRC" ]; then
  echo "error: source home not found: $SRC (set PASEO_SYNC_SOURCE to override)" >&2
  exit 1
fi
if [ "$SRC" = "$DST" ]; then
  echo "error: source and target are the same directory" >&2
  exit 1
fi
if [ -f "$DST/paseo.pid" ]; then
  echo "error: $DST/paseo.pid exists — stop the Paimon daemon first" >&2
  exit 1
fi

mkdir -p "$DST"

mirror_dir() {
  local name="$1"
  if [ ! -d "$SRC/$name" ]; then
    return
  fi
  mkdir -p "$DST/$name"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "$SRC/$name/" "$DST/$name/"
  else
    rm -rf "$DST/$name"
    cp -a "$SRC/$name" "$DST/$name"
  fi
  echo "  mirrored: $name/"
}

for dir in agents projects schedules plugins skills-manager plugin-settings loops desktop-attachments; do
  mirror_dir "$dir"
done

# Speech models are large and read-only: symlink instead of copying.
if [ -d "$SRC/models" ] && [ ! -e "$DST/models" ]; then
  ln -s "$SRC/models" "$DST/models"
  echo "  symlinked: models/ -> $SRC/models"
fi

# config.json carries providers/plugins/voice settings; only the listen address changes.
if [ -f "$SRC/config.json" ]; then
  cp "$SRC/config.json" "$DST/config.json"
  chmod 600 "$DST/config.json"
  DST_CONFIG="$DST/config.json" DST_LISTEN="$LISTEN" node -e '
const fs = require("fs");
const path = process.env.DST_CONFIG;
const cfg = JSON.parse(fs.readFileSync(path, "utf8"));
cfg.version = cfg.version || 1;
cfg.daemon = cfg.daemon || {};
cfg.daemon.listen = process.env.DST_LISTEN;
fs.writeFileSync(path, JSON.stringify(cfg, null, 2));
'
  echo "  copied: config.json (daemon.listen=$LISTEN)"
fi

echo "done: $SRC -> $DST"
echo "note: Paimon keeps its own server-id/keypair (fresh daemon identity)."
echo "      relay/device pairing from Paseo is not carried over by design."
