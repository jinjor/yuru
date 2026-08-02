#!/usr/bin/env node

export function fail(message) {
  console.error(message);
  process.exit(1);
}

export function errorMessage(error) {
  return error instanceof Error && error.message ? error.message : String(error);
}

export function withoutGitDir(env) {
  const next = { ...env };
  delete next.GIT_DIR;
  return next;
}
