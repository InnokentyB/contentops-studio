import { createHash } from 'crypto';
import { DependencyConfirmationInput, DependencyConfirmationState } from './types';

export function validateDependencyConfirmation(
    state: DependencyConfirmationState,
    incomingDependencies: DependencyConfirmationInput[]
) {
    const releaseDependencyTypes = new Set(['blocks', 'requires', 'not_before']);
    const releaseDependencies = incomingDependencies.filter((dep) => releaseDependencyTypes.has(dep.type));
    const unresolvedReleaseDependencies = releaseDependencies.filter((dep) => dep.sourceStatus !== 'completed');

    if (state === 'none' && unresolvedReleaseDependencies.length > 0) {
        const dependencyKeys = unresolvedReleaseDependencies.map((dep) => dep.sourceKey).sort();
        throw new Error(
            `[DEPENDENCIES_PRESENT] Cannot declare no dependencies while unresolved release dependencies exist: ${dependencyKeys.join(', ')}`
        );
    }
    if (state === 'confirmed' && releaseDependencies.length === 0) {
        throw new Error('[DEPENDENCIES_ABSENT] Use state=none when the initiative has no release dependency links');
    }

    return {
        releaseDependencyCount: releaseDependencies.length,
        unresolvedReleaseDependencyCount: unresolvedReleaseDependencies.length
    };
}

export function validateCalendarRange(fromDate: string, toDate: string): { from: Date; to: Date } {
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(fromDate) || !datePattern.test(toDate)) {
        throw new Error('[INVALID_DATE_RANGE] fromDate and toDate must use YYYY-MM-DD');
    }

    const from = new Date(`${fromDate}T00:00:00.000Z`);
    const to = new Date(`${toDate}T23:59:59.999Z`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || fromDate > toDate) {
        throw new Error('[INVALID_DATE_RANGE] fromDate must be on or before toDate');
    }
    return { from, to };
}

export function stableJson(value: unknown): string {
    if (value === undefined) return 'null';
    if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

export function requestHash(value: unknown): string {
    return createHash('sha256').update(stableJson(value)).digest('hex');
}
