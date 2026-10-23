# Refactoring consolidation — release packet A

Base: main74175e1ce8e0679e47a7447c43d3fedb6f27c3de. Existing PR199 remains open; this local branch replays its exact channel-list change on the current production source and wires its pure regression suite into the existing Docker CI compiler job. No backend implementation, dependencies, schema, credentials, provider admission or historical publication data changes.

## Verified operator boundary

Project settings groups publication channels by platform and sorts their names naturally in either direction. All groups stay expanded; aliases, unknown providers, inactive rows and stable edit/delete IDs remain visible. Sorting performs no persistence or provider call.

Docker verification on current main: five pure grouping/performance cases; actual Settings browser at1280px/375px (natural ordering, aliases, stable editing, no sort writes, empty state and English); backend compilation; current frontend production build and existing UI/settings/LinkedIn/Threads/checkpoint contracts; quality gate PASS,6823 existing findings/baseline unchanged. No test was skipped. Setup errors (missing Git mount, non-SHA gate base, module lookup, read-only compiler cache and missing sibling source for frontend contracts) were retained in private execution evidence and corrected without changing application code or weakening tests.

## Release and acceptance

Prepared locally, not pushed/merged/deployed by this consolidation. Before release: check current base and latest-head CI, fresh private production backup and isolated restore, then verify both Railway revisions/health. Roll back to the prior deployed source while retaining current secrets and all data/history. No schema migration is required.

Owner UAT remains pending: open Project settings → Publication channels, find a platform, switch А–Я/Я–А and edit an existing channel on desktop/mobile. Confirm the desired row opens and sorting itself saves nothing.

## Other packages

Historical pre-permit browser recovery and X editor0.2.2 are in a separate local integration candidate, not prerequisites for this independent UI release. Neither candidate supplies a live reader/supervisor, performs enrollment, nor grants a publication. Older local reliability and VK/Dzen branches are represented by later public releases; blindly merging their old snapshots would overwrite current code. Complete branch inventory/dispositions and retained logs are held in the private operator workspace under ops/refactoring-consolidation-20261023.
