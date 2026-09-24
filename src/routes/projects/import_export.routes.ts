import { FastifyInstance } from 'fastify';
import prisma from '../../db';
import publicationPlanService from '../../services/publication_plan.service';
import { safeEncryptProviderKey } from '../../utils/channel_secrets';
import { jsonBytes, logEgressDiagnostic, textBytes } from '../../utils/egress_diagnostics';
import {
    AuthenticatedUser,
    buildImportedProjectData,
    resolveOwnedOrganizationId
} from './helpers';

export default async function projectImportExportRoutes(fastify: FastifyInstance) {
    fastify.post('/api/projects/import', async (request, reply) => {
        const user = (request as unknown as { user: AuthenticatedUser }).user;
        const { config } = (request.body as { config?: string }) || {};

        if (!config || typeof config !== 'string') {
            return reply.code(400).send({ error: 'Configuration text is required' });
        }

        try {
            const imported = await buildImportedProjectData(config, user.id);
            const organization_id = await resolveOwnedOrganizationId(user.id);

            const project = await prisma.$transaction(async (tx) => {
                const createdProject = await tx.project.create({
                    data: { ...imported.project, organization_id, research_profile: { create: { revision: 1 } } }
                });

                if (imported.settings.length > 0) {
                    await tx.projectSettings.createMany({
                        data: imported.settings.map((setting) => ({
                            project_id: createdProject.id,
                            key: setting.key,
                            value: setting.value
                        }))
                    });
                }

                const createdProviderKeys = new Map<string, number>();

                for (const providerKey of imported.providerKeys) {
                    const createdKey = await tx.providerKey.create({
                        data: {
                            project_id: createdProject.id,
                            name: providerKey.name,
                            key: safeEncryptProviderKey(providerKey.key),
                            provider: providerKey.provider
                        }
                    });

                    createdProviderKeys.set(providerKey.name, createdKey.id);
                }

                if (imported.channels.length > 0) {
                    await tx.socialChannel.createMany({
                        data: imported.channels.map((channel) => ({
                            project_id: createdProject.id,
                            type: channel.type,
                            name: channel.name,
                            config: channel.config
                        }))
                    });
                }

                if (imported.presets.length > 0) {
                    await tx.promptPreset.createMany({
                        data: imported.presets.map((preset) => ({
                            project_id: createdProject.id,
                            name: preset.name,
                            role: preset.role,
                            prompt_text: preset.prompt_text
                        }))
                    });
                }

                if (imported.skillConnections.length > 0) {
                    await tx.projectSettings.create({
                        data: {
                            project_id: createdProject.id,
                            key: 'llm_skill_connections',
                            value: JSON.stringify(
                                imported.skillConnections.map((connection) => ({
                                    ...connection,
                                    providerKeyId: connection.providerKeyName
                                        ? (createdProviderKeys.get(connection.providerKeyName) || null)
                                        : connection.providerKeyId
                                }))
                            )
                        }
                    });
                }

                return createdProject;
            });

            return {
                ...project,
                imported: {
                    settings: imported.settings.length,
                    providerKeys: imported.providerKeys.length,
                    channels: imported.channels.length,
                    presets: imported.presets.length,
                    skillConnections: imported.skillConnections.length
                }
            };
        } catch (error: unknown) {
            return reply.code(400).send({ error: (error as Error).message || 'Failed to import project configuration' });
        }
    });

    fastify.post('/api/projects/import-publication-plan', async (request, reply) => {
        const user = (request as unknown as { user: AuthenticatedUser }).user;
        const { planJson, planPath, workspaceRoots, importMode } = (request.body as {
            planJson?: string;
            planPath?: string;
            workspaceRoots?: string[];
            importMode?: 'delta_safe' | 'full_sync';
        }) || {};

        if (!planJson && !planPath) {
            return reply.code(400).send({ error: 'planJson or planPath is required' });
        }

        try {
            const result = await publicationPlanService.importPlan({
                rawPlan: planJson,
                planPath,
                userId: user.id,
                workspaceRoots: Array.isArray(workspaceRoots) ? workspaceRoots : undefined,
                importMode: importMode || 'delta_safe'
            });

            logEgressDiagnostic('projects.import_publication_plan', {
                userId: user.id,
                importMode: importMode || 'delta_safe',
                planJsonBytes: textBytes(planJson),
                planPathBytes: textBytes(planPath),
                workspaceRootCount: Array.isArray(workspaceRoots) ? workspaceRoots.length : 0,
                responseBytes: jsonBytes(result),
                importedAccounts: result?.imported?.accounts,
                importedActions: result?.imported?.actions,
                processedActions: result?.imported?.processedActions,
                importedAssets: result?.imported?.assets,
                assetSnapshots: result?.imported?.assetSnapshots,
                contentFileSnapshots: result?.imported?.contentFileSnapshots
            });

            return result;
        } catch (error: unknown) {
            return reply.code(400).send({ error: (error as Error).message || 'Failed to import publication plan' });
        }
    });
}
