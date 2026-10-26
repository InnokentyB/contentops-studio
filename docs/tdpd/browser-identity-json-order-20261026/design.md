# Immutable browser identity: serialization-order correction

Authorized outcome: execute approved ordinary browser publications while
preserving owner/tenant authority, exact account/package, audit and anti-duplicate
checks. A JSON serialization-order difference must not be treated as a change
of identity.

The existing metadata repair compared JSON.stringify values. PostgreSQL JSONB
and schema parsing can order the same seven fields differently. Replace only
that comparison with Node isDeepStrictEqual. Field values, extra/missing fields,
historical Registry evidence, and all admission/CAS/no-history checks stay strict.
No migration, new command, dependency, credential, provider call or identity
rebind is introduced. Existing publication history is neither reset nor changed.

Acceptance: reordered identical identity can update an audited current-manifest
snapshot; real identity/evidence changes remain rejected without writes; audit
failure/CAS failure roll back; the same path works against real JSONB storage.
Unit RED: one expected BROWSER_IDENTITY_BINDING_CONFLICT, ten existing checks pass.
Focused GREEN: 46 checks pass, including an explicit ordinary X identity case.
Real PostgreSQL: 10/10 pass. Full TypeScript backend build and quality gate pass;
no new runtime-policy debt or hard stop. Full evidence is
kept in the isolated engineering handoff, with live acceptance separately owned
by the sole Publisher. A test result alone is not a publication fact.
Rollback: previous deployable revision; no database rollback or history deletion.
