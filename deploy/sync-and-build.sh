#!/usr/bin/env bash
# Syncs the current checkout (the GitHub Actions job's own ephemeral
# workspace, already at the right commit via actions/checkout) into a
# *persistent* directory outside that workspace, then npm-installs
# there. Persistent because that's what the systemd units (installed
# by stevenstetzler/cloud-apps's roles/orbit_viewer_deploy, not
# anything in this repo) point ExecStart/WorkingDirectory at -- the
# ephemeral per-run workspace goes away the moment the job ends, but
# the running `node scripts/serve-example.mjs` process needs to keep
# living in a real place on disk.
#
# Deliberately unprivileged -- this script never touches anything
# outside $DEST and $CACHE_DIR, both of which the runner's own user
# owns (one-time host setup in cloud-apps). It's the *only* half of a
# deploy that runs directly from workflow steps, with no `sudo` -- the
# other half (nginx config, systemd units) needs root and runs through
# fixed wrapper scripts installed once by cloud-apps's own Ansible
# roles, never by a workflow run in this repo (see deploy/README.md's
# "What lives here vs. what lives in cloud-apps" for why that boundary
# matters here specifically).
#
# Usage: deploy/sync-and-build.sh <destination-dir>
# Env:   ORBIT_VIEWER_CACHE_DIR (default /srv/orbit-viewer/cache) --
#        shared across every branch's checkout (see below) and prod's,
#        so a kernel byte-range already pulled from NAIF/JPL for one
#        preview doesn't need pulling again for another.
set -euo pipefail

DEST="${1:?usage: sync-and-build.sh <destination-dir>}"
CACHE_DIR="${ORBIT_VIEWER_CACHE_DIR:-/srv/orbit-viewer/cache}"

mkdir -p "$DEST" "$CACHE_DIR"

# --delete keeps $DEST an exact mirror of this checkout (a file removed
# in a later commit on the same branch shouldn't linger in a redeployed
# preview) -- except node_modules (npm ci below manages that directly;
# re-syncing it every time would be pure waste) and kernels/cache
# (about to be replaced with a symlink into the shared cache instead of
# a real per-branch directory, so it's excluded here rather than synced
# and then immediately deleted).
rsync -a --delete --exclude /node_modules --exclude /kernels/cache ./ "$DEST"/

rm -rf "${DEST:?}/kernels/cache"
ln -s "$CACHE_DIR" "$DEST/kernels/cache"

(cd "$DEST" && npm ci)

echo "sync-and-build: synced into $DEST (kernels/cache -> $CACHE_DIR)"
