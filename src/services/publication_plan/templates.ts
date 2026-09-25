import * as fs from 'fs';
import { PublicationPlan } from './types';

/**
 * Resolves an asset reference from a url_ref string (e.g. 'body_post_1' or 'assets.body_post_1.url').
 */
export function resolveAssetRefFromUrlRef(plan: PublicationPlan, urlRef?: string | null): string | null {
    if (!urlRef || typeof urlRef !== 'string') return null;
    if (plan.assets?.[urlRef]) return urlRef;
    if (urlRef.startsWith('assets.')) {
        const candidate = urlRef.slice('assets.'.length).split('.')[0];
        return plan.assets?.[candidate] ? candidate : null;
    }
    return null;
}

/**
 * Returns schema and UI mapping documentation for the publication plan format.
 */
export function getPublicationPlanFormat(): Record<string, unknown> {
    return {
        version: '2026-06-publication-plan-v2',
        summary: 'Preferred planner publication-plan format for MCP and chat-generated plans.',
        top_level: {
            required: ['meta', 'accounts', 'assets', 'actions'],
            optional: ['ongoing_rules', 'measurement', 'dependencies_matrix_visualized', 'content_dictionary', 'content_policy_matrix', 'atoma_files', 'atoma_files_description']
        },
        meta: {
            required: ['plan_id'],
            optional: [
                'plan_version',
                'generated_at',
                'source_article_id',
                'cycle_start',
                'cycle_end',
                'timezone_default',
                'owner',
                'pipeline_root',
                'week_theme',
                'theme_hint',
                'project_name',
                'description'
            ]
        },
        accounts: {
            shape: 'Record<string, account>',
            required_fields: ['platform'],
            examples: [
                { ref: 'spherical_analyst_tg', platform: 'telegram' },
                { ref: 'seturon_linkedin', platform: 'linkedin' }
            ]
        },
        assets: {
            shape: 'Record<string, asset>',
            supported_patterns: [
                {
                    kind: 'inline_preview',
                    when_to_use: 'Short preview, teaser, or compact raw note that can be rendered directly in UI.',
                    fields: ['type', 'content']
                },
                {
                    kind: 'file_backed_content',
                    when_to_use: 'Full draft or source material stored in a markdown/html file.',
                    fields: ['type', 'path', 'section_marker?']
                },
                {
                    kind: 'url_asset',
                    when_to_use: 'Canonical URL, destination page, image source, or external reference.',
                    fields: ['type', 'target_url']
                }
            ]
        },
        actions: {
            shape: 'Array<action>',
            required_fields: ['id', 'channel', 'account_ref', 'action_type'],
            strongly_recommended_fields: ['display_name'],
            preferred_content_pattern: {
                rule: 'For full publication text, use action.content_files. Do not rely on free-text hints inside asset.content.',
                content_files_item: {
                    required: ['role'],
                    recommended: ['purpose'],
                    one_of: [
                        ['path'],
                        ['url'],
                        ['url_ref']
                    ],
                    optional: ['section_marker']
                }
            },
            ui_mapping: {
                title: {
                    source: 'action.display_name',
                    fallback: 'resolved runtime title from action.id/type',
                    recommendation: 'Always provide display_name so the task card and workspace header show a human-readable title.'
                },
                brief: {
                    source: 'action.notes',
                    fallback: 'action.human_review_reason',
                    recommendation: 'Use notes for the short task summary shown in channel and publication task cards.'
                },
                publication_body: {
                    source: 'action.content_files[]',
                    recommendation: 'Put the main post/article body in content_files. This is what the UI renders in the publication editor.'
                },
                source_files_panel: {
                    source: 'handoff_bundle.resource_files',
                    recommendation: 'Each content_files entry becomes a visible source file/resource entry in the UI.'
                },
                target_resource_url: {
                    source: 'action.parameters.link_url_ref',
                    recommendation: 'Use a ref that resolves to assets.<ref>.target_url or another plan URL so the UI can show the destination resource for editing/publishing.'
                },
                schedule: {
                    preferred: 'action.scheduled_at',
                    fallback: 'action.scheduled_date + action.scheduled_time_window',
                    recommendation: 'Use scheduled_at when possible for the most predictable UI sorting.'
                }
            }
        },
        ui_ready_recipes: {
            inline_body_asset: {
                when_to_use: 'When the full publication text is generated directly in chat/MCP and should be stored inside the plan.',
                assets: {
                    body_post_1: {
                        type: 'inline_publication_body',
                        content: 'Full publication text goes here.'
                    }
                },
                action: {
                    display_name: 'Telegram — Founder note',
                    notes: 'Short summary for the task card.',
                    scheduled_at: '2026-07-01T10:00:00Z',
                    parameters: {
                        link_url_ref: 'assets.target_article_url.target_url'
                    },
                    content_files: [
                        {
                            role: 'post_body',
                            purpose: 'Primary publication body shown in UI',
                            url_ref: 'body_post_1'
                        }
                    ]
                }
            },
            file_backed_body: {
                when_to_use: 'When the full text already exists in a markdown/html file in the content workspace.',
                assets: {
                    article_source_1: {
                        type: 'markdown_source',
                        path: 'content/weeks/w01.md'
                    }
                },
                action: {
                    display_name: 'LinkedIn — Thought piece',
                    notes: 'Short summary for the task card.',
                    scheduled_at: '2026-07-01T10:00:00Z',
                    content_files: [
                        {
                            role: 'post_body',
                            purpose: 'Primary publication body shown in UI',
                            path: 'content/weeks/w01.md',
                            section_marker: '## Founder voice 1'
                        }
                    ]
                }
            }
        },
        recommendations: [
            'Use asset.content only for compact inline text or preview notes.',
            'Use action.content_files for the full publication body, markdown sections, or HTML fragments.',
            'If you want inline body text to render in UI, store it in assets.<body_ref>.content and reference it from action.content_files[].url_ref.',
            'If you want a short description on task cards, put it in action.notes.',
            'If you want the destination/resource link in UI, put a plan ref into action.parameters.link_url_ref.',
            'If you want reliable schedule sorting in UI, prefer action.scheduled_at.',
            'Use unique section_marker values that match stable headings in the source file.',
            'If a post depends on a full markdown section, make that dependency explicit in content_files.',
            'Attach content_dictionary to import glossary/style rules together with the publication plan.',
            'Attach content_policy_matrix to define platform + tone-of-voice rules for critic/fixer checks.',
            'Attach atoma_files and atoma_files_description when the critic should validate against atomized source context.'
        ]
    };
}

