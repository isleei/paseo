#!/usr/bin/env bash
# Fork-local runtime isolation for Paimon (side-by-side with Paseo).
# This file is fork-only; upstream never touches it, so merges stay clean.
#
# Usage:
#   source scripts/paimon-env.sh
#   npm run dev                          # daemon on 6777, home ~/.paimon
#   APP_VARIANT=paimon npm run dev:app   # mobile app "Paimon" (sh.paimon)
#
# Production Paseo uses 127.0.0.1:6767 + ~/.paseo.
# NOTE: `npm run dev` forces 127.0.0.1:6768 via cross-env in package.json,
# so a Paimon dev daemon also binds 6768 (no clash with prod 6767).
# PASEO_LISTEN=6777 below applies to direct/production-style runs, e.g.
# `npm run start --workspace=@getpaseo/server`, keeping a third port free.
# Paimon uses 127.0.0.1:6777 + ~/.paimon — no collisions with either.

export PASEO_HOME="${PASEO_HOME:-$HOME/.paimon}"
export PASEO_LISTEN="${PASEO_LISTEN:-127.0.0.1:6777}"
export PASEO_ELECTRON_USER_DATA_DIR="${PASEO_ELECTRON_USER_DATA_DIR:-$HOME/.paimon-electron}"

if [ -z "${APP_VARIANT:-}" ]; then
  export APP_VARIANT="paimon"
fi

mkdir -p "$PASEO_HOME" "$PASEO_ELECTRON_USER_DATA_DIR"

echo "Paimon env: PASEO_HOME=$PASEO_HOME PASEO_LISTEN=$PASEO_LISTEN APP_VARIANT=$APP_VARIANT"
