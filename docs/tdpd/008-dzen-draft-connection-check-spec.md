# TDPD-008 — Dzen draft connection check

## Business problem
An owner must validate a freshly copied Dzen browser session before saving it. Saving first closes the editor and can turn malformed input into stored configuration.

## Rules
- **R1** Only a project owner may run the check.
- **R2** A non-masked draft session overrides the saved session for this check only.
- **R3** The check never writes channel configuration and returns `persisted: false`.
- **R4** Header strings and browser JSON exports use the sanitized parser.
- **R5** The response identifies credential source and format without echoing credentials.
- **R6** Browser resources close on success and failure.

## Acceptance scenarios
- **S1** New JSON export is checked without a database write.
- **S2** Masked/empty draft falls back to the saved secret without exposing it.
- **S3** Malformed or foreign-domain cookies fail safely and save nothing.
- **S4** A non-owner receives 403 before a provider call.

## RED / GREEN / UAT
- RED: backend build failed because `dzen_connection_check` did not exist; it also revealed two pre-existing strict-type build errors.
- GREEN: `node --test dist/tests/dzen_connection_draft.test.js`.
- UAT: paste a browser JSON export, press **Test without saving**, verify inline success, then save only if desired.
