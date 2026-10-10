# Dzen task 1045 existing-draft recovery

Task 1045 stopped with `DZEN_FINAL_SUBMIT_NOT_ATTEMPTED` at
`2026-10-10T11:59:26.438Z`. The original claim key is
`dzen-p10-1045-r4-asset129-recovery-20261010-01`. This means the final publish
control was not clicked, but an exact provider draft may exist.

`ba_reconcile_or_resume_dzen_task1045_draft` is the only recovery path. It:

- authenticates against channel 116 / publisher `6a8029aba055ec36033bf81c`;
- exhaustively paginates both Published and Draft Studio collections;
- refuses any public-title collision or incomplete pagination;
- locates exactly one draft whose title and normalized body match accepted
  revision 4 and whose downloaded cover SHA-256 matches asset 129;
- defaults to preview and does not claim or click anything;
- with `confirm=true`, atomically claims the original incident before one final
  control click on that same draft;
- records a fact only after the same provider object appears in the exhaustive
  Published readback with a permalink, timestamp and matching public body;
- freezes all ambiguity after the claim. It never rebuilds or resends content.

The exact resume key is
`dzen-p10-1045-r4-asset129-existing-draft-resume-20261010-01`. Deploying this
tool performs no provider action and does not mutate task 1045.
