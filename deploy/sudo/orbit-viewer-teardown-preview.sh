#!/usr/bin/env bash
# Root-run counterpart to orbit-viewer-deploy-preview.sh -- stops and
# fully removes one branch's preview (systemd instance, its nginx
# location block, its port allocation). Same input validation, same
# reasoning: see that script's own header comment.
#
# Does *not* remove /srv/orbit-viewer/branches/<slug> itself -- that
# directory is owned by the unprivileged runner user (deploy/README.md),
# so the workflow's own teardown job removes it directly with a plain
# `rm -rf`, no sudo needed, right after calling this script.
set -euo pipefail

SLUG="${1:-}"
if [[ ! "$SLUG" =~ ^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$ ]]; then
  echo "orbit-viewer-teardown-preview: refusing unsafe slug '$SLUG'" >&2
  exit 1
fi

systemctl disable --now "orbit-viewer@$SLUG.service" 2>/dev/null || true
rm -f "/etc/nginx/conf.d/orbit-viewer-previews/$SLUG.conf"
rm -f "/etc/orbit-viewer/previews/$SLUG.env"

PORTS_FILE=/etc/orbit-viewer/ports.json
LOCK_FILE=/etc/orbit-viewer/ports.json.lock
if [[ -f "$PORTS_FILE" ]]; then
  touch "$LOCK_FILE"
  exec 9>"$LOCK_FILE"
  flock 9
  node -e '
    const fs = require("fs");
    const [slug, path] = process.argv.slice(1);
    const ports = JSON.parse(fs.readFileSync(path, "utf8") || "{}");
    delete ports[slug];
    fs.writeFileSync(path, JSON.stringify(ports, null, 2));
  ' "$SLUG" "$PORTS_FILE"
  flock -u 9
fi

nginx -t
systemctl reload nginx

echo "orbit-viewer-teardown-preview: $SLUG removed"