/**
 * Generates an empty or starter publication plan template.
 */
export function getPublicationPlanTemplate(input: {
    planId?: string;
    projectName?: string;
    owner?: string;
    timezone?: string;
    channelRef?: string;
    channelPlatform?: string;
} = {}): PublicationPlan {
    const planId = input.planId || 'project-cycle-2026-06';
    const channelRef = input.channelRef || 'primary_channel';
    const channelPlatform = input.channelPlatform || 'telegram';
    const timezone = input.timezone || 'Europe/Lisbon';

    return {
        meta: {
            plan_id: planId,
            plan_version: '1.0.0',
            generated_at: new Date().toISOString(),
            cycle_start: '2026-06-01',
            cycle_end: '2026-06-30',
            timezone_default: timezone,
            owner: input.owner || 'workspace_owner',
            week_theme: 'Тема недели, которую дальше использует автоматическая генерация',
            project_name: input.projectName || 'Новый проект',
            description: 'План публикаций, подготовленный через MCP/чат.'
        },
        accounts: {
            [channelRef]: {
                platform: channelPlatform
            }
        },
        assets: {
            teaser_note_1: {
                type: `${channelPlatform}_inline_preview`,
                content: 'Краткая идея или превью материала для быстрых карточек в UI.'
            },
            body_inline_1: {
                type: 'inline_publication_body',
                content: 'Полный текст публикации, который UI должен сразу показать в редакторе публикации.'
            },
            article_source_1: {
                type: 'markdown_source',
                path: 'weeks/w01.md',
                section_marker: 'Idea 1 — «Название секции»'
            },
            target_article_url: {
                type: 'canonical_url',
                target_url: 'https://example.com/article'
            }
        },
        actions: [
            {
                id: 'a-w01-001',
                display_name: `${channelPlatform} — публикация 1`,
                channel: channelPlatform,
                account_ref: channelRef,
                action_type: 'post_text',
                status: 'planned',
                scheduled_at: '2026-06-03T10:00:00Z',
                asset_refs: ['teaser_note_1'],
                content_files: [
                    {
                        role: 'post_body',
                        purpose: 'Основной текст публикации, отображаемый в UI',
                        url_ref: 'body_inline_1'
                    },
                    {
                        role: 'source_context',
                        purpose: 'Полный текст публикации',
                        path: 'weeks/w01.md',
                        section_marker: 'Idea 1 — «Название секции»'
                    }
                ],
                parameters: {
                    link_url_ref: 'assets.target_article_url.target_url'
                },
                notes: 'Краткий комментарий по задаче. Это поле попадает в short summary карточки.'
            }
        ],
        ongoing_rules: [],
        measurement: {},
        content_dictionary: {
            terms: [],
            style_rules: {
                required_phrases: [],
                forbidden_phrases: [],
                preferred_tone: 'direct, practical, non-generic'
            }
        },
        content_policy_matrix: {
            voices: {
                founder: {
                    preferred_traits: ['позиция', 'личный опыт']
                }
            },
            platforms: {
                telegram: {
                    min_chars: 700,
                    max_chars: 4000
                }
            },
            matrix: {
                telegram: {
                    founder: {
                        preferred_traits: ['авторская позиция', 'живой конфликт']
                    }
                }
            }
        },
        atoma_files_description: 'Описание atomized source files и правил их использования для редактора/критика.',
        atoma_files: {
            source_map: [],
            editorial_rules: []
        }
    };
}

