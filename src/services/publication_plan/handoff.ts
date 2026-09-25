import * as path from 'path';
import { createHash } from 'crypto';
import { PublicationPlan, PublicationPlanAccount } from './types';
import publicationAdapterService, { PublicationAction } from '../publication_adapter.service';
import { canonicalStoryActionType } from '../publication_metadata_repair';
import { isServerResolvableVisualUrl, visualMetadataFromProvenance } from '../visual_asset_binding.service';
import {
    publicationPlacementAssetContract,
    publicationPlacementManualChecklistNotes
} from '../publication_placement_contract';
import { bindVkStoryPollToRevision } from '../vk_story_poll';
import {
    resolveRef,
    dedupeResourceFiles,
    inferContentType,
    inferContentTypeFromUrl,
    contentFileSnapshotKey
} from './utils';
import {
    resolveContentFileDescriptor,
    readAssetContent,
    resolveAssetRuntime,
    AssetRuntimeResolution
} from './snapshots';

export interface ResourceFileEntry {
    ref: string;
    type: string | null;
    role: string | null;
    purpose: string | null;
    file_name: string | null;
    relative_path: string | null;
    full_path: string | null;
    section_marker: string | null;
    exists: boolean;
    url: string | null;
    preview_url: string | null;
    content: string | null;
    content_type?: string | null;
    checksum_sha256?: string | null;
    byte_size?: number | null;
    width?: number | null;
    height?: number | null;
    color_mode?: string | null;
    provenance?: unknown;
    snapshot_available?: boolean;
    content_source?: string | null;
}

export interface AcceptedPublicationBody {
    body: string;
    binding: {
        accepted_revision: number;
        body_sha256: string;
    } | null;
}

export interface ApprovedSelectedAsset {
    id: number;
    file_url: string;
    alt_text?: string | null;
    status: string;
    content_revision?: number | null;
    provenance?: Record<string, unknown> | null;
    [key: string]: unknown;
}

/**
 * Validates and extracts the accepted text body for publication handoff.
 */
export function resolveAcceptedPublicationBody(
    item: Record<string, unknown> | null | undefined,
    required = false
): AcceptedPublicationBody {
    const accepted = item?.text_state === 'accepted'
        && Boolean(item?.accepted_revision)
        && item.accepted_revision === item.content_revision;
    if (required && !accepted) {
        throw new Error('[ACCEPTED_REVISION_REQUIRED] Handoff requires the current accepted text revision');
    }
    const body = typeof item?.draft_text === 'string' ? item.draft_text : '';
    if (required && !body.trim()) throw new Error('[ACCEPTED_BODY_REQUIRED] Accepted publication body is empty');
    return {
        body,
        binding: accepted ? {
            accepted_revision: item?.accepted_revision as number,
            body_sha256: createHash('sha256').update(body).digest('hex')
        } : null
    };
}

/**
 * Resolves and validates an approved visual asset bound to the accepted content revision.
 */
export function resolveApprovedSelectedAsset(
    item: Record<string, unknown> | null | undefined
): ApprovedSelectedAsset | null {
    if (!item?.selected_asset_id && !item?.selected_asset) return null;
    const selectedAsset = item.selected_asset as ApprovedSelectedAsset | undefined;
    if (!selectedAsset) {
        throw new Error('[APPROVED_VISUAL_UNRESOLVABLE] Selected visual asset could not be loaded');
    }
    if (selectedAsset.status !== 'approved'
        || selectedAsset.content_revision !== item.accepted_revision) {
        throw new Error('[APPROVED_VISUAL_REQUIRED] Selected visual must be approved for the accepted content revision');
    }
    if (!isServerResolvableVisualUrl(selectedAsset.file_url)) {
        throw new Error('[APPROVED_VISUAL_NOT_SERVER_RESOLVABLE] Selected approved visual must use a durable HTTPS URL');
    }
    return { ...selectedAsset, file_url: selectedAsset.file_url.trim() };
}

/**
 * Builds the handoff bundle for a plan action/item.
 */
