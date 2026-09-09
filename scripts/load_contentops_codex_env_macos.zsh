#!/bin/zsh
set -eu

env_file="${HOME}/.codex/.env"
[[ -r "$env_file" ]] || exit 2

loaded=0
while IFS= read -r line; do
  [[ "$line" =~ '^CONTENTOPS_[A-Z0-9_]+_TOKEN=' ]] || continue
  key="${line%%=*}"
  value="${line#*=}"
  value="${value#\"}"; value="${value%\"}"
  value="${value#\'}"; value="${value%\'}"
  [[ -n "$value" ]] || exit 3
  [[ "$value" =~ '^[A-Za-z0-9._~-]+$' ]] || exit 4
  /bin/launchctl setenv "$key" "$value"
  ((loaded += 1))
done < "$env_file"

((loaded > 0)) || exit 5
