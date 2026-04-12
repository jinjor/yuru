#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
YURU_HOME="${YURU_HOME:-$HOME/.yuru}"
YURU_REPO_DIR="${YURU_REPO_DIR:-$YURU_HOME/repo}"
YURU_BIN_DIR="${YURU_BIN_DIR:-$HOME/bin}"
YURU_APPLICATIONS_DIR="${YURU_APPLICATIONS_DIR:-$HOME/Applications}"
WRAPPER_SOURCE="$ROOT_DIR/bin/yuru"
WRAPPER_TARGET="$YURU_BIN_DIR/yuru"

ALLOWED_REMOTES=(
  "git@github.com:jinjor/yuru"
  "git@github.com:jinjor/yuru.git"
  "https://github.com/jinjor/yuru"
  "https://github.com/jinjor/yuru.git"
  "ssh://git@github.com/jinjor/yuru"
  "ssh://git@github.com/jinjor/yuru.git"
)

# This is a safety rail for install/update mistakes, not a real security boundary.
# It helps catch cases like installing from a forgotten fork or a misconfigured origin.
# Anyone who can edit this script or the managed checkout can also bypass this check.

require_macos() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "Yuru local packaging is currently supported on macOS only." >&2
    exit 1
  fi
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
}

is_allowed_remote() {
  local remote_url="$1"
  local allowed

  for allowed in "${ALLOWED_REMOTES[@]}"; do
    if [[ "$remote_url" == "$allowed" ]]; then
      return 0
    fi
  done

  return 1
}

warn_if_bin_dir_is_world_writable() {
  local permissions

  permissions="$(stat -f "%Sp" "$YURU_BIN_DIR")"
  if [[ "${permissions:8:1}" == "w" ]]; then
    echo "Warning: $YURU_BIN_DIR is world-writable ($permissions)." >&2
  fi
}

initialize_managed_repo() {
  local origin_url

  if [[ -d "$YURU_REPO_DIR/.git" ]]; then
    origin_url="$(git -C "$YURU_REPO_DIR" remote get-url origin 2>/dev/null || true)"
    if ! is_allowed_remote "$origin_url"; then
      echo "Refusing to use existing managed repo with unexpected origin: $origin_url" >&2
      exit 1
    fi
    return
  fi

  origin_url="$(git -C "$ROOT_DIR" remote get-url origin 2>/dev/null || true)"
  if [[ -z "$origin_url" ]]; then
    echo "Could not determine origin URL from this checkout." >&2
    exit 1
  fi
  if ! is_allowed_remote "$origin_url"; then
    echo "Refusing to install from unexpected origin: $origin_url" >&2
    exit 1
  fi

  git clone "$ROOT_DIR" "$YURU_REPO_DIR"
  git -C "$YURU_REPO_DIR" remote set-url origin "$origin_url"
  if git -C "$YURU_REPO_DIR" show-ref --verify --quiet refs/heads/main; then
    git -C "$YURU_REPO_DIR" checkout main >/dev/null 2>&1
  fi
}

install_wrapper() {
  cp "$WRAPPER_SOURCE" "$WRAPPER_TARGET"
  chmod 755 "$WRAPPER_TARGET"
}

print_next_steps() {
  echo "Installed yuru to $WRAPPER_TARGET"
  echo "Managed repo: $YURU_REPO_DIR"
  echo "App location: $YURU_APPLICATIONS_DIR/Yuru.app"
  if [[ ":$PATH:" != *":$YURU_BIN_DIR:"* ]]; then
    echo "Note: add $YURU_BIN_DIR to your PATH to run 'yuru' directly."
  fi
  echo "Next: run 'yuru latest' to build Yuru.app locally."
}

main() {
  require_macos
  require_command git
  require_command node
  require_command npm

  mkdir -p "$YURU_HOME" "$YURU_BIN_DIR" "$YURU_APPLICATIONS_DIR"
  warn_if_bin_dir_is_world_writable
  initialize_managed_repo
  install_wrapper
  print_next_steps
}

main "$@"
