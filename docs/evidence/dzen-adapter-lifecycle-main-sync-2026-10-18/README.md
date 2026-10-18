# Main synchronization verification

Merged main17e0aef (PR179 LinkedIn text-only) into the independently reviewed
8f0950e, producing source commit2a2b945. Only workflow required conflict resolution:
retain owned parent/PG steps and append LinkedIn to the existing shared suite.
The other eight incoming paths are unchanged from main. Of the historical48-file
review manifest,47 remain identical; workflow differs. Preserve that manifest and
its native/PG evidence as historical exact-Dzen-source verification, not as a
claim that the old image includes the incoming LinkedIn changes.

Fresh Tower Docker full backend/frontend/connector build and quality gate PASS.
Fresh focused owned parent + shared browser/Setka/LinkedIn/X run77/77,0fail0skip.
Source delta hashes and image config are in index.json. No Dzen source changed.

Two setup failures are retained honestly: the first quality run lacked the newly
fetched trusted main baseline object (fixed by fetching a Git bundle); an overly
broad test selector also selected a PostgreSQL suite without its synthetic DB
(fixed by the explicit workflow suite list). These are setup failures, not RED
acceptance evidence. No provider, production database or live action occurred.

GitHub CI first run39125755286 found missing /workspace/logs in the committed
Compose service (Tower override already supplied it), plus three old test fixture
stubs missing the new scoped history and transaction authorization reads. Repair
87ddd16 adds bounded ephemeral logs tmpfs and updates only those fixtures; it
preserves exact pilot refusal, forbidden writes, tenant assertions and no-op
preparation assertions. Fresh Tower focused21/21 and preparation1/1 pass; quality
PASS. Raw first CI failure retained. Final GitHub checks are reported on the PR;
this evidence does not assert a CI pass before those checks finish.

Second CI39127285830 passed Dzen1002, Threads and quality. It exposed that a fresh
checkout lacked the source logs directory required to mount tmpfs below the
read-only source bind. Commitb2f3e9b adds only empty logs/.gitkeep. A clean Git
archive on Tower then passed11/11 actual registered boundary/HTTP cases. The full
backend suite also found one additional old VK audited-hold preparation fixture
missing the same two null history/job readers; its refusal assertion is retained,
and focused hold cases5/5 pass. Raw CI job logs and Tower evidence are retained in
clean-checkout-repair-index.json. These are isolated test setup repairs only.
