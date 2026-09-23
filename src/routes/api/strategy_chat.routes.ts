import { FastifyInstance } from 'fastify';
import prisma from '../../db';
import aiGateway from '../../services/ai_gateway.service';
import { modelForRole } from '../../services/model_policy.service';

function strategyLanguage(raw?: string): 'en' | 'ru' {
    return raw?.trim().toLowerCase() === 'en' ? 'en' : 'ru';
}

function defaultStrategyPrompt(lang: 'en' | 'ru'): string {
    return lang === 'en'
        ? `You are the Content Strategy Assistant for ContentOps Studio.
Your goal: help the author plan an effective multi-channel content strategy for their projects.
Consider the balance of platforms, consistent publishing cadence, the Awareness → Authority → Conversion funnel, and active quarterly themes.
Ask clarifying questions when needed, propose concrete post angles, and provide clear, actionable suggestions in concise English.`
        : `Ты — Стратегический Ассистент по контенту.
Твоя задача: помогать автору выстроить эффективную контентную стратегию для его каналов.
Ты учитываешь разные платформы, стабильный контентный поток, воронку Awareness → Authority → Conversion и текущий квартальный план.
Задавай уточняющие вопросы, предлагай конкретные решения и форматы постов. Отвечай на русском языке: кратко, конкретно и полезно.`;
}

export default async function strategyChatRoutes(fastify: FastifyInstance) {
    /**
     * GET the current system prompt for the strategy assistant.
     */
    fastify.get('/api/v2/strategy-chat/settings', async (request, _reply) => {
        const projectId = (request as any).projectId;
        const { language } = request.query as { language?: string };
        const setting = await prisma.projectSettings.findUnique({
            where: { project_id_key: { project_id: projectId, key: 'strategy_assistant_prompt' } }
        });
        return {
            systemPrompt: setting?.value || defaultStrategyPrompt(strategyLanguage(language))
        };
    });

    /**
     * PUT updated system prompt for the strategy assistant.
     */
    fastify.put('/api/v2/strategy-chat/settings', async (request, _reply) => {
        const projectId = (request as any).projectId;
        const { systemPrompt } = request.body as { systemPrompt: string };
        await prisma.projectSettings.upsert({
            where: { project_id_key: { project_id: projectId, key: 'strategy_assistant_prompt' } },
            update: { value: systemPrompt },
            create: { project_id: projectId, key: 'strategy_assistant_prompt', value: systemPrompt }
        });
        return { success: true };
    });

    fastify.get('/api/v2/strategy-chat/history', async (request) => {
        const projectId = (request as any).projectId;
        const setting = await prisma.projectSettings.findUnique({
            where: { project_id_key: { project_id: projectId, key: 'strategy_assistant_history' } }
        });
        try {
            const messages = JSON.parse(setting?.value || '[]');
            return { messages: Array.isArray(messages) ? messages.slice(-40) : [] };
        } catch {
            return { messages: [] };
        }
    });

    fastify.delete('/api/v2/strategy-chat/history', async (request) => {
        const projectId = (request as any).projectId;
        await prisma.projectSettings.deleteMany({ where: { project_id: projectId, key: 'strategy_assistant_history' } });
        return { success: true };
    });

    /**
     * POST a message to the strategy assistant. Conversation history is owned by the project.
     */
    fastify.post('/api/v2/strategy-chat', async (request, reply) => {
        const projectId = (request as any).projectId;
        const { message, language } = (request.body as {
            message?: unknown;
            language?: string;
        }) || {};
        const responseLanguage = strategyLanguage(language);

        if (typeof message !== 'string' || !message.trim()) {
            return reply.code(400).send({ error: 'Message is required' });
        }

        if (message.length > 4000) {
            return reply.code(400).send({ error: 'Message exceeds maximum length of 4000 characters' });
        }

        // Load custom system prompt (or use default)
        const setting = await prisma.projectSettings.findUnique({
            where: { project_id_key: { project_id: projectId, key: 'strategy_assistant_prompt' } }
        });
        const systemPrompt = setting?.value || defaultStrategyPrompt(responseLanguage);

        // Load current quarters for context
        const quarters = await prisma.quarterPlan.findMany({
            where: { project_id: projectId },
            orderBy: { quarter_start: 'desc' },
            take: 1,
            include: { month_arcs: true }
        });
        const contextStr = quarters.length > 0
            ? responseLanguage === 'en'
                ? `\n\nCurrent quarterly plan:\nGoal: ${quarters[0].strategic_goal}\nPillar: ${quarters[0].primary_pillar}\nMonths: ${quarters[0].month_arcs.map(m => m.arc_theme).join(', ')}`
                : `\n\nТекущий квартальный план:\nЦель: ${quarters[0].strategic_goal}\nПилар: ${quarters[0].primary_pillar}\nМесяцы: ${quarters[0].month_arcs.map(m => m.arc_theme).join(', ')}`
            : '';
        const languageRule = responseLanguage === 'en'
            ? '\n\nRespond in English, even if the source context contains another language.'
            : '\n\nОтвечай по-русски, даже если исходный контекст содержит другой язык.';

        const openai = aiGateway.getOpenAIClient(process.env.OPENAI_API_KEY || '', 45000);
        const historySetting = await prisma.projectSettings.findUnique({
            where: { project_id_key: { project_id: projectId, key: 'strategy_assistant_history' } }
        });
        let history: { role: 'user' | 'assistant'; content: string }[] = [];
        try {
            const parsed = JSON.parse(historySetting?.value || '[]');
            history = Array.isArray(parsed)
                ? parsed.filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string').slice(-20)
                : [];
        } catch { /* Ignore malformed legacy chat history. */ }

        const messages = [
            { role: 'system' as const, content: systemPrompt + contextStr + languageRule },
            ...history.slice(-10), // keep last 10 turns for context
            { role: 'user' as const, content: message }
        ];

        try {
            const completion = await openai.chat.completions.create({
                model: modelForRole('classifier'),
                messages,
                max_tokens: 1000
            }, {
                timeout: 45000
            });
            const reply_text = completion.choices[0]?.message.content || '';
            const nextHistory = [...history, { role: 'user' as const, content: message.trim() }, { role: 'assistant' as const, content: reply_text }].slice(-40);
            await prisma.projectSettings.upsert({
                where: { project_id_key: { project_id: projectId, key: 'strategy_assistant_history' } },
                update: { value: JSON.stringify(nextHistory) },
                create: { project_id: projectId, key: 'strategy_assistant_history', value: JSON.stringify(nextHistory) }
            });
            return { reply: reply_text, messages: nextHistory };
        } catch (e: any) {
            reply.code(500).send({ error: e.message || 'AI request failed' });
        }
    });
}
