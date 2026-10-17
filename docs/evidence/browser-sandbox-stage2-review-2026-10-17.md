# PR172 exact transition staging review

Status: **REVIEWED CANDIDATE / NOT ADMITTED**. Human staging authorization has
not been received. PR174 mechanism approval and engineering review do not supply it.

The separate payload is `browser-sandbox-stage2-payload-2026-10-17.json` in this
directory. It contains only schemaVersion 1 and the two exact file entries from
the previously reviewed candidate, with six task_identifier remaps. It is stored
as evidence, not at `docs/code-quality/runtime-policy-transitions.json`.
No source or baseline changes are included in this package.
Payload SHA256:
`2794dbc59290fe18a80f7da82472bda8fb34afa64afbf7439817f07baa847440`.

Source comparison: `190621a53536cdd04c7c3ed7e449f9313b8d5364` to
`389a92627caa402db289d627aedfd095fa4bbc99`. Source changes are limited to the two
Puppeteer launch option corrections. Each full old/new SHA256 is in the payload.
The unchanged source files at integrated main `d233b2b` remain eligible for this
comparison; any later source change requires a fresh review and new hashes.

Independent reviewer `/root/dzen_runtime_review_retry` reviewed the original
candidate at `1d59f8ce1c65369d924e7c5195e456165c304ceb`, SHA256
`faf95372cdfbe1ac7df0b154f7f400086a28c56b1fa240608a7c40ebde1199cc`.
Verdict: PASS, no P1/P2 findings. Independently recomputed on tower:

- Four full source hashes and all six old/new identities, symbols and count=1.
- Inventory declaration header SHA256:
  `3985b64b672386d6d7ea9a56273026534313f81653727b99c688a6b6e15e65f0`.
- Publisher declaration header SHA256:
  `bc4c6c7cc65846695ae9747cc1a280213f59b8b48a34507b0845cfb2a8074a34`.
- Each old baseline row occurs once. Its owner, reason and remediation must be
  copied unchanged. Entry-level review metadata does not replace row metadata.
- No new task/account/channel binding appears in the source delta.

`browser-sandbox-stage2-proof-2026-10-17.json` contains the exact six declarations
and their row metadata, one positive consumption result and targeted negative
results. The sibling `.cjs` fixture reproduces the proof using a temporary clone
inside the reviewed tower quality container, with synthetic staging only. It
imports static gate modules; it never imports application/provider code. The
temporary clone is removed in finally and the container uses --rm.

The proof checks new task/account/channel bindings even if an attacker attempts
to add matching baseline rows. In-file additions violate full source identity;
separate-file additions remain BASELINE_WIDENED even when all six legitimate
remaps apply. Changing count, owner, reason or remediation fails closed.
Executed result: one positive case PASS with six applied transitions; all ten
negative cases rejected as expected. The proof pins its actual integrated
source snapshot `ffa3ac6d449c861b4d775e5221a819a749f18c66`; gate implementation
bytes are identical to independently reviewed `1d59f8c`. This is a focused
source-review proof, not a repeat of the generic implementation suite or UAT.

If exact staging is separately authorized after PR174 reaches main, stage only
the reviewed payload at the fixed authority path while retaining old source and
baseline. A subsequent correction must consume that trusted predecessor and
replace only the six identities, retaining all row metadata. Re-run the actual
event-base gate and relevant correction checks at that time. This evidence does
not claim that either real stage has happened.

Retirement: remove these mappings when the task-specific adapter is retired in
favor of the shared lifecycle. Existing authorization, policy refusal, tenant,
revision, audit and idempotency requirements continue to apply. No live UAT,
publication, merge, deploy or provider action was performed for this review.
