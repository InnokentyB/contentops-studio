"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const js_yaml_1 = __importDefault(require("js-yaml"));
class ContentPolicyMatrixService {
    constructor() {
        this.DEFAULT_YAML = `voices:
  founder:
    description: "Личный авторский голос: позиция, опыт, конфликт, наблюдение из практики."
    preferred_traits:
      - "позиция"
      - "личный опыт"
      - "напряжение"
    forbidden_phrases:
      - "в современном мире"
      - "следует отметить"
  workshop:
    description: "Голос мастерской: разбор, структура, прикладной вывод."
    preferred_traits:
      - "разбор"
      - "структура"
      - "практическая польза"
  ai:
    description: "AI voice: наблюдение, точность, machine-native framing без притворства человеком."
    preferred_traits:
      - "наблюдение"
      - "точность"
      - "не притворяться человеком"

platforms:
  telegram:
    min_chars: 700
    max_chars: 4000
    preferred_traits:
      - "сильный хук в первых строках"
      - "абзацы читаются с телефона"
  vk:
    min_chars: 500
    max_chars: 3200
    preferred_traits:
      - "более плотный лид"
      - "прямой тезис"
  threads:
    min_chars: 180
    max_chars: 700
    preferred_traits:
      - "одна мысль"
      - "короткий sharp take"

matrix:
  telegram:
    founder:
      min_chars: 900
      preferred_traits:
        - "авторская позиция"
        - "живой конфликт"
      scoring_weights:
        platform_fit: 0.25
        voice_fit: 0.35
        length_fit: 0.15
        rule_fit: 0.25
    workshop:
      preferred_traits:
        - "разбор кейса"
        - "понятная структура"
  threads:
    ai:
      max_chars: 550
      preferred_traits:
        - "короткий вывод"
        - "нечеловеческий, но осмысленный голос"
`;
    }
    getDefaultYaml() {
        return this.DEFAULT_YAML;
    }
    parseYaml(rawYaml) {
        const source = (rawYaml || '').trim() || this.DEFAULT_YAML;
        const parsed = js_yaml_1.default.load(source);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Content policy matrix must be a YAML object');
        }
        const value = parsed;
        return {
            voices: this.normalizeRuleMap(value.voices),
            platforms: this.normalizeRuleMap(value.platforms),
            matrix: this.normalizeMatrix(value.matrix)
        };
    }
    normalizeToYaml(rawValue) {
        if (typeof rawValue === 'string') {
            this.parseYaml(rawValue);
            return rawValue.trim();
        }
        const serialized = js_yaml_1.default.dump(rawValue, {
            noRefs: true,
            lineWidth: 120
        });
        this.parseYaml(serialized);
        return serialized.trim();
    }
    derivePolicy(rawYaml, context) {
        const parsed = this.parseYaml(rawYaml);
        const platformKey = String(context.platform || '').trim().toLowerCase();
        const voiceKey = String(context.voice || '').trim().toLowerCase();
        const platformRules = platformKey ? (parsed.platforms?.[platformKey] || null) : null;
        const voiceRules = voiceKey ? (parsed.voices?.[voiceKey] || null) : null;
        const matrixRules = platformKey && voiceKey ? (parsed.matrix?.[platformKey]?.[voiceKey] || null) : null;
        const scoringWeights = this.normalizeWeights(matrixRules?.scoring_weights || {});
        return {
            parsed,
            platform: platformKey || null,
            voice: voiceKey || null,
            platform_rules: platformRules,
            voice_rules: voiceRules,
            matrix_rules: matrixRules,
            scoring_weights: scoringWeights,
            applied_rules: {
                min_chars: matrixRules?.min_chars ?? platformRules?.min_chars ?? voiceRules?.min_chars ?? null,
                max_chars: matrixRules?.max_chars ?? platformRules?.max_chars ?? voiceRules?.max_chars ?? null,
                required_phrases: this.mergeStringArrays(platformRules?.required_phrases, voiceRules?.required_phrases, matrixRules?.required_phrases),
                forbidden_phrases: this.mergeStringArrays(platformRules?.forbidden_phrases, voiceRules?.forbidden_phrases, matrixRules?.forbidden_phrases),
                narrative_rules: this.mergeStringArrays(platformRules?.narrative_rules, voiceRules?.narrative_rules, matrixRules?.narrative_rules),
                preferred_traits: this.mergeStringArrays(platformRules?.preferred_traits, voiceRules?.preferred_traits, matrixRules?.preferred_traits)
            }
        };
    }
    validateText(text, rawYaml, context) {
        const normalizedText = (text || '').trim();
        const haystack = normalizedText.toLowerCase();
        const findings = [];
        if (!rawYaml?.trim()) {
            return {
                valid: true,
                score: 100,
                findings: [{
                        severity: 'info',
                        source: 'global',
                        dimension: 'rule_fit',
                        type: 'policy_missing',
                        message: 'Project content policy matrix is empty. Add YAML rules for platform and voice validation.'
                    }],
                dimensions: {
                    platform_fit: 100,
                    voice_fit: 100,
                    length_fit: 100,
                    rule_fit: 100
                },
                derived_policy: this.derivePolicy(null, context)
            };
        }
        const derivedPolicy = this.derivePolicy(rawYaml, context);
        const minChars = derivedPolicy.applied_rules.min_chars;
        const maxChars = derivedPolicy.applied_rules.max_chars;
        if (typeof minChars === 'number' && normalizedText.length < minChars) {
            findings.push({
                severity: 'warning',
                source: derivedPolicy.matrix_rules?.min_chars != null ? 'matrix' : (derivedPolicy.platform_rules?.min_chars != null ? 'platform' : 'voice'),
                dimension: 'length_fit',
                type: 'min_chars',
                message: `Text is shorter than the recommended minimum (${minChars} chars).`,
                suggestion: `Expand the post to at least ${minChars} characters.`
            });
        }
        if (typeof maxChars === 'number' && normalizedText.length > maxChars) {
            findings.push({
                severity: 'warning',
                source: derivedPolicy.matrix_rules?.max_chars != null ? 'matrix' : (derivedPolicy.platform_rules?.max_chars != null ? 'platform' : 'voice'),
                dimension: 'length_fit',
                type: 'max_chars',
                message: `Text is longer than the recommended maximum (${maxChars} chars).`,
                suggestion: `Trim the post below ${maxChars} characters.`
            });
        }
        const platformOnlyRequired = this.mergeStringArrays(derivedPolicy.platform_rules?.required_phrases, derivedPolicy.matrix_rules?.required_phrases);
        const voiceOnlyRequired = this.mergeStringArrays(derivedPolicy.voice_rules?.required_phrases, derivedPolicy.matrix_rules?.required_phrases);
        const platformOnlyForbidden = this.mergeStringArrays(derivedPolicy.platform_rules?.forbidden_phrases, derivedPolicy.matrix_rules?.forbidden_phrases);
        const voiceOnlyForbidden = this.mergeStringArrays(derivedPolicy.voice_rules?.forbidden_phrases, derivedPolicy.matrix_rules?.forbidden_phrases);
        for (const phrase of derivedPolicy.applied_rules.required_phrases) {
            if (!haystack.includes(phrase.toLowerCase())) {
                const source = platformOnlyRequired.includes(phrase) && voiceOnlyRequired.includes(phrase)
                    ? 'matrix'
                    : (platformOnlyRequired.includes(phrase) ? 'platform' : 'voice');
                findings.push({
                    severity: 'warning',
                    source,
                    dimension: source === 'voice' ? 'voice_fit' : 'platform_fit',
                    type: 'missing_phrase',
                    message: `Required phrase is missing: "${phrase}"`,
                    suggestion: phrase
                });
            }
        }
        for (const phrase of derivedPolicy.applied_rules.forbidden_phrases) {
            if (haystack.includes(phrase.toLowerCase())) {
                const source = platformOnlyForbidden.includes(phrase) && voiceOnlyForbidden.includes(phrase)
                    ? 'matrix'
                    : (platformOnlyForbidden.includes(phrase) ? 'platform' : 'voice');
                findings.push({
                    severity: 'error',
                    source,
                    dimension: source === 'voice' ? 'voice_fit' : 'platform_fit',
                    type: 'forbidden_phrase',
                    message: `Forbidden phrase found: "${phrase}"`,
                    matched: phrase
                });
            }
        }
        const dimensions = this.computeDimensions(findings);
        const weights = derivedPolicy.scoring_weights;
        const weightedScore = Math.round(dimensions.platform_fit * weights.platform_fit
            + dimensions.voice_fit * weights.voice_fit
            + dimensions.length_fit * weights.length_fit
            + dimensions.rule_fit * weights.rule_fit);
        return {
            valid: findings.filter((item) => item.severity === 'error').length === 0,
            score: Math.max(0, Math.min(100, weightedScore)),
            findings,
            dimensions,
            derived_policy: derivedPolicy
        };
    }
    normalizeRuleMap(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return {};
        }
        return Object.entries(value).reduce((acc, [key, raw]) => {
            acc[String(key).trim().toLowerCase()] = this.normalizeRuleSet(raw);
            return acc;
        }, {});
    }
    normalizeMatrix(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return {};
        }
        return Object.entries(value).reduce((platformAcc, [platformKey, rawPlatform]) => {
            if (!rawPlatform || typeof rawPlatform !== 'object' || Array.isArray(rawPlatform)) {
                return platformAcc;
            }
            platformAcc[String(platformKey).trim().toLowerCase()] = Object.entries(rawPlatform).reduce((voiceAcc, [voiceKey, rawVoice]) => {
                const normalized = this.normalizeRuleSet(rawVoice);
                normalized.scoring_weights = this.normalizeWeights(rawVoice?.scoring_weights || {});
                voiceAcc[String(voiceKey).trim().toLowerCase()] = normalized;
                return voiceAcc;
            }, {});
            return platformAcc;
        }, {});
    }
    normalizeRuleSet(raw) {
        const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
        return {
            description: typeof source.description === 'string' ? source.description.trim() : undefined,
            min_chars: typeof source.min_chars === 'number' ? source.min_chars : undefined,
            max_chars: typeof source.max_chars === 'number' ? source.max_chars : undefined,
            required_phrases: this.normalizeStringArray(source.required_phrases),
            forbidden_phrases: this.normalizeStringArray(source.forbidden_phrases),
            narrative_rules: this.normalizeStringArray(source.narrative_rules),
            preferred_traits: this.normalizeStringArray(source.preferred_traits)
        };
    }
    normalizeStringArray(value) {
        if (!Array.isArray(value))
            return [];
        return value.map((item) => String(item).trim()).filter(Boolean);
    }
    mergeStringArrays(...groups) {
        return Array.from(new Set(groups.flatMap((group) => group || [])));
    }
    normalizeWeights(raw) {
        const defaults = {
            platform_fit: 0.3,
            voice_fit: 0.3,
            length_fit: 0.15,
            rule_fit: 0.25
        };
        const merged = {
            ...defaults,
            ...(raw || {})
        };
        const sum = merged.platform_fit + merged.voice_fit + merged.length_fit + merged.rule_fit;
        if (!sum || !Number.isFinite(sum)) {
            return defaults;
        }
        return {
            platform_fit: merged.platform_fit / sum,
            voice_fit: merged.voice_fit / sum,
            length_fit: merged.length_fit / sum,
            rule_fit: merged.rule_fit / sum
        };
    }
    computeDimensions(findings) {
        const base = {
            platform_fit: 100,
            voice_fit: 100,
            length_fit: 100,
            rule_fit: 100
        };
        for (const finding of findings) {
            const penalty = finding.severity === 'error' ? 25 : finding.severity === 'warning' ? 10 : 0;
            base[finding.dimension] = Math.max(0, base[finding.dimension] - penalty);
            if (finding.dimension !== 'rule_fit') {
                base.rule_fit = Math.max(0, base.rule_fit - Math.max(5, Math.round(penalty * 0.6)));
            }
        }
        return base;
    }
}
exports.default = new ContentPolicyMatrixService();
