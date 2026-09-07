# Deploying via GitHub Actions

What `.github/workflows/deploy.yml` does:

- **Any pull request** (opened/pushed to/reopened) deploys that
  branch's own code to `https://<your-domain>/<branch-slug>/` on the
  deploy host -- but only after a maintainer approves the run in
  GitHub's own Environments UI (Settings -> Environments -> `preview`).
  Closing the PR tears the preview back down automatically, no
  approval needed for that half.
- **Every push to `main`** restarts production with the new code, no
  approval gate of its own (merging to `main` already went through
  review).

## What lives here vs. what lives in `cloud-apps`

This repo owns exactly two things the workflow needs:

- `.github/workflows/deploy.yml` -- the workflow itself.
- `deploy/sync-and-build.sh` -- the one script the workflow actually
  runs from a fresh checkout (`bash deploy/sync-and-build.sh ...`),
  unprivileged. It syncs the checkout into a persistent directory and
  runs `npm ci`; see its own header comment for the rest.

Everything else the workflow depends on -- the self-hosted runner
itself, `/srv/orbit-viewer/{branches,prod,cache}`, the systemd units,
the privileged wrapper scripts (`orbit-viewer-deploy-preview.sh`,
`orbit-viewer-teardown-preview.sh`, `orbit-viewer-deploy-prod.sh`), the
sudoers rule, and the nginx config -- is one-time host setup owned by
[`stevenstetzler/cloud-apps`](https://github.com/stevenstetzler/cloud-apps)
(`roles/orbit_viewer_deploy` and `roles/nginx`), applied via Ansible,
not by anything in this repo. The workflow calls those wrapper scripts
by their fixed install path (`/usr/local/bin/...`), never by reading
them out of this repo's own checkout -- this repo doesn't need its own
copies of them at all.

That split is deliberate, not just tidiness: a workflow that both (a)
runs on `pull_request` and (b) could rewrite the very scripts `sudo`
trusts would be a privilege-escalation path -- get one preview
approved, and that "approved" run could rewrite
`/usr/local/bin/orbit-viewer-deploy-preview.sh` to do something else
next time, no further approval needed. Keeping that install step
entirely outside this repo's own CI (in `cloud-apps`, its own review
process) means changes to those scripts only ever take effect when a
human reviews and applies them there -- same trust level as reviewing
and merging a PR, just a different repo.

The one-time setup itself (registering the runner, creating the
`preview` Environment, installing the systemd units/wrapper
scripts/sudoers rule/nginx config) is documented in `cloud-apps`, next
to the actual files it installs -- see that repo's `WIP.md` and the
roles above for current status.

## How branch names become URLs

A branch's own name isn't always a valid single URL path segment --
`claude/fix-horizons-timescale` (this repo's own convention for
AI-authored branches) has a slash in it, for one. The workflow lower-cases
the branch name, replaces every run of characters that aren't `a-z0-9`
with a single `-`, trims leading/trailing `-`, and caps it at 60
characters -- so that branch becomes
`/claude-fix-horizons-timescale/`, not a nested path. Two differently-named
branches that collapse to the same slug (e.g. `feature/foo` and
`feature-foo`) would collide and overwrite each other's preview -- rare
in practice, worth knowing if a preview URL doesn't look like you
expected once you push it.

## Port allocation

Preview ports come from a fixed range, 9100-9199 (100 concurrent
previews -- change `PORT_MIN`/`PORT_MAX` in `cloud-apps`'s copy of
`orbit-viewer-deploy-preview.sh` if you need more), tracked in
`/etc/orbit-viewer/ports.json` (root-owned, written only by the
wrapper scripts). A branch keeps the same port across redeploys
(re-pushing to an already-previewed PR just restarts it in place);
closing the PR frees it back up. Production is always port 9000, fixed,
never allocated from this pool.
