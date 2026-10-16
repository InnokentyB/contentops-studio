import { executeDzen1002, reconcileDzen1002, type Dzen1002RuntimePorts } from './dzen1002_runtime';
import { requireDzen1002Action } from './dzen1002_action_restriction';
import type { Dzen1002Result } from './dzen1002_runtime_contract';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';

/** Constructs server-owned ports; no caller selects transport, database, session or permission. */
async function productionPorts(): Promise<Dzen1002RuntimePorts> {
    const [{ default: db }, { default: facts }, { Dzen1002RuntimeStore }, native] = await Promise.all([
        import('../db'), import('./publication_fact.service'), import('./dzen1002_runtime_store'),
        import('./puppeteer/dzen1002_publisher')
    ]);
    const store = new Dzen1002RuntimeStore({ db, facts, loadManifest: loadAgentWorkspaceManifest });
    return {
        authorize: requireDzen1002Action,
        replay: a => store.replay(a), inspect: a => store.inspect(a), claim: a => store.claim(a),
        start: (a, c) => store.start(a, c), assertSubmit: (a, c) => store.assertSubmit(a, c),
        publish: native.publishDzen1002Native,
        saveReceipt: (a, c, r) => store.saveReceipt(a, c, r), confirm: (a, c) => store.confirm(a, c),
        loadClaim: (a, id) => store.loadClaim(a, id), uncertain: (a, c) => store.uncertain(a, c)
    };
}
/** Exact task1002 server publication. Live policy remains independent of engineering readiness. */
export async function publishExactDzen1002(input: unknown): Promise<Dzen1002Result> {
    return executeDzen1002(input, await productionPorts());
}
/** Receipt-only reconciliation has no provider dispatch, session access or live permission probe. */
export async function reconcileExactDzen1002(input: unknown): Promise<Dzen1002Result> {
    return reconcileDzen1002(input, await productionPorts());
}
