#!/usr/bin/env bash
# Root-run. Takes no arguments at all (unlike the preview scripts) --
# there's nothing here for an attacker-controlled value to inject into,
# since this only ever restarts the one fixed production unit, which
# only ever picks up whatever deploy/sync-and-build.sh (unprivileged)
# already synced into /srv/orbit-viewer/prod. This is also *only* ever
# reached from a `push` to main, i.e. after code has already been
# reviewed and merged -- never from an unapproved pull_request branch
# the way the preview scripts are.
set -euo pipefail
systemctl restart orbit-viewer-prod.service
echo "orbit-viewer-deploy-prod: restarted"
