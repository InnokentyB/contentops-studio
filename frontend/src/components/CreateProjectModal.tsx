import React, { useState } from 'react';
import type { ApiJson } from '../types/api-json'
import { projectsApi } from '../api';
import { useLocale } from '../i18n/locale';

interface CreateProjectModalProps {
    onClose: () => void;
    onSuccess: (project: ApiJson) => void;
}

const PROJECT_CONFIG_TEMPLATE_RU = `project:
  name: BA Content System
  slug: ba-content-system
  description: >
    Контент-машина для канала про системный и бизнес-анализ:
    стратегия, каналы, агенты и готовые пресеты.

settings:
  telegram_native_scheduling: "true"
  strategy_assistant_prompt: >
    Ты стратегический ассистент проекта. Помогай собирать
    недельные темы, следить за позиционированием и не терять фокус.
  fae_strategy_preferences: |
    {
      "tone": "direct",
      "focus": ["system analysis", "product thinking", "team conflicts"]
    }

content_dictionary:
  terms:
    - canonical: "системный анализ"
      aliases: ["system analysis"]
      forbidden: ["сисан"]
      notes: "Используем канонический термин в публичном контенте."
    - canonical: "бизнес-анализ"
      aliases: ["business analysis"]
      forbidden: ["BA без расшифровки"]
  style_rules:
    required_phrases: []
    forbidden_phrases:
      - "best practice без контекста"
    preferred_tone: "direct, practical, non-generic"

provider_keys:
  - name: Claude Prod
    provider: Anthropic
    key: sk-ant-...
  - name: OpenAI Shared
    provider: OpenAI
    key: sk-...

channels:
  - type: telegram
    name: Main Channel
    config:
      channelId: "-1001234567890"
      username: "ba_channel"
  - type: linkedin
    name: Founder LinkedIn
    config:
      profile: "personal"

agents:
  post_creator:
    model: gpt-4o
    apiKey: pk_1
    prompt: >
      Ты senior content writer. Пишешь сильные посты с конфликтом,
      наблюдениями из практики и ясным выводом.
  post_critic:
    model: gpt-4o-mini
    apiKey: pk_1
    prompt: >
      Ты строгий редактор. Ищи банальность, слабый хук и потерю фокуса.
  topic_creator:
    model: gpt-4o
    apiKey: pk_1
    prompt: >
      Генерируй темы для постов с явным напряжением и пользой для практиков.
  visual_architect:
    model: gpt-4o
    apiKey: pk_1
    prompt: >
      Находи сильную визуальную метафору для поста без абстрактной воды.
  gpt_image_gen:
    prompt: >
      Create a modern editorial illustration for a post about \${topic}.
      Context: \${text.substring(0, 500)}.

skill_connections:
  - name: Claude Skills
    provider: Anthropic
    model: claude-3-7-sonnet-latest
    providerKeyName: Claude Prod
    endpointType: native
    skillMode: native_skills
    enabledSkills:
      - planning
      - project_bootstrap
      - research
    systemPrompt: >
      Используй подключенные skills только когда они реально помогают
      собрать структуру проекта, стратегию или контентный pipeline.
    notes: Основной skill-capable assistant для стратегических задач.
  - name: OpenAI Tools
    provider: OpenAI
    model: gpt-4o
    providerKeyName: OpenAI Shared
    endpointType: openai_compatible
    skillMode: tools
    enabledSkills:
      - content_ops
      - qa_review

presets:
  - name: Sharp Telegram
    role: post_creator
    prompt_text: >
      Пиши для Telegram: короткие абзацы, хук в начале, практический вывод в конце.
  - name: Hard Topic Filter
    role: topic_creator
    prompt_text: >
      Не предлагай очевидные beginner-темы. Нужны реальные конфликты, trade-offs и ошибки.`;

const PROJECT_CONFIG_TEMPLATE_EN = `project:
  name: BA Content System
  slug: ba-content-system
  description: >
    A content operating system for system and business analysis:
    strategy, channels, agents, and reusable presets.

settings:
  telegram_native_scheduling: "true"
  strategy_assistant_prompt: >
    You are the project's strategy assistant. Build weekly themes,
    protect positioning, and keep the content system focused.

content_dictionary:
  terms:
    - canonical: "system analysis"
      aliases: ["systems analysis"]
      forbidden: []
      notes: "Use the canonical term in public content."
  style_rules:
    required_phrases: []
    forbidden_phrases: ["best practice without context"]
    preferred_tone: "direct, practical, non-generic"

channels:
  - type: telegram
    name: Main Channel
    config:
      channelId: "-1001234567890"
      username: "ba_channel"
      content_language: "en"

agents:
  post_creator:
    model: gpt-4o
    prompt: >
      You are a senior content writer. Write strong posts with conflict,
      observations from practice, and a clear conclusion.
  post_critic:
    model: gpt-4o-mini
    prompt: >
      You are a strict editor. Find generic claims, weak hooks, and loss of focus.
  topic_creator:
    model: gpt-4o
    prompt: >
      Generate post topics with clear tension and practical value.

presets:
  - name: Sharp Telegram
    role: post_creator
    prompt_text: >
      Use short paragraphs, open with a hook, and end with a practical conclusion.`;

