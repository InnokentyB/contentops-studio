# TDPD 009 — LinkedIn-native formatting contract

**Status:** RED scenario approved by delegated ContentOps defect report
**Date:** 2026-09-26
**Owner:** ContentOps / Channel Adapter
**Downstream consumer:** Publisher / SMM

## Input and surface

**Problem.** An accepted LinkedIn post can arrive as one dense block even when the
source revision was intended to contain readable paragraphs. The current connector
passes the body through and records only the returned URL, so neither adaptation nor
delivery has a deterministic structure check.

**Actor.** A Channel Adapter preparing accepted copy for LinkedIn and a Publisher
confirming the live result.

**Outcome.** Before handoff, the body has a LinkedIn-native plain-text structure.
After publication, the returned body is compared by semantic blocks, tolerating
transport whitespace normalization but not a lost, merged, reordered, or changed
block.

**Surface.** A pure shared contract used by the publication adapter and by tests.
This slice does not edit or publish a live post and does not change another channel.

## Rules

- **R-LI-001 — plain text:** Markdown headings, emphasis, code fences/inline code,
  blockquotes, links, and Markdown list markers are rejected.
- **R-LI-002 — deliberate spacing:** prose blocks are separated by exactly one
  blank line (`\n\n`). Single newlines are allowed only between adjacent supported
  bullet lines.
- **R-LI-003 — mobile paragraphs:** a prose block is at most 280 characters and a
  bullet line is at most 180 characters.
- **R-LI-004 — bullets:** only `•`, `◦`, and `▪` are accepted as list markers.
- **R-LI-005 — provider limit:** the prepared body is non-empty and at most 3,000
  characters.
- **R-LI-006 — semantic readback:** comparison normalizes CRLF, non-breaking spaces,
  surrounding whitespace, and repeated horizontal whitespace inside a block. It
  preserves block order and bullet-line boundaries. Byte equality is not required;
  block equality is.
- **R-LI-007 — no unsafe retry:** a failed or unavailable readback after a successful
  POST must not route the task back to an executable publication path. Automatic
  provider readback is gated until the runtime can record a non-retriable
  `published_unverified` state.

The 3,000-character provider limit and the post-by-URN readback shape come from the
LinkedIn UGC/Posts API documentation. Member readback additionally requires the
restricted `r_member_social` permission, which is not part of the current OAuth
request.

## Acceptance scenarios

### S-LI-001 — RED/GREEN formatting contract

Given a LinkedIn body containing short prose blocks separated by double newlines
and a bullet block using supported characters, when the adapter validates the body,
then it accepts the body without rewriting the accepted revision.

Given the same content collapsed into a dense block, or expressed with Markdown
styling/list markers, validation fails with stable issue codes before any provider
call.

### S-LI-002 — RED/GREEN semantic readback

Given an accepted body and a provider readback that differs only by CRLF, non-breaking
spaces, or repeated horizontal whitespace, comparison passes. If a paragraph is
merged, removed, changed, or reordered, comparison fails and identifies the first
mismatching semantic block.

### S-LI-003 — rollout safety (not yet GREEN)

Given a successful LinkedIn POST followed by unavailable readback, the task is
recorded as `published_unverified` with the provider URN and is never automatically
retried. This scenario remains blocked until the connector lifecycle supports that
state and the LinkedIn application receives a usable read scope.

## Rollout

1. Ship the pure contract and manual handoff checklist.
2. Have Channel Adapter and Copy Auditor use the same issue codes before approval.
3. Obtain and verify the correct LinkedIn read permission in a non-production smoke.
4. Add the non-retriable `published_unverified` lifecycle and provider URN evidence.
5. Wire automatic post-by-URN readback to the semantic comparator.
6. Run owner UAT on one explicitly approved non-production/test post before enabling
   the check for production LinkedIn delivery.

Until step 6, completion wording is **ENGINEERING COMPLETE — AWAITING UAT**; the
connector itself is not claimed GREEN for automatic readback.
