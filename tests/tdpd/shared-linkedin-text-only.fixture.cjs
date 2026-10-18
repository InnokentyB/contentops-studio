const { fixture, request, sha } = require('./shared-browser.fixture.cjs');
function textOnlyFixture(accountType = 'personal') {
    const f = fixture(), args = structuredClone(request);
    const body = 'An accepted paragraph about making product decisions explicit. '.repeat(8).trim()
        + '\n\nA second accepted paragraph, preserved as a separate block.';
    const identity = accountType === 'personal' ? { ...args.snapshot.identity, accountType,
        accountRef: 'synthetic_personal_linkedin', profileUrl: 'https://www.linkedin.com/in/synthetic-owner/',
        providerAccountId: 'synthetic-owner' } : args.snapshot.identity;
    Object.assign(args.snapshot, { identity, selectedAssetId: null, assetSha256: null, bodySha256: sha(body) });
    Object.assign(f.state.task, { selected_asset_id: null, selected_asset: null, visual_state: 'NO_VISUAL_NEEDED',
        visual_mode: 'optional', draft_text: body });
    f.state.task.art_direction_decisions[0].decision = 'NO_VISUAL_NEEDED';
    Object.assign(f.state.task.channel.config, { account_type: accountType, account_ref: identity.accountRef,
        raw_account: { url: identity.profileUrl } });
    Object.assign(f.state.task.quality_report.handoff_bundle, { publication: { body }, task: { account_ref: identity.accountRef } });
    return { f, args, body };
}
module.exports = { textOnlyFixture };