/**
 * Parses raw JSON string into a validated PublicationPlan object.
 */
export function parsePlan(raw: string): PublicationPlan {
    const parsed = JSON.parse(raw);
    if (!parsed?.meta?.plan_id || !parsed?.accounts || !parsed?.assets || !Array.isArray(parsed?.actions)) {
        throw new Error('Invalid publication plan: expected meta.plan_id, accounts, assets, actions[]');
    }
    return parsed as PublicationPlan;
}

/**
 * Loads and parses a publication plan JSON file from a local filesystem path.
 */
export function loadPlanFromPath(planPath: string): PublicationPlan {
    const raw = fs.readFileSync(planPath, 'utf8');
    return parsePlan(raw);
}

/**
 * Normalizes publication plan structure and collects validation warnings.
 */
export function normalizePublicationPlan(raw: string): {
    normalizedPlan: PublicationPlan;
    warnings: string[];
    format: Record<string, unknown>;
} {
    const parsed = parsePlan(raw);
    const warnings: string[] = [];

    const normalized: PublicationPlan = {
        ...parsed,
        ongoing_rules: Array.isArray(parsed.ongoing_rules) ? parsed.ongoing_rules : [],
        measurement: parsed.measurement || {},
        actions: parsed.actions.map((action: Record<string, unknown>) => {
            const contentFilesRaw = Array.isArray(action.content_files) ? action.content_files : [];
            const normalizedAction: Record<string, unknown> = {
                ...action,
                asset_refs: Array.isArray(action.asset_refs) ? action.asset_refs : [],
                content_files: contentFilesRaw
                    .filter(Boolean)
                    .map((entry: Record<string, unknown>) => ({
                        role: entry.role || 'post_body',
                        purpose: entry.purpose || null,
                        path: entry.path || null,
                        url: entry.url || null,
                        url_ref: entry.url_ref || null,
                        section_marker: entry.section_marker || null
                    }))
            };

            const actionId = String(action.id || '');

            if (!normalizedAction.display_name) {
                warnings.push(`Action '${actionId}' is missing display_name.`);
            }

            if (!normalizedAction.notes && !normalizedAction.human_review_reason) {
                warnings.push(`Action '${actionId}' is missing notes. UI task cards will have no short summary.`);
            }

            if (!normalizedAction.scheduled_at && !normalizedAction.scheduled_date) {
                warnings.push(`Action '${actionId}' is missing scheduled_at or scheduled_date. UI sorting may be unstable.`);
            }

            const contentFiles = normalizedAction.content_files as Array<Record<string, unknown>>;
            const assetRefs = normalizedAction.asset_refs as string[];

            if (contentFiles.length === 0 && assetRefs.length > 0) {
                const inlineOnlyRefs = assetRefs.filter((ref: string) => {
                    const asset = parsed.assets?.[ref];
                    return asset && typeof asset.content === 'string' && !asset.path;
                });

                if (inlineOnlyRefs.length > 0) {
                    warnings.push(
                        `Action '${actionId}' relies on inline asset content (${inlineOnlyRefs.join(', ')}). Add content_files for full text if this should render a complete draft.`
                    );
                }
            }

            contentFiles.forEach((entry: Record<string, unknown>, index: number) => {
                if (!entry.path && !entry.url && !entry.url_ref) {
                    warnings.push(`Action '${actionId}' content_files[${index}] should define path, url, or url_ref.`);
                }
                if (entry.url_ref) {
                    const assetRef = resolveAssetRefFromUrlRef(parsed, entry.url_ref as string);
                    if (!assetRef && typeof entry.url_ref === 'string' && !entry.url_ref.startsWith('http')) {
                        warnings.push(`Action '${actionId}' content_files[${index}] uses url_ref='${entry.url_ref}', but no asset with that ref exists. Use assets.<ref> and point url_ref to that ref.`);
                    }
                }
                if (entry.path && !entry.section_marker) {
                    warnings.push(`Action '${actionId}' content_files[${index}] uses a path without section_marker. This is valid, but section_marker is recommended for multi-section files.`);
                }
            });

            return normalizedAction;
        })
    };

    return {
        normalizedPlan: normalized,
        warnings,
        format: getPublicationPlanFormat()
    };
}
