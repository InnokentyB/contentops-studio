# Standalone VK consumer bootstrap proposal

Date: 2026-10-12. Status: PROPOSED — commands for the new consumer do not exist yet.
Depends on approved decision bundle in `../tdpd/016-vk-connector-dispatch.md`.

## Infrastructure-only installation after implementation

1. Install the reviewed connector build on the owner's host. Stop competing
   processes using the private profile. Preserve existing profile contents;
   do not extract or copy browser credentials.
2. Create an owner-only configuration file (0600) outside the repository. Bind it
   to project10, channel117 and pilot task1048; use the existing authenticated
   Publisher MCP endpoint. Reference an already authorized Publisher credential
   in private local storage; never paste it into chat, jobs or a LaunchAgent.
3. Select infrastructure-only mode. This mode must be enforced by its execution
   adapter and prevent VK navigation, profile opening, upload and submit.
4. Install/start the proposed macOS service-manager entry after reviewing its
   exact executable/configuration paths. Railway rollout alone does not do this.
5. Verify heartbeat freshness, authenticated polling and task allow-list using
   non-provider health. Test a command receipt with deterministic fixtures; no
   live publication may be inferred from that acknowledgement.
6. Use the proposed Planner command for1048 only after current Registry, manifest,
   task/release/asset binding, canonical fact and attempt checks. It must report
   the job ID and the independently observed consumer receipt. With provider
   execution disabled, report that exact blocker and preserve the package.

An executable one-time command and exact installed paths will be supplied after
the implementation passes checks. This proposal is not an instruction to run the
existing one-job browser CLI as a substitute.

## Separate provider bootstrap gate

Proceed only when VK control is permitted in the intended execution context.
Owner publication GO alone does not lift a tool/site-control denial. If denied,
stop; do not choose a different browser/profile/CDP/API to bypass it.

When permitted, the owner must verify the dedicated local VK login and numeric
community permissions. Any required login/profile access or new credential
provisioning is a separate explicit bootstrap action. Do not broaden the token
role or reuse a different project's profile implicitly.

Before enabling submit for1048, run the implemented read-only reconciliation:
check canonical facts/attempts and exact public object evidence. A matching
existing publication is reconciled; UNKNOWN coverage blocks sending. Only an
affirmatively permitted route, complete scoped absence evidence, current release
and safe attempt state allow one submission. Confirm permalink/provider identity,
time and approved media binding before recording fact/checkpoints.

## Stop and rollback

Stop consumer; disable dispatch command. Retain existing profile, dispatch jobs,
leases/audit history, attempts, facts and measurement checkpoints. A process
restart or rollback is never authorization to retry an uncertain send.
