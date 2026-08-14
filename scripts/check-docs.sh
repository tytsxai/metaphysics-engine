#!/usr/bin/env bash
#
# Fails when current docs or CLI copy still mention deleted commands or the
# wrong GitHub remote. Those strings survive refactors because nobody greps
# for them until an agent follows a `next` field and gets exit 2.
#
# CHANGELOG.md is excluded: it is a historical record. This script itself is
# excluded because it lists the forbidden strings.
set -euo pipefail

cd "$(dirname "$0")/.."

fail=0

search() {
  local pat=$1
  git grep -nF -- "$pat" -- \
    ':!CHANGELOG.md' \
    ':!scripts/check-docs.sh' \
    ':!**/node_modules/**' \
    || true
}

check() {
  local pat=$1
  local why=$2
  local hits
  hits="$(search "$pat")"
  if [ -n "$hits" ]; then
    echo "stale documentation: $pat" >&2
    echo "  $why" >&2
    echo "$hits" | sed 's/^/  /' >&2
    echo >&2
    fail=1
  fi
}

check 'stack up --only api' \
  'stack 不再按组件挑选；改成 `bazi stack up`。'
check 'stack restart --only api' \
  '改成 `bazi stack restart`。'
check 'stack logs api' \
  'logs 不再接受组件名；改成 `bazi stack logs --tail 60`。'
check 'tytsxai-stack/metaphysics-engine' \
  '当前远程是 tytsxai/metaphysics-engine。'

if [ "$fail" -ne 0 ]; then
  echo "docs check failed. See docs/README.md for the sync table." >&2
  exit 1
fi

echo "docs check passed."
