# Local VK browser worker

The local worker is the first browser-assisted publishing milestone for VK. It
uses a dedicated Chrome profile to prepare an accepted wall post in the real VK
composer. The MVP deliberately **cannot press Publish** and cannot write a
publication fact.

## Safety boundary

- Planner remains the control plane and source of the accepted revision.
- The job must name the exact project, task, channel, revision and selected asset.
- The worker accepts only `https://vk.com/...` targets.
- Local images must be inside an explicitly configured approved asset root.
- Approved HTTPS assets are downloaded with the same size, type, redirect and
  private-host protections as the VK API adapter.
- The browser profile stays outside the repository and is never returned to Planner.
- The result contains hashes and screenshot evidence, not publication text,
  cookies or browser storage.
- A login screen, stale revision, unapproved visual or requested live submit
  stops the run.

## One-time setup

Create dedicated private directories outside the repository:

```bash
mkdir -p "$HOME/Library/Application Support/ContentOps/vk-browser/profile"
mkdir -p "$HOME/Library/Application Support/ContentOps/vk-browser/jobs"
mkdir -p "$HOME/Library/Application Support/ContentOps/vk-browser/evidence"
chmod 700 "$HOME/Library/Application Support/ContentOps/vk-browser"{,/profile,/jobs,/evidence}
```

Use a dedicated Chrome profile for this worker. Do not point it at the profile
used by an already running Chrome instance.

## Job format

Store a job as a private JSON file (`chmod 600`). The text and asset must come
from the same accepted Planner bundle.

```json
{
  "schema_version": 1,
  "job_id": "vk-browser:10:900:r3",
  "project_id": 10,
  "task_id": 900,
  "channel_id": 120,
  "idempotency_key": "vk-browser:10:900:r3",
  "target": {
    "community_url": "https://vk.com/analystcraft",
    "placement": "wall_post"
  },
  "payload": {
    "text": "Exact accepted text",
    "image_url": "https://approved-cdn.example/task-900.png"
  },
  "approval": {
    "content_revision": 3,
    "accepted_revision": 3,
    "text_state": "accepted",
    "visual_state": "APPROVED",
    "selected_asset_id": 18
  },
  "execution": { "mode": "prepare_only" }
}
```

## Run

Build the backend, close any worker Chrome window using the same dedicated
profile, and run:

```bash
npm run build:backend
npm run vk:browser:worker -- \
  --job "/absolute/private/jobs/task-900.json" \
  --profile-dir "$HOME/Library/Application Support/ContentOps/vk-browser/profile" \
  --evidence-dir "$HOME/Library/Application Support/ContentOps/vk-browser/evidence"
```

For an approved local file, use `image_path` instead of `image_url` and add one
or more `--asset-root "/absolute/approved-assets"` arguments. Supplying both
image fields is rejected.

On the first run the worker may return `VK_BROWSER_LOGIN_REQUIRED`. Open the
same dedicated profile, sign in to VK manually, complete any 2FA or CAPTCHA,
close it, and rerun the worker. Passwords and cookies must never be placed in a
job file or Planner.

Success means `status: prepared_not_submitted` plus a screenshot and payload
hashes. Review the prepared composer manually. Publishing remains disabled
until a separately reviewed submit/readback phase is implemented.
