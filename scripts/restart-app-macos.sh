#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_BUNDLE="$ROOT_DIR/node_modules/electron/dist/Electron.app"
APP_PATTERN="Electron\\.app/Contents/MacOS/Electron $ROOT_DIR"

require_macos() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "This dev helper is macOS-only." >&2
    exit 1
  fi

  if [[ ! -d "$APP_BUNDLE" ]]; then
    echo "Electron app bundle not found: $APP_BUNDLE" >&2
    exit 1
  fi
}

find_running_pids() {
  pgrep -af "$APP_PATTERN" | awk '{ print $1 }' || true
}

first_running_pid() {
  find_running_pids | head -n 1
}

restart_app() {
  local pid
  local pids

  require_macos

  pids="$(find_running_pids)"
  if [[ -n "$pids" ]]; then
    while read -r pid; do
      if [[ -n "$pid" ]]; then
        kill "$pid" 2>/dev/null || true
      fi
    done <<<"$pids"

    for _ in {1..20}; do
      if [[ -z "$(find_running_pids)" ]]; then
        break
      fi
      sleep 0.25
    done

    while read -r pid; do
      if [[ -n "$pid" ]]; then
        kill -9 "$pid" 2>/dev/null || true
      fi
    done <<<"$(find_running_pids)"
  fi

  open -na "$APP_BUNDLE" --args "$ROOT_DIR" >/dev/null 2>&1

  for _ in {1..40}; do
    pid="$(first_running_pid)"
    if [[ -n "$pid" ]]; then
      echo "Restarted Yuru (PID $pid)"
      return 0
    fi
    sleep 0.25
  done

  echo "Yuru did not appear in process list after launch" >&2
  return 1
}

restart_app
