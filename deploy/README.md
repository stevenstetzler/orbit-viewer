# Deploying via GitHub Actions

What `.github/workflows/deploy.yml` does:

- **Any pull request** (opened/pushed to/reopened) deploys that
  branch's own code to `https://<your-domain>/<branch-slug>/` on the
  deploy host -- but only after a maintainer approves the run in
  GitHub's own Environments UI (see "3. Create the `preview`
  environment" below). Closing the PR tears the preview back down
  automatically, no approval needed for that half.
- **Every push to `main`** restarts production with the new code, no
  approval gate of its own (merging to `main` already went through
  review).

This file is the one-time setup the workflow itself assumes already
exists on the deploy host -- none of it is installed or updated by a
workflow run (see "Why the deploy scripts aren't auto-installed"
below). Do this once, then every PR/push just works.

Replace `RUNNER_USER` everywhere below with whatever account the
GitHub Actions runner service actually runs as, and `YOUR-DOMAIN` with
the real domain nginx already serves (TLS terminating at your load
balancer, per your own setup -- nginx itself only needs to speak plain
HTTP).

## 1. Register the self-hosted runner

Repo Settings -> Actions -> Runners -> "New self-hosted runner", on the
deploy host itself. When you get to `./config.sh`, add a custom label
so this workflow can target this runner specifically (in case you ever
add another runner for something else):

```sh
./config.sh --url https://github.com/stevenstetzler/orbit-viewer --token <TOKEN> --labels orbit-viewer-deploy
```

Install it as a service (`./svc.sh install && ./svc.sh start`) so it
survives reboots. Note the account it's running as -- that's
`RUNNER_USER` for everything below.

## 2. Create the directories the runner's own user owns

No `sudo` needed for any of this -- it's exactly what
`deploy/sync-and-build.sh` (run directly by workflow steps, unprivileged)
and the systemd units' own `ReadWritePaths` expect to already exist and
be writable by `RUNNER_USER`:

```sh
sudo mkdir -p /srv/orbit-viewer/branches /srv/orbit-viewer/prod /srv/orbit-viewer/cache
sudo chown -R RUNNER_USER:RUNNER_USER /srv/orbit-viewer
```

