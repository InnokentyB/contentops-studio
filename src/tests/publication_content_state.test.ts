import test from 'node:test';
import assert from 'node:assert/strict';
import { derivePublicationContentState } from '../services/publication_content_state';

test('created publication task without content is empty', () => {
    assert.equal(derivePublicationContentState({ status: 'planned', draft_text: null }), 'empty');
});

test('publication task with a saved draft is ready', () => {
    assert.equal(derivePublicationContentState({ status: 'planned', draft_text: 'Ready text' }), 'ready');
});

test('handoff publication body counts as ready content', () => {
    assert.equal(derivePublicationContentState({
        status: 'awaiting_manual_publication',
        quality_report: { handoff_bundle: { publication: { body: 'Prepared body' } } }
    }), 'ready');
});

test('published task takes precedence over content readiness', () => {
    assert.equal(derivePublicationContentState({
        status: 'published',
        draft_text: 'Ready text',
        published_link: 'https://example.com/post'
    }), 'published');
});

test('canonical removed fact overrides legacy published status and link', () => {
    assert.equal(derivePublicationContentState({
        status: 'published',
        draft_text: 'Historical text',
        published_link: 'https://example.com/removed',
        publication_fact: {
            artifact_kind: 'post',
            outcome: 'removed',
            published_at: new Date(),
            public_url: 'https://example.com/removed'
        }
    }), 'ready');
});

test('story fact with provider identity and evidence is published without permalink', () => {
    assert.equal(derivePublicationContentState({
        status: 'planned',
        publication_fact: {
            artifact_kind: 'story',
            outcome: 'published',
            published_at: new Date(),
            provider_object_id: 'story:channel:time',
            evidence_ref: 'asset://proof'
        }
    }), 'published');
});
