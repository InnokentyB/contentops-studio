# Local VK browser worker

The local worker is the browser-assisted VK feed adapter used when the official
API route is unavailable. Prepare-only validates and materializes the accepted
bundle locally without opening VK. Submit is a separate owner-released,
Publisher-claimed execution that starts a durable attempt before opening the
composer, submits once, and records a publication fact only after exact provider
readback.

## Safety boundary

- Planner remains the control plane and source of the accepted revision.
- The job must name the exact project, task, channel, revision and selected asset.
- The worker accepts only `https://vk.com/...` targets and canonical negative
  VK community IDs.
- Local images must be inside an explicitly configured approved asset root.
- Approved HTTPS assets are downloaded with the same size, type, redirect and
  private-host protections as the VK API adapter.
- The browser profile stays outside the repository and is never returned to Planner.
- Prepare-only never opens Chrome, types into VK, selects a file or uploads media.
- Submit requires an active browser-publication lease and a Publisher MCP token.
- The result contains hashes and screenshot evidence, not publication text,
  cookies or browser storage.
- The first provider-side upload happens only after a durable delivery attempt
  exists. Any ambiguous submit or readback freezes that attempt and forbids retry.
- Only one exact `wall<owner_id>_<post_id>` permalink with matching accepted text
  and visual may create the publication fact.

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
    "placement": "wall_post",
    "community_id": -240051152
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

Prepare-only returns payload hashes and `provider_upload: false`; it does not
require a browser login and does not return a VK screenshot.

## Owner release and submit

Live browser execution is intentionally a separate workflow:

1. The project owner calls `ba_release_approved_vk_browser_task` with the exact
   manifest, revision, body hash, approved asset hash, channel and schedule.
   This creates one `browser_publish` work item but does not contact VK.
2. The Publisher calls `ba_claim_vk_browser_publication` and receives a
   short-lived lease token.
3. Create a new private job with the same accepted bundle and replace execution
   with:

```json
{
  "mode": "submit",
  "authorization": {
    "work_item_id": 501,
    "lease_token": "lease-returned-by-planner",
    "approval_reference": "owner approval reference",
    "attempt_idempotency_key": "vk-browser-submit:10:900:r3"
  }
}
```

4. Put the project-scoped Publisher token in `VK_BROWSER_MCP_TOKEN`. Optionally
   override `VK_BROWSER_MCP_ENDPOINT`; the hosted default is
   `https://planner-mcp-production.up.railway.app/mcp/publisher`.
5. Run the same CLI command. On the first submit run it may return
   `VK_BROWSER_LOGIN_REQUIRED`; sign in manually through the dedicated profile,
   close the window, and rerun while the lease is still active.

The worker calls `ba_start_vk_browser_submission` before typing or uploading,
then executes one browser submit. Exact readback calls
`ba_confirm_vk_browser_submission`; an unavailable or mismatched readback calls
`ba_mark_vk_browser_submission_uncertain`. A started attempt is never retried
automatically. Passwords, cookies and MCP tokens must never be stored in the job
file or Planner.

Prepare success is `status: prepared_not_submitted`. Submit success is
`status: confirmed_published` with the canonical permalink and publication fact
ID. A button click alone is never reported as success.
