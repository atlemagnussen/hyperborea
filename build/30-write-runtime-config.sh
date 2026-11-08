#!/bin/sh
# Writes all HYPERBOREA_* environment variables to config.js, read by the app on load.
# Runs from the nginx image entrypoint on container start (see /docker-entrypoint.d).
set -eu

CONFIG=/usr/share/nginx/html/config.js

{
  echo "window.__HYPERBOREA_ENV__ = {"
  env | grep '^HYPERBOREA_' | sort | while IFS='=' read -r name value; do
    # escape for a JS string literal
    value=$(printf '%s' "$value" | sed 's/\\/\\\\/g; s/"/\\"/g; s/</\\u003c/g')
    echo "  \"$name\": \"$value\","
  done
  echo "}"
} > "$CONFIG"

echo "$0: wrote runtime config to $CONFIG"