export function buildHandoffBundle(
    plan: PublicationPlan,
    item: Record<string, unknown>,
    options: { requireAcceptedContent?: boolean } = {}
) {
    const itemAssets = (item.assets as Record<string, unknown>) || {};
    const importedAction = (itemAssets.action as Record<string, unknown>) || {};
    const placement = (item.visual_placement as string) || 'feed';
    const channel = item.channel as { type?: string; name?: string; config?: Record<string, unknown> } | undefined;
    const canonicalChannelType = channel?.type || (importedAction.channel as string) || (item.layer as string) || 'unknown';
    const accountRef = channel?.name || (itemAssets.account_ref as string) || null;
    const action: Record<string, unknown> = {
        ...importedAction,
        ...(channel ? {
            account_ref: accountRef,
            channel: canonicalChannelType,
            action_type: placement === 'story'
                ? canonicalStoryActionType(canonicalChannelType, placement)
                : canonicalChannelType === 'vk' && placement === 'article_cover'
                    ? 'vk_article:publish'
                    : importedAction.action_type
        } : {})
    };
    const channelConfig = channel?.config || {};
    const account: PublicationPlanAccount = (accountRef ? plan.accounts[accountRef] : null)
        || (channelConfig.raw_account as PublicationPlanAccount)
        || { platform: canonicalChannelType };
    const assetRefs = Array.isArray(itemAssets.asset_refs) ? (itemAssets.asset_refs as string[]) : [];
    const persistedResolvedAssets = Array.isArray(itemAssets.resolved_assets) ? itemAssets.resolved_assets : [];
    const persistedKeyPoints = Array.isArray(item.key_points) ? item.key_points : [];
    const persistedAssetsByRef = new Map<string, Record<string, unknown>>();
    const selectedAsset = resolveApprovedSelectedAsset(item);
    const acceptedContent = resolveAcceptedPublicationBody(item, options.requireAcceptedContent);
    const nativePollCandidate = canonicalChannelType === 'vk' && placement === 'story'
        ? (itemAssets.vk_story_poll ?? null)
        : null;
    const nativePoll = nativePollCandidate
        ? bindVkStoryPollToRevision(nativePollCandidate, Number(item.content_revision))
        : null;
    const selectedAssetMetadata = selectedAsset ? visualMetadataFromProvenance(selectedAsset.provenance) : {};
    const inferPersistedFileName = (runtimeFileName: string | null | undefined, persistedAsset: Record<string, unknown>) => {
        if (runtimeFileName) return runtimeFileName;
        if (typeof persistedAsset?.path === 'string' && persistedAsset.path.trim()) {
            return path.basename(persistedAsset.path);
        }
        return null;
    };

    [...persistedResolvedAssets, ...persistedKeyPoints].forEach((entry: unknown) => {
        const e = entry as { ref?: string; asset?: Record<string, unknown>; path?: string; section_marker?: string; content?: string } | null;
        const ref = typeof e?.ref === 'string' ? e.ref : null;
        if (!ref) return;
        const asset = e?.asset || (e as Record<string, unknown>);
        if (!asset) return;
        persistedAssetsByRef.set(ref, asset);
    });

    const resolvedAssets = assetRefs.map((ref: string) => {
        const runtimeAsset = resolveAssetRuntime(plan, ref);
        const persistedAsset = persistedAssetsByRef.get(ref);

        if (!persistedAsset) {
            return runtimeAsset;
        }

        return {
            ...runtimeAsset,
            asset: runtimeAsset.asset || persistedAsset,
            file_name: inferPersistedFileName(runtimeAsset.file_name, persistedAsset),
            relative_path: runtimeAsset.relative_path || (persistedAsset.path as string) || null,
            section_marker: runtimeAsset.section_marker || (persistedAsset.section_marker as string) || null,
            content: runtimeAsset.content || (persistedAsset.content as string) || null,
            exists: runtimeAsset.exists === true || typeof persistedAsset.content === 'string',
            snapshot_available: runtimeAsset.snapshot_available === true || typeof persistedAsset.content === 'string',
            content_source: runtimeAsset.content_source || (typeof persistedAsset.content === 'string' ? 'persisted_inline_asset' : null)
        };
    });
    const contentFiles = Array.isArray(action.content_files) ? action.content_files : [];
    const resolvedContentFiles = contentFiles.map((fileEntry: unknown, index: number) => {
        const file = fileEntry as { url_ref?: string; path?: string; url?: string; role?: string; purpose?: string; section_marker?: string };
        const descriptor = resolveContentFileDescriptor(plan, file);
        const relativePath = descriptor.relativePath;
        const resolvedUrl = descriptor.resolvedUrl;
        const assetRuntime: AssetRuntimeResolution | null = descriptor.resolvedAssetRef
            ? (() => {
                const runtime = resolveAssetRuntime(plan, descriptor.resolvedAssetRef);
                const persistedAsset = persistedAssetsByRef.get(descriptor.resolvedAssetRef);

                if (!persistedAsset) {
                    return runtime;
                }

                return {
                    ...runtime,
                    asset: runtime.asset || persistedAsset,
                    file_name: inferPersistedFileName(runtime.file_name, persistedAsset),
                    relative_path: runtime.relative_path || (persistedAsset.path as string) || null,
                    section_marker: runtime.section_marker || (persistedAsset.section_marker as string) || null,
                    content: runtime.content || (persistedAsset.content as string) || null,
                    exists: runtime.exists === true || typeof persistedAsset.content === 'string',
                    snapshot_available: runtime.snapshot_available === true || typeof persistedAsset.content === 'string',
                    content_source: runtime.content_source || (typeof persistedAsset.content === 'string' ? 'persisted_inline_asset' : null)
                };
            })()
            : null;
        let content: string | null = null;
        let exists = false;
        let fullPath: string | null = null;
        let contentSource: string | null = null;
        const snapshotKey = relativePath ? contentFileSnapshotKey(relativePath, file.section_marker || null) : null;
        const snapshot = snapshotKey ? plan.content_file_snapshots?.[snapshotKey] || null : null;

        if (relativePath) {
            const syntheticAsset = {
                path: relativePath,
                section_marker: file.section_marker || null
            };
            const resolved = readAssetContent(plan, syntheticAsset, relativePath);
            fullPath = resolved?.fullPath || (plan.meta.pipeline_root ? path.resolve(plan.meta.pipeline_root, relativePath) : null);
            if (resolved?.content) {
                exists = true;
                content = resolved.content;
                contentSource = 'filesystem';
            }
        }

        if (!content && resolvedUrl && plan._fetched_url_contents?.[resolvedUrl]) {
            content = plan._fetched_url_contents[resolvedUrl];
            exists = true;
            contentSource = 'url_fetch';
        }

        if (!content && snapshot?.content) {
            content = snapshot.content;
            contentSource = snapshot.source || 'snapshot';
        }

        if (!content && assetRuntime?.content) {
            content = assetRuntime.content;
            exists = assetRuntime.exists === true;
            fullPath = assetRuntime.full_path || fullPath;
            contentSource = assetRuntime.content_source || null;
        }

        return {
            ref: `content_file_${index + 1}`,
            type: 'content_file',
            role: file.role || null,
            purpose: file.purpose || null,
            file_name: relativePath
                ? path.basename(relativePath)
                : (assetRuntime?.file_name || (descriptor.resolvedAssetRef || null)),
            relative_path: relativePath,
            full_path: fullPath,
            section_marker: file.section_marker || assetRuntime?.section_marker || null,
            exists: exists || Boolean(snapshot?.content) || assetRuntime?.exists === true,
            url: resolvedUrl || assetRuntime?.url || null,
            preview_url: assetRuntime?.url || resolvedUrl || null,
            content,
            content_type: assetRuntime?.content_type || inferContentType(relativePath) || inferContentTypeFromUrl(resolvedUrl),
            snapshot_available: Boolean(snapshot?.content) || Boolean(assetRuntime?.snapshot_available),
            content_source: contentSource
        };
    });

    const actionParams = action.parameters as { link_url_ref?: string } | undefined;
    const linkUrl = resolveRef(plan, actionParams?.link_url_ref || (item.cta as string) || null);

    const resourceFiles = dedupeResourceFiles<ResourceFileEntry>([
        ...(selectedAsset ? [{
            ref: 'selected_asset',
            type: 'image',
            role: 'publication_image',
            purpose: 'approved_visual',
            file_name: ((selectedAsset.provenance as Record<string, unknown>)?.planner_storage as { original_file_name?: string } | undefined)?.original_file_name || null,
            relative_path: null,
            full_path: null,
            section_marker: null,
            exists: isServerResolvableVisualUrl(selectedAsset.file_url),
            url: selectedAsset.file_url,
            preview_url: selectedAsset.file_url,
            content: null,
            content_type: selectedAssetMetadata.mime_type || null,
            checksum_sha256: selectedAssetMetadata.sha256 || null,
            byte_size: selectedAssetMetadata.byte_size || null,
            width: selectedAssetMetadata.width || null,
            height: selectedAssetMetadata.height || null,
            color_mode: selectedAssetMetadata.color_mode || null,
            provenance: selectedAsset.provenance || null,
            content_source: 'selected_image_asset'
        }] : []),
        ...resolvedContentFiles,
        ...resolvedAssets.map((entry: AssetRuntimeResolution) => ({
            ref: entry.ref,
            type: (entry.asset?.type as string) || null,
            role: null,
            purpose: null,
            file_name: entry.file_name || null,
            relative_path: entry.relative_path || null,
            full_path: entry.full_path || null,
            section_marker: entry.section_marker || null,
            exists: entry.exists === true,
            url: entry.url || null,
            preview_url: entry.url || null,
            content: entry.content || null,
            content_type: entry.content_type || null
        }))
    ]);

    const placementContract = publicationPlacementAssetContract(
        { type: canonicalChannelType, config: channel?.config },
        placement
    );

    const itemScheduleAt = item.schedule_at as { toISOString?: () => string } | string | null | undefined;
    const scheduleAtString = (action.scheduled_at as string)
        || (typeof itemScheduleAt === 'object' && itemScheduleAt?.toISOString ? itemScheduleAt.toISOString() : (itemScheduleAt as string))
        || null;

    return {
        mode: placementContract.transport.connector_authority === 'manual_only'
            ? 'manual'
            : publicationAdapterService.inferExecutionMode(account, action as unknown as PublicationAction),
        account: {
            ref: accountRef,
            details: account
        },
        task: {
            id: action.id || item.id,
            display_name: action.display_name || item.title || null,
            channel: canonicalChannelType,
            action_type: action.action_type || item.type,
            schedule_at: scheduleAtString,
            scheduled_date: action.scheduled_date || item.schedule_at,
            time_window: action.scheduled_time_window || null,
            placement
        },
        placement_contract: placementContract,
        transport: placementContract.transport,
        publication: {
            body: acceptedContent.body,
            content_binding: acceptedContent.binding,
            html_bundle: resolvedAssets.filter((entry: AssetRuntimeResolution) => (entry.asset?.type as string)?.includes('html')),
            link_url: linkUrl,
            image_url: selectedAsset?.file_url || null,
            alt_text: selectedAsset?.alt_text || null,
            native_poll: nativePoll,
            visuals: selectedAsset
                ? [{
                    ref: 'selected_asset',
                    asset_id: selectedAsset.id,
                    url: selectedAsset.file_url,
                    preview_url: selectedAsset.file_url,
                    alt_text: selectedAsset.alt_text || null,
                    status: selectedAsset.status,
                    content_revision: selectedAsset.content_revision,
                    checksum_sha256: selectedAssetMetadata.sha256 || null,
                    content_type: selectedAssetMetadata.mime_type || null,
                    width: selectedAssetMetadata.width || null,
                    height: selectedAssetMetadata.height || null,
                    provenance: selectedAsset.provenance || null
                }]
                : resolvedAssets.filter((entry: AssetRuntimeResolution) => (entry.asset?.visual_style || entry.asset?.gamma_source))
        },
        resource_files: resourceFiles,
        manual_checklist: [
            ...publicationAdapterService.buildManualChecklist(action as unknown as PublicationAction, {
                linkUrl: linkUrl as string | null,
                accountRef
            }),
            ...publicationPlacementManualChecklistNotes(placementContract)
        ],
        verification: action.verification || [],
        post_actions: action.post_actions || [],
        dependencies: action.dependencies || []
    };
}

