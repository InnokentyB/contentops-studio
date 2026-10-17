import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { nativeBindingSourceSchema } from './x_native_diagnostics_binding';
import { nativeSettingReadSchema, nativeAuditReadSchema, type NativeInventorySource } from './x_native_diagnostics_inventory';
import { nativeTaskStateSchema, NativeStateReadError, type NativeStateRequest } from './x_native_diagnostics_contract';

type Tx = Prisma.TransactionClient;
const identity = Prisma.sql`t.quality_report #> '{browser_identity_binding,identity}'`;
function text(expression: Prisma.Sql): Prisma.Sql {
    return Prisma.sql`CASE WHEN ${expression} IS NULL THEN NULL
        WHEN jsonb_typeof(${expression}) = 'string' AND length(${expression} #>> '{}') <= 500
        THEN ${expression} #>> '{}' ELSE '__invalid__' END`;
}

/** Fixed projections only: no full channel configuration, identity blob or accepted copy is fetched. */
export async function readNativeStateScope(tx: Tx, a: NativeStateRequest) {
    const schema = nativeBindingSourceSchema.extend({ observedAt: z.date() });
    const rows = z.array(schema).parse(await tx.$queryRaw<unknown>(Prisma.sql`
        SELECT c.is_active AS "channelActive", jsonb_typeof(c.config) AS "configKind",
            ${text(Prisma.sql`c.config -> 'account_ref'`)} AS "accountRef",
            ${text(Prisma.sql`c.config -> 'account_type'`)} AS "accountType",
            ${text(Prisma.sql`c.config -> 'profile_url'`)} AS "profileUrl",
            ${text(Prisma.sql`c.config -> 'channel_url'`)} AS "channelUrl",
            ${text(Prisma.sql`c.config #> '{raw_account,url}'`)} AS "rawAccountUrl",
            CASE WHEN t.quality_report IS NOT NULL AND jsonb_typeof(t.quality_report) <> 'object' THEN '__invalid__'
                WHEN t.quality_report ? 'browser_identity_binding' AND jsonb_typeof(t.quality_report -> 'browser_identity_binding') <> 'object'
                THEN '__invalid__' ELSE jsonb_typeof(${identity}) END AS "identityKind",
            ${text(Prisma.sql`${identity} -> 'platform'`)} AS platform,
            ${text(Prisma.sql`${identity} -> 'accountType'`)} AS "boundType",
            ${text(Prisma.sql`${identity} -> 'accountRef'`)} AS "boundAccount",
            ${text(Prisma.sql`${identity} -> 'profileUrl'`)} AS "boundProfile",
            ${text(Prisma.sql`${identity} -> 'providerAccountId'`)} AS "boundProvider", CURRENT_TIMESTAMP AS "observedAt"
        FROM planner.social_channels c JOIN planner.content_items t ON t.channel_id = c.id AND t.project_id = c.project_id
        WHERE c.project_id = ${a.projectId} AND c.id = ${a.channelId} AND c.type = 'x' AND t.id = ${a.taskId} LIMIT 1`));
    if (rows.length !== 1) throw new NativeStateReadError('X_NATIVE_STATE_SCOPE_DENIED');
    return rows[0];
}

/** Union public IDs with malformed-key visibility BEFORE validation; no caller key/filter or actor selector. */
export async function readNativeInventory(tx: Tx, a: NativeStateRequest): Promise<NativeInventorySource> {
    const settingPrefix = `x_native:installation:v1:${a.channelId}:`, auditPrefix = `${a.channelId}:`;
    const idsQuery = Prisma.sql`WITH ids AS (
        SELECT substring(key FROM length(${settingPrefix}) + 1) AS id FROM planner.project_settings
            WHERE project_id = ${a.projectId} AND starts_with(key, ${settingPrefix})
        UNION SELECT substring(idempotency_key FROM length(${auditPrefix}) + 1) FROM planner.workflow_events
            WHERE project_id = ${a.projectId} AND starts_with(idempotency_key, ${auditPrefix})
                AND command IN ('x_native_register_installation','x_native_revoke_installation'))
        SELECT ARRAY(SELECT id FROM ids WHERE id ~ '^[a-f0-9]{64}$' ORDER BY id LIMIT 21) AS ids,
            EXISTS(SELECT 1 FROM ids WHERE id !~ '^[a-f0-9]{64}$') AS "invalidKey"`;
    const found = z.array(z.object({ ids: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(21), invalidKey: z.boolean() }).strict())
        .parse(await tx.$queryRaw<unknown>(idsQuery))[0];
    const ids = found.ids.slice(0, 20);
    if (!ids.length) return { ...found, settings: [], audits: [], revoked: [] };
    const settingKeys = ids.map(value => settingPrefix + value), auditKeys = ids.map(value => auditPrefix + value);
    const settings = z.array(nativeSettingReadSchema).max(20).parse(await tx.$queryRaw<unknown>(Prisma.sql`
        SELECT substring(key FROM length(${settingPrefix}) + 1) AS "installationId",
            CASE WHEN octet_length(value) <= 2048 THEN value ELSE NULL END AS value,
            octet_length(value) > 2048 AS oversized, updated_at AS "updatedAt"
        FROM planner.project_settings WHERE project_id = ${a.projectId} AND key IN (${Prisma.join(settingKeys)})`));
    const audits = z.array(nativeAuditReadSchema).max(81).parse(await tx.$queryRaw<unknown>(Prisma.sql`
        SELECT substring(idempotency_key FROM length(${auditPrefix}) + 1) AS "installationId",
            left(actor_id,32) AS "actorId", command,
            COALESCE(jsonb_typeof(after_state) = 'object' AND octet_length(after_state::text) <= 2048,false) AS "metadataValid",
            CASE WHEN length(after_state ->> 'registration_sha256') = 64 THEN after_state ->> 'registration_sha256'
                ELSE NULL END AS "registrationHash", created_at AS "createdAt"
        FROM planner.workflow_events WHERE project_id = ${a.projectId} AND idempotency_key IN (${Prisma.join(auditKeys)})
            AND command IN ('x_native_register_installation','x_native_revoke_installation') ORDER BY id LIMIT 81`));
    // This EXISTS/aggregate is NOT capped at the audit display limit. Hidden revocation must still win.
    const revoked = z.array(z.object({ installationId: z.string(), revokedAt: z.date() }).strict()).max(20)
        .parse(await tx.$queryRaw<unknown>(Prisma.sql`
        SELECT substring(idempotency_key FROM length(${auditPrefix}) + 1) AS "installationId", min(created_at) AS "revokedAt"
        FROM planner.workflow_events WHERE project_id = ${a.projectId} AND idempotency_key IN (${Prisma.join(auditKeys)})
            AND command = 'x_native_revoke_installation' GROUP BY idempotency_key`));
    return { ...found, settings, audits, revoked };
}

/** Exact-task historical predicates mirror shared delivery fences, not a global jobs platform. */
export async function readNativeTaskState(tx: Tx, a: NativeStateRequest) {
    const rawSchema = nativeTaskStateSchema.omit({ status: true }).extend({ releaseValid: z.boolean() });
    const rows = z.array(rawSchema).parse(await tx.$queryRaw<unknown>(Prisma.sql`
        SELECT EXISTS(SELECT 1 FROM planner.delivery_attempts d WHERE d.project_id = ${a.projectId} AND d.content_item_id = ${a.taskId}) AS "attemptPresent",
            EXISTS(SELECT 1 FROM planner.delivery_attempts d WHERE d.project_id = ${a.projectId} AND d.content_item_id = ${a.taskId}
                AND (d.status = 'pending' OR d.requires_manual_confirmation)) AS "unresolvedAttemptPresent",
            EXISTS(SELECT 1 FROM planner.work_items w WHERE w.project_id = ${a.projectId} AND w.content_item_id = ${a.taskId}
                AND w.kind = 'browser_publish') AS "browserWorkPresent",
            EXISTS(SELECT 1 FROM planner.work_items w WHERE w.project_id = ${a.projectId} AND w.content_item_id = ${a.taskId}
                AND w.kind = 'browser_publish' AND w.state NOT IN ('cancelled','completed')) AS "nonterminalBrowserWorkPresent",
            EXISTS(SELECT 1 FROM planner.connector_dispatch_jobs j WHERE j.project_id = ${a.projectId} AND j.content_item_id = ${a.taskId}
                AND j.state NOT IN ('cancelled','confirmed')) AS "nonterminalDispatchJobPresent",
            EXISTS(SELECT 1 FROM planner.publication_facts f WHERE f.project_id = ${a.projectId} AND f.content_item_id = ${a.taskId}) AS "publicationFactPresent",
            (t.published_link IS NOT NULL AND t.published_link <> '') AS "publishedLinkPresent",
            CASE WHEN t.quality_report IS NOT NULL AND jsonb_typeof(t.quality_report) <> 'object' THEN false
                WHEN t.quality_report ? 'browser_release' THEN jsonb_typeof(t.quality_report -> 'browser_release') = 'object'
                ELSE true END AS "releaseValid",
            CASE WHEN t.quality_report ? 'browser_release' AND jsonb_typeof(t.quality_report -> 'browser_release') <> 'object' THEN NULL
                ELSE COALESCE(t.quality_report ? 'browser_release',false) END AS "currentReleasePresent"
        FROM planner.content_items t WHERE t.project_id = ${a.projectId} AND t.id = ${a.taskId} LIMIT 1`));
    if (!rows.length) throw new NativeStateReadError('X_NATIVE_STATE_SCOPE_DENIED');
    const { releaseValid, ...state } = rows[0];
    return nativeTaskStateSchema.parse({ ...state, status: releaseValid ? 'known' : 'unknown',
        currentReleasePresent: releaseValid ? state.currentReleasePresent : null });
}
