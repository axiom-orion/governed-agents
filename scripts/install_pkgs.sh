#!/usr/bin/env bash
# scripts/install_pkgs.sh
# SessionStart hook for Claude Code on the web. Installs Node dependencies in fresh
# cloud sessions so the toolchain (typecheck · check:model · verify-trace · demo ·
# check:providers · build) is ready the moment a session starts.
#
# It no-ops on local machines (you manage your own deps) and when dependencies are
# already present, and it never blocks the session — it always exits 0.

# Cloud sessions only. CLAUDE_CODE_REMOTE is "true" in Claude Code on the web.
if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# Fast path: a resumed session already has node_modules — skip the reinstall.
if [ -d node_modules ]; then
  exit 0
fi

# Prefer the reproducible install; fall back if the lockfile is missing/out of sync.
if [ -f package-lock.json ]; then
  npm ci || npm install || true
else
  npm install || true
fi

exit 0
