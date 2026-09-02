#!/usr/bin/env bash
# Root-run (via the sudoers rule in deploy/sudo/sudoers.d/orbit-viewer
# -- see deploy/README.md). Given a branch slug already synced into
# /srv/orbit-viewer/branches/<slug> by deploy/sync-and-build.sh
# (unprivileged), does the two things that actually need root:
#
#   1. Allocate (or reuse) this slug's own preview port, and write it
#      to the systemd instance's own EnvironmentFile.
#   2. Write this slug's own nginx location block and reload nginx,
#      then enable+restart the systemd instance.
#
# The *only* input is $1 (the slug) -- this script is the entire
# trust boundary between "arbitrary, only-approval-gated PR branch
# content" and "root access to nginx/systemd on a machine that also
# runs production," so it validates that input strictly before doing
# anything with it, and touches nothing else the caller could
# influence (every other path here is a fixed constant, never derived
# from $1 beyond direct interpolation into a path already proven safe
# by the regex below).
#
# Idempotent: re-running for the same slug (a new push to the same PR
# branch) reuses its already-allocated port and just restarts it.
set -euo pipefail

SLUG="${1:-}"
if [[ ! "$SLUG" =~ ^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$ ]]; then
  echo "orbit-viewer-deploy-preview: refusing unsafe slug '$SLUG'" >&2
  exit 1
fi

BRANCH_DIR="/srv/orbit-viewer/branches/$SLUG"
if [[ ! -d "$BRANCH_DIR" ]]; then
  echo "orbit-viewer-deploy-preview: $BRANCH_DIR doesn't exist -- run deploy/sync-and-build.sh first" >&2
  exit 1
fi

ENV_DIR=/etc/orbit-viewer/previews
NGINX_DIR=/etc/nginx/conf.d/orbit-viewer-previews
PORTS_FILE=/etc/orbit-viewer/ports.json
LOCK_FILE=/etc/orbit-viewer/ports.json.lock
PORT_MIN=9100
PORT_MAX=9199

mkdir -p "$ENV_DIR" "$NGINX_DIR" "$(dirname "$PORTS_FILE")"
[[ -s "$PORTS_FILE" ]] || echo '{}' > "$PORTS_FILE"
touch "$LOCK_FILE"

# flock so two deploys landing at the same instant (pushes to two
# different PRs, say) can't both read the same "next free port" and
# collide -- held for the read-modify-write of $PORTS_FILE only.
exec 9>"$LOCK_FILE"
flock 9
PORT=$(node -e '
  const fs = require("fs");
  const [slug, min, max, path] = process.argv.slice(1);
  const ports = JSON.parse(fs.readFileSync(path, "utf8") || "{}");
  if (ports[slug]) { console.log(ports[slug]); process.exit(0); }
  const used = new Set(Object.values(ports));
  for (let p = Number(min); p <= Number(max); p++) {
    if (!used.has(p)) {
      ports[slug] = p;
      fs.writeFileSync(path, JSON.stringify(ports, null, 2));
      console.log(p);
      process.exit(0);
    }
  }
  console.error("orbit-viewer-deploy-preview: no free preview port in range " + min + "-" + max);
  process.exit(1);
' "$SLUG" "$PORT_MIN" "$PORT_MAX" "$PORTS_FILE")
flock -u 9

echo "PORT=$PORT" > "$ENV_DIR/$SLUG.env"

cat > "$NGINX_DIR/$SLUG.conf" <<EOF
location /$SLUG/ {
    proxy_pass http://127.0.0.1:$PORT/;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
}
EOF

nginx -t
systemctl reload nginx
systemctl enable --now "orbit-viewer@$SLUG.service"
systemctl restart "orbit-viewer@$SLUG.service"

echo "orbit-viewer-deploy-preview: $SLUG -> port $PORT, /$SLUG/"