export default function CreateProjectModal({ onClose, onSuccess }: CreateProjectModalProps) {
    const { locale } = useLocale();
    const [mode, setMode] = useState<'manual' | 'import'>('manual');
    const [name, setName] = useState('');
    const [slug, setSlug] = useState('');
    const [description, setDescription] = useState('');
    const [configText, setConfigText] = useState(locale === 'ru' ? PROJECT_CONFIG_TEMPLATE_RU : PROJECT_CONFIG_TEMPLATE_EN);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);

        try {
            const project = mode === 'manual'
                ? await projectsApi.create({ name, slug, description })
                : await projectsApi.importConfig(configText);

            onSuccess(project);
            onClose();
        } catch (err: ApiJson) {
            setError(err.message || 'Failed to create project');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
        }}>
            <div className="card" style={{ width: '760px', maxWidth: '95%', maxHeight: '90vh', overflowY: 'auto' }}>
                <h2 className="mb-3">Create New Project</h2>

                <div className="mb-3" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <button
                        type="button"
                        className={mode === 'manual' ? 'btn-primary' : 'btn-secondary'}
                        onClick={() => setMode('manual')}
                        disabled={isLoading}
                    >
                        Manual Setup
                    </button>
                    <button
                        type="button"
                        className={mode === 'import' ? 'btn-primary' : 'btn-secondary'}
                        onClick={() => setMode('import')}
                        disabled={isLoading}
                    >
                        Import YAML / JSON
                    </button>
                </div>

                {error && <div className="error mb-3">{error}</div>}

                <form onSubmit={handleSubmit}>
                    {mode === 'manual' && (
                        <>
                            <div className="mb-3">
                                <label style={{ display: 'block', marginBottom: '0.5rem' }}>Project Name</label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    required
                                    placeholder="My Awesome Project"
                                />
                            </div>

                            <div className="mb-3">
                                <label style={{ display: 'block', marginBottom: '0.5rem' }}>Slug (Optional)</label>
                                <input
                                    type="text"
                                    value={slug}
                                    onChange={e => setSlug(e.target.value)}
                                    placeholder="my-awesome-project"
                                />
                                <div className="text-muted mt-1" style={{ fontSize: '0.8rem' }}>
                                    Unique identifier for URLs. Leave empty to auto-generate.
                                </div>
                            </div>

                            <div className="mb-3">
                                <label style={{ display: 'block', marginBottom: '0.5rem' }}>Description</label>
                                <textarea
                                    value={description}
                                    onChange={e => setDescription(e.target.value)}
                                    rows={3}
                                    placeholder="What is this project about?"
                                />
                            </div>
                        </>
                    )}

                    {mode === 'import' && (
                        <>
                            <div className="mb-3">
                                <label style={{ display: 'block', marginBottom: '0.5rem' }}>Project Config</label>
                                <textarea
                                    value={configText}
                                    onChange={e => setConfigText(e.target.value)}
                                    rows={24}
                                    spellCheck={false}
                                    style={{ fontFamily: 'monospace' }}
                                    placeholder="Paste YAML or JSON config here"
                                />
                            </div>
                            <div className="text-muted mb-3" style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>
                                Supported sections: <code>project</code>, <code>settings</code>, <code>content_dictionary</code>, <code>provider_keys</code>, <code>channels</code>, <code>agents</code>, <code>skill_connections</code>, <code>presets</code>.
                                <br />
                                For text agents use roles like <code>post_creator</code>, <code>post_critic</code>, <code>topic_creator</code>, <code>visual_architect</code>.
                                <br />
                                For image templates use <code>gpt_image_gen</code> or <code>nano_image_gen</code> with a single <code>prompt</code> field.
                                <br />
                                For skill-capable LLMs use <code>skill_connections</code> with provider, model, providerKeyName and enabledSkills.
                            </div>
                        </>
                    )}

                    <div className="flex-between">
                        <button type="button" className="btn-secondary" onClick={onClose} disabled={isLoading}>
                            Cancel
                        </button>
                        <button type="submit" className="btn-primary" disabled={isLoading}>
                            {isLoading ? (mode === 'manual' ? 'Creating...' : 'Importing...') : (mode === 'manual' ? 'Create Project' : 'Import Project')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