/**
 * Builds handoff bundle for generated content items without an imported plan.
 */
export function buildGeneratedContentItemHandoff(
    item: Record<string, unknown>,
    options: { requireAcceptedContent?: boolean } = {}
) {
    const channel = item.channel as { type?: string; name?: string; config?: Record<string, unknown> } | undefined;
    const channelType = channel?.type || (item.layer as string) || 'unknown';
    const placement = (item.visual_placement as string) || 'feed';
    const placementContract = publicationPlacementAssetContract(
        { type: channelType, config: channel?.config },
        placement
    );
    const acceptedContent = resolveAcceptedPublicationBody(item, options.requireAcceptedContent);
    const body = acceptedContent.body;
    const mode = placementContract.transport.connector_authority === 'manual_only'
        || ['manual', 'manual_handoff', 'browser_required'].includes(String(item.publication_mode || ''))
        ? 'manual'
        : 'automated';
    const selectedAsset = resolveApprovedSelectedAsset(item);
    const selectedAssetMetadata = selectedAsset ? visualMetadataFromProvenance(selectedAsset.provenance) : {};
    const itemAssets = (item.assets as Record<string, unknown>) || {};
    const nativePollCandidate = channelType === 'vk' && placement === 'story'
        ? (itemAssets.vk_story_poll ?? null)
        : null;
    const nativePoll = nativePollCandidate
        ? bindVkStoryPollToRevision(nativePollCandidate, Number(item.content_revision))
        : null;

    const itemScheduleAt = item.schedule_at as { toISOString?: () => string } | string | null | undefined;
    const scheduleAtString = (typeof itemScheduleAt === 'object' && itemScheduleAt?.toISOString ? itemScheduleAt.toISOString() : (itemScheduleAt as string)) || null;

    return {
        task: {
            id: item.item_key || `content-item:${item.id}`,
            content_item_id: item.id,
            action_type: channelType === 'vk' && placement === 'article_cover'
                ? 'vk_article:publish'
                : `${channelType}_${placement}:publish`,
            channel: channelType,
            placement,
            account_ref: channel?.name || null,
            schedule_at: scheduleAtString
        },
        mode: mode as 'manual' | 'automated',
        placement_contract: placementContract,
        transport: placementContract.transport,
        publication: {
            body,
            content_binding: acceptedContent.binding,
            link_url: null,
            html_bundle: [{ asset: { title: item.title || null, content: body } }],
            image_url: selectedAsset?.file_url || null,
            alt_text: selectedAsset?.alt_text || null,
            native_poll: nativePoll
        },
        resource_files: selectedAsset ? [{
            ref: 'selected_asset',
            type: 'image',
            role: 'publication_image',
            purpose: 'approved_visual',
            file_name: ((selectedAsset.provenance as Record<string, unknown>)?.planner_storage as { original_file_name?: string } | undefined)?.original_file_name || null,
            exists: true,
            url: selectedAsset.file_url,
            preview_url: selectedAsset.file_url,
            content: null,
            content_type: selectedAssetMetadata.mime_type || null,
            checksum_sha256: selectedAssetMetadata.sha256 || null,
            byte_size: selectedAssetMetadata.byte_size || null,
            width: selectedAssetMetadata.width || null,
            height: selectedAssetMetadata.height || null,
            color_mode: selectedAssetMetadata.color_mode || null,
            provenance: selectedAsset.provenance || null,
            content_source: 'selected_image_asset'
        }] : [],
        checklist: [
            ...publicationAdapterService.buildManualChecklist({
                id: (item.item_key as string) || `content-item:${item.id}`,
                channel: channelType,
                action_type: `${channelType}_post:publish`
            }, {
                accountRef: channel?.name || null,
                linkUrl: null
            }),
            ...publicationPlacementManualChecklistNotes(placementContract)
        ],
        monitoring: publicationAdapterService.deriveMonitoringPlan({
            id: (item.item_key as string) || `content-item:${item.id}`,
            channel: channelType,
            action_type: `${channelType}_post:publish`
        })
    };
}