`/srv/orbit-viewer/cache` is shared across every branch's checkout
*and* prod's (each gets `kernels/cache` symlinked into it) -- a byte
range already pulled from NAIF/JPL for one preview doesn't need
pulling again for another. It'll grow to a few hundred MB at most in
real use (`deploy.md`'s own "Bandwidth per view" numbers).

## 3. Create the `preview` environment

Repo Settings -> Environments -> "New environment", name it exactly
`preview`, and add yourself (or whoever should approve deploys) under
"Required reviewers". That's the entire approval gate -- the
`preview` job in the workflow references this environment by name, so
GitHub pauses the *whole job*, checkout included, until someone
approves that specific run.

Node.js (>=18, matching `package.json`'s `engines`) and `rsync` need
to already be installed on the deploy host -- `git`, `nginx`, and
`systemd` are assumed too, per your own setup.

## 4. Install the systemd units

```sh
sudo cp deploy/systemd/orbit-viewer@.service deploy/systemd/orbit-viewer-prod.service /etc/systemd/system/
sudo sed -i 's/RUNNER_USER/<actual-username>/' /etc/systemd/system/orbit-viewer@.service /etc/systemd/system/orbit-viewer-prod.service
sudo systemctl daemon-reload
sudo systemctl enable --now orbit-viewer-prod.service   # will fail to actually start until step 7 below has synced real code into /srv/orbit-viewer/prod -- that's expected the first time
```

`orbit-viewer@.service` is a *template* (systemd's `%i` syntax) -- one
instance per branch slug, started/stopped by the wrapper scripts in
step 5, never by hand.

## 5. Install the privileged wrapper scripts + sudoers rule

These three scripts are the *only* things that run as root, and each
takes either no argument at all or a branch slug it validates strictly
before touching anything (see each script's own header comment in
`deploy/sudo/` for the full reasoning) -- everything else the workflow
does (checkout, `npm ci`) runs as `RUNNER_USER`, no `sudo` at all.

```sh
sudo install -o root -g root -m 0755 \
  deploy/sudo/orbit-viewer-deploy-preview.sh \
  deploy/sudo/orbit-viewer-teardown-preview.sh \
  deploy/sudo/orbit-viewer-deploy-prod.sh \
  /usr/local/bin/

visudo -cf deploy/sudo/sudoers.d/orbit-viewer   # validate before installing -- a bad sudoers file can lock you out
sudo sed -i 's/RUNNER_USER/<actual-username>/' deploy/sudo/sudoers.d/orbit-viewer
sudo install -o root -g root -m 0440 deploy/sudo/sudoers.d/orbit-viewer /etc/sudoers.d/orbit-viewer
```

### Why sudo is scoped this way

`preview`'s approval gate (step 3) is the thing standing between "a PR
branch's own code" and "this machine," but it's a human clicking a
button, not a technical control -- once approved, the job runs that
branch's code directly, and that code's own `npm ci`/`node
scripts/serve-example.mjs` never need root themselves (see step 2). Root
is needed for exactly two things past that: writing nginx config and
managing systemd units. Rather than granting broad `sudo systemctl
...`/`sudo cp ...` access (wildcard sudo rules are easy to escape --
a crafted unit name or path can smuggle extra behavior into a "generic"
privileged command), the sudoers rule instead grants exactly three
*fixed* commands with no wildcards, and each one validates its single
argument itself before doing anything -- the validation lives in a
script under version control here, not in a sudoers pattern.

### Why the deploy scripts aren't auto-installed

A workflow that both (a) runs on `pull_request` and (b) can update the
very scripts `sudo` trusts would be a privilege-escalation path: get
one preview approved, and that "approved" run could rewrite
`/usr/local/bin/orbit-viewer-deploy-preview.sh` to do something else
next time, no further approval needed. Keeping the install step manual
(this file) means changes to `deploy/sudo/*.sh` only take effect when
*you* re-run step 5 yourself, after reading the diff -- same trust
level as reviewing and merging a PR, just not automated.

## 6. Wire nginx up

Add these two lines inside whichever `server {}` block already owns
`YOUR-DOMAIN` (TLS/the domain itself stay exactly as they are --
nginx here only ever proxies plain HTTP to `127.0.0.1`):

```nginx
include /etc/nginx/conf.d/orbit-viewer-prod.conf;
include /etc/nginx/conf.d/orbit-viewer-previews/*.conf;
```

Then install the static prod config and create the (initially empty)
previews directory the second line globs over -- deploy runs fill it
in per-branch, never you by hand:

```sh
sudo mkdir -p /etc/nginx/conf.d/orbit-viewer-previews
sudo cp deploy/nginx/orbit-viewer-prod.conf /etc/nginx/conf.d/orbit-viewer-prod.conf
sudo nginx -t && sudo systemctl reload nginx
```

(`deploy/nginx/preview.conf.example` shows what a *real* per-branch
file looks like once one exists -- it's generated by
`orbit-viewer-deploy-preview.sh`, never installed from here.)

## 7. First deploy

Everything above gets prod to a state where it's *running* but serving
whatever was on disk at install time (nothing, the first time). Push
to `main` (or just re-run the `prod` job from the Actions tab) to sync
real code in and restart it for real.

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
previews -- change `PORT_MIN`/`PORT_MAX` in
`deploy/sudo/orbit-viewer-deploy-preview.sh` if you need more), tracked
in `/etc/orbit-viewer/ports.json` (root-owned, written only by the
wrapper scripts). A branch keeps the same port across redeploys
(re-pushing to an already-previewed PR just restarts it in place);
closing the PR frees it back up. Production is always port 9000, fixed,
never allocated from this pool.
